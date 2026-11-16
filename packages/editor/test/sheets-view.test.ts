import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDocument, type Command, type Document } from "@fm/domain";
import { sheetTag } from "./sheet-tag";
import { pageBuilds, resetPageBuilds } from "./page-builds";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

vi.mock("../src/export/page-plan", async (real) => (await import("./page-builds")).counted(await real()));

// The full-screen sheets view (sheetset.13–.15, .17, .21; AC-04, AC-12): its top bar and real pages, the set's settings
// as commands, and an editor that keeps its keys off the plan while it's open.

const opened = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
};
function sheets(shell: FakeShell) {
  const v = shell.view().sheetsView;
  if (!v) throw new Error("the view isn't open");
  return v;
}
const NIGHT: Command = { type: "addState", opId: "n", name: "Night" };
const twoLayouts = (): Document => withCommands(roomDoc(), NIGHT);
const titles = (doc: Document, ...commands: Command[]): Document => withCommands(doc, ...commands);
const meta = { meta: true };

function savedPdf(shell: FakeShell) {
  const save = shell.effectsOf("saveFile").at(-1);
  if (save?.content.kind !== "pdf") throw new Error("not a pdf");
  return save.content.pages;
}

describe("opening the view (AC-12)", () => {
  it("opens and closes", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect(shell.view().sheetsView).toBeNull();
    shell.ui({ type: "openExport" });
    expect(sheets(shell).sheets).toHaveLength(1);
    shell.ui({ type: "closeExport" });
    expect(shell.view().sheetsView).toBeNull();
  });

  it("Escape closes it", () => {
    const shell = opened(roomDoc());
    shell.key("Escape");
    expect(shell.view().sheetsView).toBeNull();
  });

  it("no document, no view", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.ui({ type: "openExport" });
    expect(sheets(r.shell).canSave).toBe(true);
    r.shell.ui({ type: "showProjectList" });
    expect(r.shell.view().sheetsView).toBeNull();
    r.shell.ui({ type: "openProject", id: "p1" });
    r.snapshot();
    expect(r.shell.view().sheetsView).toBeNull(); // the next drawing opens on its plan
  });

  it("no walls, no view, and Export says why", () => {
    const shell = opened(emptyDocument());
    expect(shell.view().sheetsView).toBeNull();
    expect(shell.view().export).toEqual({ available: false, reason: "Draw some walls first" });
  });

  it("lists every sheet with its number, kind, title, scale and part-of-plan", () => {
    const shell = opened(twoLayouts());
    expect(sheets(shell).sheets).toMatchObject([
      { id: "auto/0", number: 1, kind: "plan", title: "Layout", scale: 50, ownScale: false, partOfPlan: false, inPdf: true },
      { id: "auto/1", number: 2, kind: "plan", title: "Night", scale: 50, ownScale: false, partOfPlan: false, inPdf: true },
    ]);
  });

  it("offers every paper, and Fit beside the six scales", () => {
    const v = sheets(opened(roomDoc()));
    expect(v.paper).toBe("A4");
    expect(v.papers.map((p) => p.value)).toEqual(["A4", "A3", "A2", "A1", "Letter"]);
    expect(v.scale).toBe("");
    expect(v.scales).toEqual([
      { value: "", label: "Fit (1:50)" },
      ...[20, 25, 50, 75, 100, 200].map((n) => ({ value: String(n), label: `1:${n}` })),
    ]);
    expect(v.page).toEqual({ widthMm: 297, heightMm: 210 });
  });
});

describe("paper and the general scale are the set's (AC-04)", () => {
  it("paper and scale are commands, and undo restores them", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheetSetting", key: "paper", value: "A3" });
    expect(shell.doc().projectFields["paper"]?.value).toBe("A3");
    expect(sheets(shell).paper).toBe("A3");
    expect(sheets(shell).page).toEqual({ widthMm: 420, heightMm: 297 });
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "100" });
    expect(sheets(shell).scale).toBe("100");
    expect(sheets(shell).sheets[0]?.scale).toBe(100);
    shell.key("z", meta);
    expect(sheets(shell).scale).toBe("");
    expect(sheets(shell).paper).toBe("A3");
    shell.ui({ type: "undo" });
    expect(sheets(shell).paper).toBe("A4");
    expect(shell.doc().projectFields).toEqual({});
    shell.key("z", { meta: true, shift: true });
    expect(sheets(shell).paper).toBe("A3");
  });

  it("Fit is no row at all", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "100" });
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "" });
    expect(shell.doc().projectFields).toEqual({});
  });

  it("a value off the list is refused with the domain's reason", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "37" });
    expect(shell.view().toast).toMatch(/^Scale must be 1:20/);
    expect(shell.doc().projectFields).toEqual({});
    shell.ui({ type: "setSheetSetting", key: "paper", value: "B5" });
    expect(shell.view().toast).toMatch(/^Paper must be A4/);
  });

  it("a second client sees them", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.ui({ type: "openExport" });
    r.remote({ type: "setProjectField", key: "paper", value: "A2" });
    r.remote({ type: "setProjectField", key: "generalScale", value: "75" });
    expect(sheets(r.shell).paper).toBe("A2");
    expect(sheets(r.shell).sheets[0]?.scale).toBe(75);
  });

  it("they print where they belong, and Properties lists none of them: only the title block's and the studio's (sheetset.21)", () => {
    const shell = opened(withCommands(roomDoc(), { type: "setProjectField", key: "paper", value: "A3" }));
    shell.ui({ type: "closeExport" });
    expect(shell.view().projectFields).toHaveLength(13);
    expect(shell.view().projectFields?.map((f) => f.id)).not.toContain("project.paper");
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "pdf" });
    const text = savedPdf(shell).flatMap((p) => p.primitives).flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(text.filter((t) => /paper/i.test(t))).toEqual([]);
    expect(text.filter((t) => t === "A3")).toHaveLength(1); // the column's foot, once
  });
});

describe("the status chip (AC-06)", () => {
  it('reads "whole plans" otherwise', () => {
    expect(sheets(opened(twoLayouts())).status).toBe("Whole plans on every sheet");
  });

  it("with every sheet unticked it has nothing to say: Save PDF's reason does", () => {
    const shell = opened(twoLayouts());
    shell.ui({ type: "tickAllSheets", on: false });
    expect(sheets(shell).status).toBe("");
    expect(sheets(shell).saveReason).toBe("Tick a sheet to save a PDF");
    shell.ui({ type: "tickSheet", id: "auto/0", on: true });
    expect(sheets(shell).status).toBe("Whole plans on every sheet");
  });

  it("status counts sheets showing part of the plan", () => {
    const shell = opened(twoLayouts());
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "20" }); // 6.2 m at 1:20 on A4: 310 mm, in a 217 mm frame
    expect(sheets(shell).sheets.map((s) => s.partOfPlan)).toEqual([true, true]);
    expect(sheets(shell).status).toBe("2 show part of the plan");
    shell.command({ type: "setSheet", sheetId: "auto/1", inPdf: false });
    expect(sheets(shell).status).toBe("1 shows part of the plan");
  });

  it("and those with their own scale", () => {
    const shell = opened(twoLayouts());
    shell.command({ type: "setSheet", sheetId: "auto/0", scale: 100 });
    const [first, second] = sheets(shell).sheets;
    expect([first?.scale, first?.ownScale]).toEqual([100, true]);
    expect([second?.scale, second?.ownScale]).toEqual([50, false]);
    expect(sheets(shell).status).toBe("1 with their own scale");
    shell.command({ type: "setSheet", sheetId: "auto/1", scale: 20 });
    expect(sheets(shell).status).toBe("1 shows part of the plan · 2 with their own scale");
  });

  it("a framing past the edge shows part of the plan, and dragging it back doesn't", () => {
    const shell = opened(roomDoc());
    shell.command({ type: "setSheet", sheetId: "auto/0", cx: 3 });
    expect(sheets(shell).sheets[0]?.partOfPlan).toBe(true);
    shell.command({ type: "setSheet", sheetId: "auto/0", cx: 0 });
    expect(sheets(shell).sheets[0]?.partOfPlan).toBe(false);
  });
});

describe("Save PDF (AC-01, AC-03)", () => {
  it("Save PDF sends the sheets In PDF, in order", () => {
    const doc = titles(twoLayouts(), { type: "addState", opId: "g", name: "Guests" }, { type: "setSheet", sheetId: "auto/1", inPdf: false }, { type: "moveSheet", sheetId: "auto/2", index: 0 });
    const shell = opened(doc);
    expect(sheets(shell).canSave).toBe(true);
    shell.ui({ type: "download", format: "pdf" });
    expect(shell.effectsOf("saveFile")[0]?.name).toBe("Untitled.pdf");
    const tags = savedPdf(shell).map(sheetTag);
    expect(tags).toEqual(["GUESTS  ·  scale 1:50", "LAYOUT  ·  scale 1:50"]);
    expect(sheets(shell).sheets.map((s) => s.number)).toEqual([1, 2, null]);
  });

  it("stays open after saving", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "download", format: "pdf" });
    expect(sheets(shell).canSave).toBe(true);
  });

  it("with none, it's disabled, saying so", () => {
    const shell = opened(withCommands(roomDoc(), { type: "setSheetsInPdf", on: false }));
    expect(sheets(shell).canSave).toBe(false);
    expect(sheets(shell).saveReason).toBe("Tick a sheet to save a PDF");
    shell.ui({ type: "download", format: "pdf" });
    expect(shell.effectsOf("saveFile")).toEqual([]);
    shell.command({ type: "setSheetsInPdf", on: true });
    expect(sheets(shell).canSave).toBe(true);
    expect(sheets(shell).saveReason).toBeNull();
  });

  it("uses the stored paper and scale", () => {
    const shell = opened(withCommands(roomDoc(), { type: "setProjectField", key: "paper", value: "A3" }, { type: "setProjectField", key: "generalScale", value: "100" }));
    shell.ui({ type: "download", format: "pdf" });
    const [page] = savedPdf(shell);
    expect(page?.widthMm).toBe(420);
    expect(page ? sheetTag(page) : null).toContain("1:100");
  });

  it("an unticked sheet's page is still there to look at, with no number", () => {
    const shell = opened(withCommands(twoLayouts(), { type: "setSheet", sheetId: "auto/1", inPdf: false }));
    const row = sheets(shell).sheets[1];
    expect(row?.number).toBeNull();
    expect(row?.pages()).toHaveLength(1);
  });
});

describe("pages are built only when asked for (sheetset.27)", () => {
  beforeEach(resetPageBuilds);

  it("the view model builds none, whatever happens", () => {
    const shell = opened(twoLayouts());
    shell.moveTo({ x: 1, y: 1 });
    shell.ui({ type: "setSheetSetting", key: "paper", value: "A3" });
    expect(sheets(shell).sheets).toHaveLength(2);
    expect(pageBuilds()).toBe(0);
  });

  it("one page is built once per drawing, and an edit asks again", () => {
    const shell = opened(twoLayouts());
    const page = sheets(shell).sheets[0]?.pages()[0];
    expect(pageBuilds()).toBe(1);
    shell.moveTo({ x: 1, y: 1 });
    expect(sheets(shell).sheets[0]?.pages()[0]).toBe(page);
    expect(pageBuilds()).toBe(1);
    shell.command({ type: "setSheet", sheetId: "auto/1", title: "Evening" });
    expect(pageBuilds()).toBe(1);
    expect(sheets(shell).sheets[0]?.pages()[0]).not.toBe(page);
    expect(pageBuilds()).toBe(2);
  });

  it("the rows are the same object from event to event", () => {
    const shell = opened(twoLayouts());
    const rows = sheets(shell).sheets;
    shell.moveTo({ x: 1, y: 1 });
    expect(sheets(shell).sheets).toBe(rows);
  });
});

describe("PNG and SVG of the plan", () => {
  const LOFT = "loft/k0";
  const withLoft = (): Document => withCommands(twoLayouts(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 });
  const picture = (doc: Document, layout: string, deck: string | null, format: "png" | "svg") => {
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setActiveState", id: layout });
    shell.ui({ type: "setViewedLevel", deck });
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format });
    const save = shell.effectsOf("saveFile")[0];
    expect(sheets(shell).canSave).toBe(true);
    return format === "png" ? shell.effectsOf("rasterise")[0]?.page.primitives : save?.content.kind === "svg" ? save.content.primitives : undefined;
  };

  it("PNG and SVG of the plan still save the viewed layout and level", () => {
    const doc = withCommands(withLoft(), { type: "setCeiling", height: 3.5 }, { type: "placeObject", linked: false, deck: LOFT, opId: "bed", state: "n/s0", object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 2.5, y: 2.6 } });
    for (const format of ["png", "svg"] as const) {
      const day = picture(doc, "s0", LOFT, format);
      const night = picture(doc, "n/s0", LOFT, format);
      const nightFloor = picture(doc, "n/s0", null, format);
      expect(day, format).toBeDefined();
      expect(night, format).not.toEqual(day);
      expect(night, format).not.toEqual(nightFloor);
    }
  });

  it("finishes stay this viewer's choice, for the images only, and an unknown value is ignored", () => {
    const shell = opened(roomDoc());
    expect(sheets(shell).finishes).toBe("with");
    shell.ui({ type: "setExport", field: "finishes", value: "without" });
    expect(sheets(shell).finishes).toBe("without");
    shell.ui({ type: "setExport", field: "finishes", value: "sometimes" });
    expect(sheets(shell).finishes).toBe("without");
    expect(shell.state.exportChoices["local"]).toEqual({ finishes: "without" });
  });
});

describe("the view keeps the editor's keys off the plan (sheetset.14)", () => {
  /** A wall selected under the open view, after one earlier edit. */
  function selectedWall(): FakeShell {
    const shell = FakeShell.withDocument(roomDoc());
    shell.command({ type: "setProjectField", key: "client", value: "Rossi" });
    shell.click({ x: 3, y: 0 });
    expect(shell.view().properties.kind).toBe("wall");
    shell.ui({ type: "openExport" });
    return shell;
  }

  it("an editor key while open doesn't reach the plan", () => {
    const shell = selectedWall();
    const doc = shell.doc();
    const tool = shell.view().activeTool;
    const selection = shell.state.selection;
    for (const key of ["w", "v", "z", "Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "r", "3", "Enter"]) shell.key(key);
    shell.key("d", meta);
    expect(shell.doc()).toBe(doc);
    expect(shell.view().activeTool).toBe(tool);
    expect(shell.state.selection).toBe(selection);
    expect(sheets(shell).canSave).toBe(true);
    shell.ui({ type: "closeExport" });
    shell.key("Delete"); // the control: the same key does reach the plan now
    expect(shell.doc()).not.toBe(doc);
  });

  it("⌘Z undoes", () => {
    const shell = selectedWall();
    shell.key("z", meta);
    expect(shell.doc().projectFields).toEqual({});
    shell.key("z", { meta: true, shift: true });
    expect(shell.doc().projectFields["client"]?.value).toBe("Rossi");
    shell.key("z", { ctrl: true });
    expect(shell.doc().projectFields).toEqual({});
  });

  it("a typed value on the plan waits underneath", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("w");
    shell.click({ x: 10, y: 10 });
    shell.moveTo({ x: 12, y: 10 });
    shell.ui({ type: "openExport" });
    const walls = Object.keys(shell.doc().walls).length;
    shell.type("3");
    shell.key("Enter");
    expect(Object.keys(shell.doc().walls)).toHaveLength(walls);
    shell.ui({ type: "closeExport" });
    shell.type("3"); // the control: the same keys draw the wall now
    shell.key("Enter");
    expect(Object.keys(shell.doc().walls)).toHaveLength(walls + 1);
  });

  it("with the last wall undone the view hides, and the keys go back to the plan", () => {
    const shell = FakeShell.withDocument(emptyDocument());
    shell.command({ type: "addWall", opId: "a", from: { at: { x: 0, y: 0 } }, to: { at: { x: 3, y: 0 } } });
    shell.ui({ type: "openExport" });
    shell.key("z", meta);
    expect(shell.view().sheetsView).toBeNull();
    shell.key("w");
    expect(shell.view().activeTool).toBe("wall");
  });
});
