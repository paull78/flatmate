import { describe, expect, it } from "vitest";
import { parseStoredDocument, unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { flatDrawings, sheetDrawings, type Document, type Sheet, type SheetDrawing, type SheetKind } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { sheetsOf } from "../src/queries/sheets";
import { deserialize, serialize, upgradeStored } from "../src/serialize";
import { parseSheet } from "../src/shape";
import { fromStored } from "../src/shape-tables";
import { validateDocument } from "../src/validate";
import { sheetProblem } from "../src/validate-sheets";
import { rectDoc } from "./helpers";

// A Section sheet in the document (section.10): a kind of its own, naming one section for 1 to 4 layouts at the floor.

const run = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const addSection = (y: number): Command => ({ type: "addSection", a: { x: 0, y }, b: { x: 6, y }, side: 1 });

/** A room with the layouts Day and Night and the sections A and B. */
const base = (): Document => {
  const states = { day: { id: "day", name: "Day", order: 0 }, night: { id: "night", name: "Night", order: 1 } };
  return run(run({ ...rectDoc(0, 0, 6, 4), states }, addSection(1)), addSection(2));
};

const DAY: SheetDrawing = { layout: "day", deck: null };
const NIGHT: SheetDrawing = { layout: "night", deck: null };

const row = (id: string, kind: SheetKind, drawings: readonly SheetDrawing[], section: string | null): Sheet => ({
  id, kind, order: 0, inPdf: true, title: id, scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings(drawings), text: "", size: "normal", section,
});
const withRows = (doc: Document, ...rows: Sheet[]): Document => ({ ...doc, sheets: Object.fromEntries(rows.map((r) => [r.id, r])) });

const addSheet = (opId: string, section: string, drawings: readonly SheetDrawing[]): Command => ({ type: "addSheet", opId, after: null, kind: "section", drawings, section, title: opId });
const stored = (doc: Document, id: string): Sheet | undefined => sheetsOf(doc).find((s) => s.id === id);

/** Runs the command as one patch, checks the patch rebuilds its result and that inverting it (an undo) restores the input. */
function asOnePatch(doc: Document, cmd: Command): Document {
  const { doc: next, patch } = unwrap(execute(doc, cmd));
  expect(unwrap(applyPatch(doc, patch))).toEqual(next);
  expect(unwrap(applyPatch(next, invertPatch(patch)))).toEqual(doc);
  return next;
}

describe("a stored sheet row", () => {
  /** The document as it was saved before Section sheets: its row has no `section` key. */
  const oldFile = (): Record<string, unknown> => {
    const rest: Partial<Sheet> = row("p", "plan", [DAY], null);
    delete rest.section;
    return { ...serialize(base()), sheets: { p: rest } };
  };

  it("an old sheet row reads with section null", () => {
    expect(deserialize({ ...oldFile(), sheets: { p: { ...row("p", "plan", [DAY], null), section: 5 } } }).ok).toBe(false); // the fill only adds what's missing
    expect(unwrap(deserialize(oldFile())).sheets.p?.section).toBeNull();
    const file = parseStoredDocument(oldFile());
    if (!file) throw new Error("unparseable");
    expect(unwrap(fromStored(upgradeStored(file))).sheets.p?.section).toBeNull();
  });

  it("a stored letter survives the same load, and a round trip", () => {
    const doc = withRows(base(), row("s", "section", [DAY], "B"));
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc))))).sheets.s?.section).toBe("B");
    const file = parseStoredDocument(JSON.parse(JSON.stringify(serialize(doc))));
    if (!file) throw new Error("unparseable");
    expect(unwrap(fromStored(upgradeStored(file))).sheets.s?.section).toBe("B");
  });

  it("the row's shape: a letter or null, the key required", () => {
    const good = row("s", "section", [DAY], "A");
    expect(parseSheet(good)).toEqual(good);
    expect(parseSheet({ ...good, section: null })).toEqual({ ...good, section: null });
    expect(parseSheet({ ...good, section: 5 })).toBeNull();
    expect(parseSheet({ ...good, section: "" })).toBeNull();
    const without: Partial<Sheet> = { ...good };
    delete without.section;
    expect(parseSheet(without)).toBeNull();
  });
});

describe("validate", () => {
  const problem = (sheet: Sheet, doc = base()): string | null => sheetProblem(doc, sheet);
  const invalid = (sheet: Sheet): boolean => !validateDocument(withRows(base(), sheet)).ok;

  it("accepts a Section sheet of 1 to 4 layouts naming a section", () => {
    for (const drawings of [[DAY], [DAY, NIGHT], [DAY, NIGHT, DAY], [DAY, NIGHT, DAY, NIGHT]]) {
      const sheet = row("s", "section", drawings, "A");
      expect(problem(sheet)).toBeNull();
      expect(validateDocument(withRows(base(), sheet)).ok).toBe(true);
    }
  });

  it.each<[SheetKind, readonly SheetDrawing[]]>([["plan", [DAY]], ["compare", [DAY, NIGHT]], ["cover", [DAY]], ["report", []]])("refuses a section on a %s sheet", (kind, drawings) => {
    expect(problem(row("s", kind, drawings, null))).toBeNull();
    expect(problem(row("s", kind, drawings, "A"))).toBe("Only a section sheet names a section");
    expect(invalid(row("s", kind, drawings, "A"))).toBe(true);
  });

  it("refuses a Section sheet with no section or a missing one", () => {
    expect(problem(row("s", "section", [DAY], null))).toBe("A section sheet names a section");
    expect(invalid(row("s", "section", [DAY], null))).toBe(true);
    expect(problem(row("s", "section", [DAY], "Z"))).toBe("Section not found");
    expect(invalid(row("s", "section", [DAY], "Z"))).toBe(true);
    expect(problem(row("s", "section", [DAY], "constructor"))).toBe("Section not found"); // an inherited key isn't a row
  });

  it("refuses a deck on it, in any pane", () => {
    expect(problem(row("s", "section", [{ layout: "day", deck: "loft" }], "A"))).toBe("A section sheet draws layouts, not levels");
    expect(problem(row("s", "section", [DAY, { layout: "night", deck: "loft" }], "A"))).toBe("A section sheet draws layouts, not levels");
    expect(invalid(row("s", "section", [{ layout: "day", deck: "loft" }], "A"))).toBe(true);
  });

  it("refuses no layouts, and a layout that's gone", () => {
    expect(problem(row("s", "section", [], "A"))).toBe("A section sheet holds 1 to 4 layouts");
    expect(problem(row("s", "section", [{ layout: "gone", deck: null }], "A"))).toBe("Layout not found");
  });

  it("the commands say the same, and store nothing", () => {
    const refusal = (cmd: Command): string | null => {
      const r = execute(base(), cmd);
      return r.ok ? null : r.error.message;
    };
    expect(refusal({ type: "addSheet", opId: "x", after: null, kind: "section", drawings: [DAY] })).toBe("A section sheet names a section");
    expect(refusal(addSheet("x", "Z", [DAY]))).toBe("Section not found");
    expect(refusal(addSheet("x", "A", [DAY, NIGHT, DAY, NIGHT, DAY]))).toBe("A section sheet holds 1 to 4 layouts");
    expect(refusal({ type: "addSheet", opId: "x", after: null, kind: "plan", drawings: [DAY], section: "A" })).toBe("Only a section sheet names a section");
  });

  it("setSheet changes the section, and a blank row's default is none", () => {
    const doc = run(base(), addSheet("s", "A", [DAY]));
    expect(stored(doc, "s/t0")?.section).toBe("A");
    expect(stored(run(doc, { type: "setSheet", sheetId: "s/t0", section: "B" }), "s/t0")?.section).toBe("B");
    expect(stored(run(doc, { type: "setSheet", sheetId: "s/t0", title: "Kept" }), "s/t0")?.section).toBe("A");
    expect(stored(run(base(), { type: "addSheet", opId: "p", after: null, kind: "plan", drawings: [DAY] }), "p/t0")?.section).toBeNull();
  });
});

describe("deleting what a Section sheet names", () => {
  const twoSheets = (): Document => run(run(base(), addSheet("a", "A", [DAY, NIGHT])), addSheet("b", "B", [DAY]));
  const deleteSection = (id: string): Command => ({ type: "deleteEntities", ids: [{ table: "sections", id }] });

  it("deleting a section removes its sheets as deleting a layout does; undo restores them", () => {
    const before = twoSheets();
    const copy = run(before, addSheet("a2", "A", [NIGHT]));
    const list = sheetsOf(copy).map((s) => s.id);
    expect(list).toEqual(expect.arrayContaining(["a/t0", "a2/t0", "b/t0", "auto/0", "auto/1"]));
    const next = asOnePatch(copy, deleteSection("A")); // asOnePatch checks the inverse restores every row
    expect(sheetsOf(next).map((s) => s.id)).toEqual(list.filter((id) => id !== "a/t0" && id !== "a2/t0"));
    expect(next.sections.A).toBeUndefined();
    expect(stored(next, "b/t0")).toEqual(stored(copy, "b/t0"));
  });

  it("says which rows it wrote, so a race on one clashes", () => {
    const { patch } = unwrap(execute(twoSheets(), deleteSection("A")));
    expect(JSON.stringify(patch)).toContain("a/t0");
  });

  it("a delete leaving no sheet returns the list to automatic, as a layout's does", () => {
    const only = withRows(base(), row("s", "section", [DAY], "A"));
    const next = asOnePatch(only, deleteSection("A"));
    expect(next.sheets).toEqual({});
    expect(sheetsOf(next).map((s) => s.title)).toEqual(["Day", "Night"]);
  });

  it("deleting a layout takes its pane and keeps the kind and the section", () => {
    const next = asOnePatch(twoSheets(), { type: "deleteState", stateId: "day" });
    const sheet = stored(next, "a/t0");
    expect(sheet?.kind).toBe("section");
    expect(sheet?.section).toBe("A");
    expect(sheet && sheetDrawings(sheet)).toEqual([NIGHT]);
    expect(validateDocument(next).ok).toBe(true);
  });

  it("deleting a Section sheet's last layout removes it", () => {
    const next = asOnePatch(twoSheets(), { type: "deleteState", stateId: "day" });
    expect(stored(next, "b/t0")).toBeUndefined();
  });

  it("an unrelated edit leaves it alone", () => {
    const before = twoSheets();
    const next = run(before, { type: "setSection", sectionId: "A", side: -1 });
    expect(stored(next, "a/t0")).toEqual(stored(before, "a/t0"));
  });
});

describe("a sheet's section marks (section.60)", () => {
  const addPlan = (doc: Document): Document => run(doc, { type: "addSheet", opId: "p", after: null, kind: "plan", title: "P", drawings: [DAY] });
  const SHEET = "p/t0";

  it("a new sheet draws them", () => {
    expect(addPlan(base()).sheets[SHEET]?.marks).toBe(true);
  });

  it("setSheet turns them off and back, in one undoable edit", () => {
    const doc = addPlan(base());
    const off = unwrap(execute(doc, { type: "setSheet", sheetId: SHEET, marks: false }));
    expect(off.doc.sheets[SHEET]?.marks).toBe(false);
    expect(unwrap(applyPatch(off.doc, invertPatch(off.patch))).sheets[SHEET]?.marks).toBe(true);
    expect(run(off.doc, { type: "setSheet", sheetId: SHEET, marks: true }).sheets[SHEET]?.marks).toBe(true);
  });

  it("an automatic sheet draws them", () => {
    expect(sheetsOf(base())[0]?.marks).toBe(true);
  });

  it("a row with something else in the field isn't a sheet", () => {
    expect(parseSheet({ ...row("p", "plan", [DAY], null), marks: "no" })).toBeNull();
  });

  it("a sheet saved before the field reads with them on, by both load paths, and a stored off survives", () => {
    const old = { ...base(), sheets: { p: row("p", "plan", [DAY], null) } };
    const stored = Object.fromEntries(Object.entries(old.sheets.p).filter(([key]) => key !== "marks"));
    const file = (sheet: unknown): Record<string, unknown> => ({ ...JSON.parse(JSON.stringify(serialize(old))), sheets: { p: sheet } });
    expect(unwrap(deserialize(file(stored))).sheets.p?.marks).toBe(true);
    const parsed = parseStoredDocument(file(stored));
    if (!parsed) throw new Error("unparseable");
    expect(unwrap(fromStored(upgradeStored(parsed))).sheets.p?.marks).toBe(true);
    expect(unwrap(deserialize(file({ ...stored, marks: false }))).sheets.p?.marks).toBe(false);
  });
});
