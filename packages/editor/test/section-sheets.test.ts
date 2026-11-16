import { describe, expect, it } from "vitest";
import { sheetDrawings, sheetsOf, type Command, type Document } from "@fm/domain";
import { sheetFacts, sheetPages, sheetSet, type SheetPage } from "../src/export/sheet";
import { missingDrawings } from "../src/export/sheet-list";
import { clearRoomDoc, labelledDoc, loftRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The Section sheet everywhere a sheet's kind matters (section.10): stored, offered, duplicated, listed: what would go
// wrong silently, as nothing here would fail to compile. What it draws is in section-page.test.ts.

const addNight: Command = { type: "addState", opId: "n", name: "Night" };
const NIGHT = "n/s0";
const line = (y: number): Command => ({ type: "addSection", a: { x: 1, y }, b: { x: 5, y }, side: 1 });
const sectionSheet = (opId: string, section: string, ...layouts: string[]): Command => ({
  type: "addSheet", opId, after: null, kind: "section", section, title: `Sheet ${opId}`, drawings: layouts.map((layout) => ({ layout, deck: null })),
});
/** A room, the layouts Layout and Night, the sections A and B, stored rows, with one Section sheet of A for Layout. */
const withSheet = (): Document => withCommands(roomDoc(), addNight, line(1), line(2), sectionSheet("s", "A", "s0"));
const SHEET = "s/t0";

const opened = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
};
function view(shell: FakeShell) {
  const v = shell.view().sheetsView;
  if (!v) throw new Error("the view isn't open");
  return v;
}
function rowOf(shell: FakeShell, id: string) {
  const row = view(shell).sheets.find((s) => s.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}
function stored(shell: FakeShell, id: string) {
  const sheet = sheetsOf(shell.doc()).find((s) => s.id === id);
  if (!sheet) throw new Error(`no sheet ${id}`);
  return sheet;
}
const options = () => ({ projectName: "Flat", paper: "A4" as const, scale: 50 as const, host: new FakeHost(), finishes: true });
const pageOf = (doc: Document, id: string): SheetPage => {
  const set = sheetPages(doc, options());
  const page = set.pages[(set.numbers.get(id) ?? 0) - 1];
  if (!page) throw new Error(`no page for ${id}`);
  return page;
};
const texts = (page: SheetPage): string[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));

describe("adding one", () => {
  it("is offered with the sections to choose from, and defaults to the first and the viewed layout", () => {
    const shell = opened(withCommands(roomDoc(), addNight, line(1), line(2)));
    expect(view(shell).sections).toEqual([{ id: "A", label: "A–A" }, { id: "B", label: "B–B" }]);
    shell.ui({ type: "setActiveState", id: NIGHT });
    shell.ui({ type: "addSheet", kind: "section" });
    const sheet = stored(shell, view(shell).selected ?? "");
    expect(sheet.kind).toBe("section");
    expect(sheet.section).toBe("A");
    expect(sheetDrawings(sheet)).toEqual([{ layout: NIGHT, deck: null }]);
    expect(sheet.title).toBe("Section A–A");
    expect(sheet.scale).toBeNull();
    expect(view(shell).warning).toBeNull(); // the title's dash prints
  });

  it("with no section there's nothing to offer, and it can't be added", () => {
    const shell = opened(roomDoc());
    expect(view(shell).sections).toEqual([]);
    const before = view(shell).sheets.map((s) => s.id);
    shell.ui({ type: "addSheet", kind: "section" });
    expect(view(shell).sheets.map((s) => s.id)).toEqual(before);
    expect(shell.view().canUndo).toBe(false);
  });
});

describe("its row", () => {
  it("names its section; every other kind names none", () => {
    const shell = opened(withSheet());
    expect(rowOf(shell, SHEET).kind).toBe("section");
    expect(rowOf(shell, SHEET).section).toBe("A");
    expect(rowOf(shell, "auto/0").section).toBeNull();
  });

  it("a cropped section sheet's status says the drawing, not the plan", () => {
    const shell = opened(withSheet());
    const row = rowOf(shell, SHEET);
    const tooLarge = row.scales.find((s) => s.nofit)?.scale;
    if (tooLarge == null) throw new Error("every scale fits");
    shell.ui({ type: "setSheet", id: SHEET, fields: { scale: tooLarge } });
    expect(rowOf(shell, SHEET).partOfPlan).toBe(true);
    expect(shell.view().sheetsView?.status).toContain("shows part of the drawing");
  });

  it("agrees with what Claude reads, and never reads as part of the plan", () => {
    const doc = withSheet();
    const shell = opened(doc);
    const fact = sheetFacts(doc).find((f) => f.id === SHEET);
    const row = rowOf(shell, SHEET);
    expect(fact).toEqual({ id: SHEET, number: row.number, scale: row.scale, pages: row.pageCount, partOfPlan: row.partOfPlan });
    expect(row.partOfPlan).toBe(false);
    expect(row.pageCount).toBe(1);
    expect(row.shortcuts).toBeNull();
    expect(row.scales).toHaveLength(7);
  });
});

describe("what would break silently", () => {
  it("duplicating a Section sheet keeps its section", () => {
    const shell = opened(withCommands(withSheet(), { type: "setSheet", sheetId: SHEET, section: "B" }));
    shell.ui({ type: "duplicateSheet", id: SHEET });
    const id = view(shell).selected ?? "";
    expect(id).not.toBe(SHEET);
    const copy = stored(shell, id);
    expect(copy.section).toBe("B");
    expect(copy).toEqual({ ...stored(shell, SHEET), id, order: copy.order, title: "Sheet s copy" });
  });

  it("section sheets don't hide a layout's missing-sheet notice", () => {
    const planOnly = withCommands(roomDoc(), addNight, line(1), { type: "deleteSheet", sheetId: "auto/1" });
    expect(missingDrawings(planOnly).map((d) => d.title)).toEqual(["Night"]);
    const doc = withCommands(planOnly, sectionSheet("s", "A", NIGHT));
    expect(sheetsOf(doc).map((s) => s.kind)).toEqual(["plan", "section"]);
    expect(missingDrawings(doc).map((d) => d.title)).toEqual(["Night"]);
    expect(view(opened(doc)).missing.map((d) => d.title)).toEqual(["Night"]);
  });

  it("the set's orientation ignores section sheets", () => {
    const tall = withCommands(clearRoomDoc(3, 9, "t"), line(1));
    const layout = Object.keys(tall.states)[0] ?? "";
    expect(sheetSet(tall, options()).orientation).toBe("portrait"); // its plan alone turns the page
    const planOff: Command = { type: "setSheet", sheetId: "auto/0", inPdf: false };
    expect(sheetSet(withCommands(tall, planOff), options()).orientation).toBe("landscape"); // with nothing drawn, the paper's way
    expect(sheetSet(withCommands(tall, planOff, sectionSheet("s", "A", layout)), options()).orientation).toBe("landscape");
  });

  it("a pane's name counts for the characters warning, as a compare's does", () => {
    const shell = opened(withCommands(roomDoc(), { type: "addState", opId: "g", name: "Νύχτα" }, line(1), { type: "deleteSheet", sheetId: "auto/1" }, { type: "setSheet", sheetId: "auto/0", title: "Plan" }));
    expect(view(shell).warning).toBeNull();
    const withPane = opened(withCommands(shell.doc(), sectionSheet("s", "A", "g/s0")));
    expect(view(withPane).warning).toBe("Some names use characters the PDF can't show");
  });

  it("undoing a section's delete brings back its sheets, as one step", () => {
    const shell = opened(withSheet());
    const before = view(shell).sheets.map((s) => s.id);
    shell.send({ type: "command", command: { type: "deleteEntities", ids: [{ table: "sections", id: "A" }] } });
    expect(view(shell).sheets.map((s) => s.id)).toEqual(before.filter((id) => id !== SHEET));
    expect(view(shell).sections.map((s) => s.id)).toEqual(["B"]);
    shell.ui({ type: "undo" });
    expect(view(shell).sheets.map((s) => s.id)).toEqual(before);
    expect(stored(shell, SHEET).section).toBe("A");
  });
});

describe("its page", () => {
  it("prints with its column, numbered among the others", () => {
    const doc = withSheet();
    const page = pageOf(doc, SHEET);
    expect(texts(page)).toContain("Flat");
    expect(page.clips?.length).toBe(1);
    expect(pageOf(doc, "auto/0").clips?.length).toBe(1);
    const set = sheetPages(doc, options());
    expect(set.pages).toHaveLength(3);
    expect(set.numbers.get(SHEET)).toBe(3);
  });

  it("its column has no north or rooms table; a plan's has both", () => {
    const doc = withCommands(labelledDoc(), line(1), { type: "setProjectField", key: "north", value: "90" }, sectionSheet("s", "A", "s0"));
    const plan = texts(pageOf(doc, "auto/0"));
    expect(plan).toContain("ROOM");
    expect(plan).toContain("N");
    const section = texts(pageOf(doc, SHEET));
    expect(section).not.toContain("ROOM");
    expect(section).not.toContain("N");
    expect(section.filter((t) => / m$/.test(t)).length).toBeGreaterThan(0); // it keeps its scale bar
  });
});

describe("its layouts", () => {
  const panes = (shell: FakeShell) => rowOf(shell, SHEET).panes;
  const manyLayouts: Command[] = ["a", "b", "c"].map((opId) => ({ type: "addState", opId, name: opId.toUpperCase() }));

  it("a check per layout at the floor, whatever the levels: a section isn't cut per level", () => {
    const doc = withCommands(loftRoomDoc(), addNight, line(1), sectionSheet("s", "A", "s0"));
    const shell = opened(doc);
    expect(view(shell).levels.length).toBeGreaterThan(1);
    expect(panes(shell).map((p) => [p.layout, p.deck, p.on])).toEqual([["s0", null, true], [NIGHT, null, false]]);
  });

  it("the last one can't go, and a fifth can't join", () => {
    const shell = opened(withCommands(withSheet(), ...manyLayouts));
    expect(panes(shell).map((p) => [p.on, p.locked])).toEqual([[true, true], [false, false], [false, false], [false, false], [false, false]]);
    for (const layout of [NIGHT, "a/s0", "b/s0"]) shell.ui({ type: "toggleSheetPane", id: SHEET, layout, deck: null });
    expect(sheetDrawings(stored(shell, SHEET))).toHaveLength(4);
    expect(panes(shell).filter((p) => p.locked).map((p) => p.layout)).toEqual(["c/s0"]);
    shell.ui({ type: "toggleSheetPane", id: SHEET, layout: "c/s0", deck: null });
    expect(sheetDrawings(stored(shell, SHEET))).toHaveLength(4);
    for (const layout of [NIGHT, "a/s0", "b/s0"]) shell.ui({ type: "toggleSheetPane", id: SHEET, layout, deck: null });
    expect(sheetDrawings(stored(shell, SHEET))).toEqual([{ layout: "s0", deck: null }]);
    expect(panes(shell).filter((p) => p.locked).map((p) => p.layout)).toEqual(["s0"]);
    shell.ui({ type: "toggleSheetPane", id: SHEET, layout: "s0", deck: null });
    expect(sheetDrawings(stored(shell, SHEET))).toEqual([{ layout: "s0", deck: null }]);
  });

  it("a compare sheet keeps its own rule, at least two", () => {
    const shell = opened(withCommands(withSheet(), { type: "addSheet", opId: "c", after: null, kind: "compare", title: "C", drawings: [{ layout: "s0", deck: null }, { layout: NIGHT, deck: null }] }));
    expect(rowOf(shell, "c/t0").panes.map((p) => p.locked)).toEqual([true, true]);
  });
});

describe("choosing its section", () => {
  it("a title still naming its section follows, in one undo step", () => {
    const shell = opened(withCommands(roomDoc(), line(1), line(2)));
    shell.ui({ type: "addSheet", kind: "section" });
    const id = view(shell).selected ?? "";
    shell.ui({ type: "setSheetSection", id, section: "B" });
    expect(stored(shell, id).section).toBe("B");
    expect(stored(shell, id).title).toBe("Section B–B");
    shell.ui({ type: "undo" });
    expect(stored(shell, id).section).toBe("A");
    expect(stored(shell, id).title).toBe("Section A–A");
  });

  it("a typed title stays", () => {
    const shell = opened(withSheet());
    shell.ui({ type: "setSheetSection", id: SHEET, section: "B" });
    expect(stored(shell, SHEET).section).toBe("B");
    expect(stored(shell, SHEET).title).toBe("Sheet s");
  });

  it("a section someone just deleted is refused, and an unknown sheet does nothing", () => {
    const shell = opened(withSheet());
    shell.ui({ type: "setSheetSection", id: SHEET, section: "Z" });
    expect(stored(shell, SHEET).section).toBe("A");
    shell.ui({ type: "setSheetSection", id: "nope", section: "B" });
    expect(stored(shell, SHEET).section).toBe("A");
  });
});
