import { describe, expect, it } from "vitest";
import { PROJECT_FIELDS, emptyDocument, rectangleRoom, type Command, type Document } from "@fm/domain";
import { sheetPages, type SheetPage } from "../src/export/sheet";
import { withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// A column too full for its page (sheetset.21; AC-09, AC-07): the notes shorten to 2 lines first; when it still doesn't
// fit, the rooms table goes and a note names the papers that hold it all. It never blocks a save.

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}

const NOTES = "Notes about the flat, its furniture and what to check on site before ordering anything. ".repeat(6).slice(0, 500);

/** Every field at its limit (two lines each on the sheet), 500 characters of notes, and `rooms` labelled 1 m rooms in a row. */
function fullDoc(rooms: number): Document {
  let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, rooms, 1, "row"));
  for (let i = 1; i < rooms; i++) doc = withCommands(doc, { type: "addWall", opId: `d${i}`, from: { at: { x: i, y: 0 } }, to: { at: { x: i, y: 1 } } });
  for (let i = 0; i < rooms; i++) doc = withCommands(doc, { type: "labelZone", id: `L${i}`, at: { x: i + 0.5, y: 0.5 }, name: `R${i}`, finish: null });
  const fields: Command[] = PROJECT_FIELDS.map((f) => ({ type: "setProjectField", key: f.key, value: f.multiline ? NOTES : "Field value long enough to wrap ".repeat(3).slice(0, f.maxLength) }));
  return withCommands(doc, ...fields);
}

const sheet = (doc: Document, paper: "A4" | "A3" = "A4") => sheetPages(doc, { projectName: "Flat Rossi", paper, scale: "fit", host: host(), finishes: true });
const noteLines = (page: SheetPage): string[] =>
  page.primitives.flatMap((p) => (p.kind === "text" && p.size === 2.3 ? [p.text] : []));

/** The fewest rooms for which `test` holds, searching 1 to 30. */
function firstRooms(test: (doc: Document) => boolean): number {
  for (let n = 1; n <= 30; n++) if (test(fullDoc(n))) return n;
  throw new Error("never");
}

describe("column overflow (AC-09)", () => {
  it("the notes shorten to 2 lines before the rooms table goes, and nothing else drops", () => {
    const shortened = firstRooms((d) => {
      const first = sheet(d)?.pages[0];
      return first !== undefined && noteLines(first).length < 8;
    });
    const before = sheet(fullDoc(shortened - 1))?.pages[0];
    const page = sheet(fullDoc(shortened))?.pages[0];
    if (!before || !page) throw new Error("no page");
    expect(noteLines(before)).toHaveLength(8);
    expect(noteLines(page)).toHaveLength(2);
    expect(noteLines(page)[1]?.endsWith("…")).toBe(true);
    const texts = page.primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));
    for (const f of PROJECT_FIELDS.filter((x) => !x.multiline && x.key !== "subtitle")) expect(texts).toContain(f.label.toUpperCase());
    for (let i = 0; i < shortened; i++) expect(texts).toContain(`R${i}`);
    expect(texts).toEqual(expect.arrayContaining(["Total", "Dimensions are approximate; check on site."]));
    expect(texts).toContain("A4");
  });

  it("a column that still overflows loses the rooms table on A4, and keeps it on A3", () => {
    const full = firstRooms((d) => sheet(d).columnFull);
    expect(sheet(fullDoc(full - 1)).columnFull).toBe(false);
    const rooms = (paper: "A4" | "A3") => sheet(fullDoc(full), paper).pages[0]?.primitives.flatMap((p) => (p.kind === "text" && p.text === "ROOM" ? [p] : [])) ?? [];
    expect(rooms("A4")).toEqual([]);
    expect(rooms("A3")).toHaveLength(1);
    expect(sheet(fullDoc(full), "A3").columnFull).toBe(false);
  });

  it("with every field full and the rooms table gone, the top of the column stays above its foot", () => {
    const full = firstRooms((d) => sheet(d).columnFull);
    const twoPages = withCommands(fullDoc(full), { type: "addState", opId: "n", name: "Night" }); // the foot at its tallest, with a number
    const page = sheet(twoPages).pages[0];
    if (!page) throw new Error("no page");
    const column = page.widthMm - 10 - 60;
    const inColumn = page.primitives.flatMap((p) => (p.kind === "text" && p.at.x >= column ? [p] : []));
    const y = (match: (t: string) => boolean): number[] => inColumn.filter((t) => match(t.text)).map((t) => t.at.y);
    expect(Math.min(...y((t) => t === "NOTES"))).toBeGreaterThan(Math.max(...y((t) => t === "2 m" || t === "0")));
    const notes = noteLines(page);
    expect(notes).toHaveLength(2);
    expect(notes[1]?.endsWith("…")).toBe(true);
    expect(Math.min(...y((t) => notes.includes(t)))).toBeGreaterThan(Math.max(...y((t) => t === "2 m" || t === "0")));
  });

  it("one fit for every page of a set: a page with room to spare shortens its notes like the fullest one", () => {
    // A report's column has no scale bar, so it can hold more notes than a plan's. Together, both print 2.
    const set = (doc: Document, ...kinds: ("plan" | "report")[]): Document =>
      withCommands(doc, ...kinds.map((kind, i): Command => ({ type: "addSheet", opId: `k${i}`, after: null, kind, drawings: kind === "plan" ? [{ layout: "s0", deck: null }] : [] })), { type: "deleteSheet", sheetId: "auto/0" });
    const lines = (doc: Document): number[] => sheet(doc).pages.map((p) => noteLines(p).length);
    // Shorter notes step the column by less than the bar's height, so some room count and note length land between.
    const drawings = [...Array(30).keys()].flatMap((rooms) => [100, 200, 300, 400].map((length) => withCommands(fullDoc(rooms + 1), { type: "setProjectField", key: "notes", value: NOTES.slice(0, length) })));
    const doc = drawings.find((d) => lines(set(d, "plan", "plan"))[0] === 2 && (lines(set(d, "report", "report"))[0] ?? 0) > 2);
    if (!doc) throw new Error("no such drawing: the fixture must change the answer");
    expect(lines(set(doc, "plan", "report"))).toEqual([2, 2]);
    expect(lines(set(doc, "report", "plan"))).toEqual([2, 2]);
  });

  it("the view notes that the title block is too full, and Save PDF still works", () => {
    const full = firstRooms((d) => sheet(d).columnFull);
    const shell = FakeShell.withDocument(fullDoc(full));
    shell.ui({ type: "openExport" });
    // Every other paper that works is named; Letter's column is 6 mm taller than A4's.
    expect(shell.view().sheetsView?.note).toMatch(/^Title block too full for A4; try A3 or A2 or A1( or Letter)?$/);
    expect(shell.view().sheetsView?.canSave).toBe(true);
    expect(shell.view().sheetsView?.sheets[0]?.pages()).toHaveLength(1);
    shell.ui({ type: "setSheetSetting", key: "paper", value: "A3" });
    expect(shell.view().sheetsView?.note).toBeNull();
    expect(shell.view().sheetsView?.canSave).toBe(true);
  });
});

describe("field values and the PDF's characters (AC-07)", () => {
  const panelWarning = (value: string): string | null => {
    const shell = FakeShell.withDocument(withCommands(fullDoc(1), { type: "setProjectField", key: "client", value }));
    shell.ui({ type: "openExport" });
    return shell.view().sheetsView?.warning ?? null;
  };

  it("a field with a character outside Windows-1252 warns; an accented Latin one does not", () => {
    expect(panelWarning("Łukasz")).toBe("Some names use characters the PDF can't show");
    expect(panelWarning("Rossi è")).toBeNull();
  });

  it("a sheet's title prints, so it warns too", () => {
    const shell = FakeShell.withDocument(withCommands(fullDoc(1), { type: "setSheet", sheetId: "auto/0", title: "Łukasz" }));
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.warning).toBe("Some names use characters the PDF can't show");
  });

  it("line breaks in the notes do not warn: the sheet prints each line on its own (found at the M2 gate)", () => {
    const shell = FakeShell.withDocument(withCommands(fullDoc(1), { type: "setProjectField", key: "notes", value: "First draft.\nWindows not drawn yet." }));
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.warning).toBeNull();
  });
});
