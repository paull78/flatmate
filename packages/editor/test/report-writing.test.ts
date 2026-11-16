import { describe, expect, it } from "vitest";
import { MAX_SHEET_TEXT, sheetsOf, type Command, type Document } from "@fm/domain";
import { OVERTAKEN_NOTE } from "../src/export/report-draft";
import { REMOTE_UNDO } from "../src/history/history";
import { TOAST_MS, TOAST_TIMER } from "../src/toast";
import type { Primitive } from "../src/view/scene-types";
import type { SheetRow } from "../src/view/view-model-types";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Writing the report (sheetset.07, .14; AC-09, AC-14): a viewer's own draft, drawn on the page with no command, one undo
// step on leaving the box, and no way for what was typed to go missing.
//
//   box ── typeReport ──► draft ──► the page (nothing sent)
//   box ── leaveReport ─► setSheet { text } ──► ack: draft gone | refused: draft stays, "Not saved"

const REPORT = "r/t0";
const OTHER = "o/t0";
const addReport = (id: string, text = "# Title\n\nStored."): Command => ({ type: "addSheet", opId: id, after: null, kind: "report", title: "Report", drawings: [], text });
const withReport = (...more: Command[]): Document => withCommands(roomDoc(), addReport("r"), ...more);

function textsOf(primitives: readonly Primitive[]): string[] {
  return primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));
}
function rowOf(shell: FakeShell, id = REPORT): SheetRow {
  const row = shell.view().sheetsView?.sheets.find((s) => s.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}
const pageText = (shell: FakeShell, id = REPORT): string => rowOf(shell, id).pages().flatMap((p) => textsOf(p.primitives)).join(" ");
const stored = (shell: FakeShell, id = REPORT): string | undefined => sheetsOf(shell.doc()).find((s) => s.id === id)?.text;

function localShell(doc = withReport()): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
}
function shared(doc = withReport()): FakeRemote {
  const remote = FakeRemote.open(doc);
  remote.shell.ui({ type: "openExport" });
  return remote;
}
const type = (shell: FakeShell, text: string, id = REPORT): void => shell.ui({ type: "typeReport", id, text });
const leave = (shell: FakeShell, id = REPORT): void => shell.ui({ type: "leaveReport", id });

describe("typing", () => {
  it("typing draws the page from the draft, sending no command", () => {
    const remote = shared();
    type(remote.shell, "# New title\n\nFresh words.");
    expect(remote.submits()).toEqual([]);
    expect(stored(remote.shell)).toBe("# Title\n\nStored.");
    expect(rowOf(remote.shell).text).toBe("# New title\n\nFresh words.");
    expect(pageText(remote.shell)).toContain("New title");
    expect(pageText(remote.shell)).toContain("Fresh words.");
    expect(pageText(remote.shell)).not.toContain("Stored.");
  });

  it("the page count follows the draft, and the page's own number says so", () => {
    const shell = localShell();
    const before = rowOf(shell).pageCount;
    type(shell, Array.from({ length: 80 }, (_, i) => `${i} The plan fits a whole home into seven by two and a half metres.`).join("\n\n"));
    const count = rowOf(shell).pageCount;
    expect(count).toBeGreaterThan(before);
    expect(rowOf(shell).pages()).toHaveLength(count);
    const total = (shell.view().sheetsView?.sheets ?? []).reduce((n, r) => n + (r.inPdf ? r.pageCount : 0), 0);
    expect(textsOf(rowOf(shell).pages()[0]?.primitives ?? []).find((t) => t.startsWith("Sheet "))).toContain(`/ ${String(total).padStart(2, "0")}`);
  });

  it("only this sheet's row changes per keystroke, and an event with no new text rebuilds nothing", () => {
    const shell = localShell(withReport({ type: "addSheet", opId: "o", after: null, kind: "plan", title: "Other", drawings: [{ layout: "s0", deck: null }] }));
    const other = rowOf(shell, OTHER);
    type(shell, "One");
    expect(rowOf(shell, OTHER)).toBe(other);
    const drafted = rowOf(shell);
    shell.ui({ type: "setSnapStep", step: "auto" }); // any event: the ViewModel runs on every one
    expect(rowOf(shell)).toBe(drafted);
  });
});

describe("leaving the box", () => {
  it("leaving the box commits once, one undo step", () => {
    const shell = localShell();
    type(shell, "One");
    type(shell, "One two");
    leave(shell);
    leave(shell);
    expect(stored(shell)).toBe("One two");
    expect(rowOf(shell).text).toBe("One two");
    shell.ui({ type: "undo" });
    expect(stored(shell)).toBe("# Title\n\nStored.");
    expect(rowOf(shell).text).toBe("# Title\n\nStored.");
    shell.ui({ type: "redo" });
    expect(stored(shell)).toBe("One two");
  });

  it("sends one edit to the server, and the draft goes with its ack", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    leave(remote.shell);
    leave(remote.shell);
    expect(remote.submits()).toHaveLength(1);
    expect(remote.shell.state.reportDrafts[REPORT]?.text).toBe("Mine");
    remote.accept();
    expect(remote.shell.state.reportDrafts[REPORT]).toBeUndefined();
    expect(rowOf(remote.shell).text).toBe("Mine");
  });

  it("leaving with nothing typed, or the text back as stored, sends nothing and adds no step", () => {
    const remote = shared();
    leave(remote.shell);
    type(remote.shell, "Other");
    type(remote.shell, "# Title\n\nStored.");
    leave(remote.shell);
    expect(remote.submits()).toEqual([]);
    expect(remote.shell.state.reportDrafts[REPORT]).toBeUndefined();
  });

  it("typing again before the ack keeps the new words, and the old ack doesn't take them", () => {
    const remote = shared();
    type(remote.shell, "First");
    leave(remote.shell);
    type(remote.shell, "First and more");
    remote.accept();
    expect(rowOf(remote.shell).text).toBe("First and more");
    leave(remote.shell);
    expect(remote.submits()).toHaveLength(2);
    expect(stored(remote.shell)).toBe("First and more");
  });

  it("closing the view or Escape commits what's in the box", () => {
    for (const close of [(s: FakeShell) => s.ui({ type: "closeExport" }), (s: FakeShell) => s.key("Escape")]) {
      const shell = localShell();
      type(shell, "Typed, then closed");
      close(shell);
      expect(shell.view().sheetsView).toBeNull();
      expect(stored(shell)).toBe("Typed, then closed");
      shell.ui({ type: "undo" });
      expect(stored(shell)).toBe("# Title\n\nStored.");
    }
  });

  it("selecting another sheet commits what's in the box, once, with or without a blur before it", () => {
    for (const blurs of [true, false]) {
      const remote = shared(withReport({ type: "addSheet", opId: "o", after: null, kind: "plan", title: "Other", drawings: [{ layout: "s0", deck: null }] }));
      remote.shell.ui({ type: "selectSheet", id: REPORT });
      type(remote.shell, "Typed, then another sheet");
      if (blurs) leave(remote.shell);
      remote.shell.ui({ type: "selectSheet", id: OTHER });
      expect(remote.submits()).toHaveLength(1);
      expect(stored(remote.shell)).toBe("Typed, then another sheet");
    }
  });

  it("a blocked commit keeps the draft and says it isn't saved; trying again lands it", () => {
    const remote = shared();
    remote.shell.ui({ type: "setSheet", id: REPORT, fields: { title: "In flight" } }); // an edit waiting for its ack blocks the next
    type(remote.shell, "Mine");
    leave(remote.shell);
    expect(remote.shell.view().toast).toBe("Waiting for server");
    expect(rowOf(remote.shell).text).toBe("Mine");
    expect(rowOf(remote.shell).textHeld).toBe(true);
    remote.accept();
    leave(remote.shell);
    expect(stored(remote.shell)).toBe("Mine");
    expect(remote.submits()).toHaveLength(2);
  });

  it("offline, closing keeps the draft for when the view opens again", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    remote.disconnect();
    remote.shell.ui({ type: "closeExport" });
    remote.shell.ui({ type: "openExport" });
    expect(rowOf(remote.shell).text).toBe("Mine");
    expect(rowOf(remote.shell).textHeld).toBe(true);
    expect(remote.submits()).toEqual([]);
  });
});

describe("collaborators", () => {
  const BOB_TEXT: Command = { type: "setSheet", sheetId: REPORT, text: "Bob's words" };

  it("a refused commit keeps the draft", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    leave(remote.shell);
    remote.remote(BOB_TEXT); // reaches the server first
    remote.reject();
    expect(remote.shell.view().toast).toBe("Someone else changed this first");
    expect(rowOf(remote.shell).text).toBe("Mine");
    expect(rowOf(remote.shell).textHeld).toBe(true);
    expect(pageText(remote.shell)).toContain("Mine");
    expect(stored(remote.shell)).toBe("Bob's words");
    leave(remote.shell); // trying again lands on the newer row
    expect(stored(remote.shell)).toBe("Mine");
    remote.accept();
    expect(rowOf(remote.shell).textHeld).toBe(false);
  });

  it("a collaborator's edit to another sheet doesn't touch the draft", () => {
    const remote = shared(withReport({ type: "addSheet", opId: "o", after: null, kind: "report", title: "Other", drawings: [], text: "Other text" }));
    type(remote.shell, "Mine");
    remote.remote({ type: "setSheet", sheetId: OTHER, text: "Bob's words" });
    remote.remote({ type: "setSheet", sheetId: REPORT, title: "Bob's title" }); // this row, not its text
    expect(rowOf(remote.shell).text).toBe("Mine");
    expect(rowOf(remote.shell).title).toBe("Bob's title");
    expect(remote.shell.view().toast).toBeNull();
    leave(remote.shell);
    expect(stored(remote.shell)).toBe("Mine");
  });

  it("a collaborator's change keeps a draft being typed, says so, and leaving sends it: last writer wins", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    remote.remote(BOB_TEXT);
    expect(rowOf(remote.shell).text).toBe("Mine");
    expect(pageText(remote.shell)).toContain("Mine");
    expect(stored(remote.shell)).toBe("Bob's words");
    expect(remote.shell.view().toast).toBe("Someone else changed this first");
    type(remote.shell, "Mine, and more"); // typing on keeps every word
    expect(rowOf(remote.shell).text).toBe("Mine, and more");
    leave(remote.shell);
    expect(remote.submits()).toHaveLength(1);
    expect(stored(remote.shell)).toBe("Mine, and more");
    remote.accept();
    expect(remote.shell.state.reportDrafts[REPORT]).toBeUndefined();
    expect(rowOf(remote.shell).text).toBe("Mine, and more");
  });

  it("the box says it's overtaken for as long as leaving would replace another's text", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    expect(rowOf(remote.shell).textNote).toBeNull();
    remote.remote(BOB_TEXT);
    expect(rowOf(remote.shell).textNote).toBe(OVERTAKEN_NOTE);
    type(remote.shell, "Mine, and more"); // the toast is gone in six seconds, and this stays
    expect(rowOf(remote.shell).textNote).toBe(OVERTAKEN_NOTE);
    leave(remote.shell);
    expect(rowOf(remote.shell).textNote).toBeNull(); // on its way: there's nothing left to warn of
    remote.accept();
    expect(rowOf(remote.shell).textNote).toBeNull();
    type(remote.shell, "A new draft");
    expect(rowOf(remote.shell).textNote).toBeNull();
  });

  it("a collaborator who wrote the same words overtakes nothing", () => {
    const remote = shared();
    type(remote.shell, "Bob's words");
    remote.remote(BOB_TEXT);
    expect(rowOf(remote.shell).textNote).toBeNull();
    expect(remote.shell.view().toast).toBeNull();
  });

  it("being over the limit is said first, as leaving then replaces nothing", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    remote.remote(BOB_TEXT);
    type(remote.shell, "x".repeat(MAX_SHEET_TEXT + 5));
    expect(rowOf(remote.shell).textNote).toContain("5 characters over");
    type(remote.shell, "Mine again");
    expect(rowOf(remote.shell).textNote).toBe(OVERTAKEN_NOTE);
  });

  it("a draft held by a refusal shows its own note, not this one", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    leave(remote.shell);
    remote.remote(BOB_TEXT);
    remote.reject();
    expect(rowOf(remote.shell).textHeld).toBe(true);
    expect(rowOf(remote.shell).textNote).toBeNull();
  });

  it("after leaving, undo brings back the collaborator's text and redo the draft", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    remote.remote(BOB_TEXT);
    leave(remote.shell);
    remote.accept();
    remote.shell.ui({ type: "undo" });
    expect(stored(remote.shell)).toBe("Bob's words");
    remote.accept();
    remote.shell.ui({ type: "redo" });
    expect(stored(remote.shell)).toBe("Mine");
  });

  it("a step of one's own from before the collaborator's change can't be undone over it, and says so", () => {
    const remote = shared();
    type(remote.shell, "First");
    leave(remote.shell);
    remote.accept();
    remote.remote(BOB_TEXT);
    type(remote.shell, "Mine");
    leave(remote.shell);
    remote.accept();
    remote.shell.ui({ type: "undo" });
    remote.accept();
    expect(stored(remote.shell)).toBe("Bob's words");
    remote.shell.ui({ type: "undo" });
    expect(remote.shell.view().toast).toBe(REMOTE_UNDO);
    expect(stored(remote.shell)).toBe("Bob's words");
  });

  it("each change says so once: an edit that doesn't touch the text says nothing more, a new text does", () => {
    const remote = shared();
    const toastGone = (): void => {
      remote.shell.host.advance(TOAST_MS);
      remote.shell.fireTimer(TOAST_TIMER);
      expect(remote.shell.view().toast).toBeNull();
    };
    type(remote.shell, "Mine");
    remote.remote(BOB_TEXT);
    toastGone();
    remote.remote({ type: "setSheet", sheetId: REPORT, title: "Bob's title" });
    expect(remote.shell.view().toast).toBeNull();
    remote.remote({ type: "setSheet", sheetId: REPORT, text: "Bob again" });
    expect(remote.shell.view().toast).toBe("Someone else changed this first");
    expect(rowOf(remote.shell).text).toBe("Mine");
  });

  it("a collaborator writing the very words typed says nothing, and leaving sends nothing", () => {
    const remote = shared();
    type(remote.shell, "Bob's words");
    remote.remote(BOB_TEXT);
    expect(remote.shell.view().toast).toBeNull();
    leave(remote.shell);
    expect(remote.submits()).toEqual([]);
    expect(remote.shell.state.reportDrafts[REPORT]).toBeUndefined();
  });

  it("a box nobody typed in follows, with no toast", () => {
    const remote = shared();
    remote.remote(BOB_TEXT);
    expect(rowOf(remote.shell).text).toBe("Bob's words");
    expect(remote.shell.view().toast).toBeNull();
    leave(remote.shell);
    expect(remote.submits()).toEqual([]);
  });

  it("a draft refused once isn't replaced by the next change: it was promised to stay", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    leave(remote.shell);
    remote.remote(BOB_TEXT);
    remote.reject();
    remote.remote({ type: "setSheet", sheetId: REPORT, text: "Bob again" });
    expect(rowOf(remote.shell).text).toBe("Mine");
  });

  it("a sheet deleted under a draft takes the draft with it", () => {
    const remote = shared();
    type(remote.shell, "Mine");
    remote.remote({ type: "deleteSheet", sheetId: REPORT });
    expect(remote.shell.state.reportDrafts[REPORT]).toBeUndefined();
    remote.shell.ui({ type: "closeExport" });
    expect(remote.submits()).toEqual([]);
    expect(remote.shell.view().toast).toBeNull();
  });
});

describe("the 20,000 limit", () => {
  const OVER = "x ".repeat(10_100);

  it("over 20,000 characters: says so at the box, and the commit is refused", () => {
    const remote = shared();
    type(remote.shell, OVER);
    expect(rowOf(remote.shell).textNote).toBe("200 characters over the 20,000 a report holds: not saved, and the page waits");
    leave(remote.shell);
    expect(remote.submits()).toEqual([]);
    expect(remote.shell.view().toast).toBe("A report's text can be at most 20,000 characters");
    expect(rowOf(remote.shell).text).toBe(OVER); // nothing's cut: the person chooses what goes
    expect(stored(remote.shell)).toBe("# Title\n\nStored.");
    type(remote.shell, OVER.slice(0, 20_000));
    expect(rowOf(remote.shell).textNote).toBeNull();
    leave(remote.shell);
    expect(remote.submits()).toHaveLength(1);
  });

  it("the page waits while the text is over, so a huge paste can't stall the view", () => {
    const shell = localShell();
    type(shell, `Over ${OVER}`);
    expect(pageText(shell)).toContain("Stored.");
    expect(pageText(shell)).not.toContain("Over");
  });

  it("exactly 20,000 is fine", () => {
    const shell = localShell();
    type(shell, "x".repeat(20_000));
    expect(rowOf(shell).textNote).toBeNull();
    leave(shell);
    expect(stored(shell)).toHaveLength(20_000);
  });
});

describe("body size", () => {
  it("body size is a command, one undo step", () => {
    const shell = localShell();
    shell.ui({ type: "setSheet", id: REPORT, fields: { size: "large" } });
    expect(rowOf(shell).size).toBe("large");
    shell.ui({ type: "undo" });
    expect(rowOf(shell).size).toBe("normal");
  });
});

describe("Project in Properties", () => {
  const reportField = (shell: FakeShell) => shell.view().projectFields?.find((f) => f.id === "project.report");

  it("Properties shows the first line of the first report, skipping marks, with Edit", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), addReport("r", "\n\n# **Studio** in a *room*\n\nBody."), addReport("s", "# Second")));
    const field = reportField(shell);
    expect(field?.sheet).toBe(sheetsOf(shell.doc()).find((s) => s.kind === "report")?.id);
    expect(field?.value).toBe("**Studio** in a *room*"); // marks inside a heading print as typed (sheetset.50)
    expect(field?.readOnly).toBe(true);
  });

  it("a paragraph's first line drops its marks", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), addReport("r", "The **big** room\nand *more*\n\nBody.")));
    expect(reportField(shell)?.value).toBe("The big room");
  });

  it("none with no report", () => {
    expect(reportField(FakeShell.withDocument(roomDoc()))).toBeUndefined();
  });

  it("a blank report still offers Edit", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), addReport("r", "")));
    expect(reportField(shell)?.value).toBe("");
    expect(reportField(shell)?.sheet).toBe(REPORT);
  });

  it("Edit opens the view on that sheet", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), addReport("r"), { type: "addSheet", opId: "o", after: null, kind: "plan", title: "Other", drawings: [{ layout: "s0", deck: null }] }));
    shell.ui({ type: "openSheet", id: REPORT });
    expect(shell.view().sheetsView?.selected).toBe(REPORT);
  });
});
