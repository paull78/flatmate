import { describe, expect, it } from "vitest";
import { MAX_NAME_CHARS, parseStoredDocument, unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { topologyMessage } from "../src/errors";
import { CEILING_ID, MAX_SHEET_TEXT, SHEET_SCALES, flatDrawings, sheetDrawings, type Document, type Sheet, type SheetDrawing } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { levelOf } from "../src/queries/levels";
import { automaticSheets, sheetsOf } from "../src/queries/sheets";
import { deserialize, serialize, upgradeStored } from "../src/serialize";
import { parseSheet } from "../src/shape";
import { fromStored } from "../src/shape-tables";
import { validateDocument } from "../src/validate";
import { loftStudio, place, rectDoc, tinyHouse, withDeck } from "./helpers";

// Sheets in the document (sheetset.02, .11, .12, .16; AC-01, AC-02): automatic until the first edit, then rows.

const layouts = (doc: Document, ...names: [id: string, name: string][]): Document => ({
  ...doc,
  states: Object.fromEntries(names.map(([id, name], order) => [id, { id, name, order }])),
});

/** Three layouts and nothing else, so three automatic plans. */
const flat = (): Document => layouts(rectDoc(0, 0, 6, 4), ["day", "Day"], ["night", "Night"], ["guests", "Guests"]);

/** Two lofts at one top (one level, "Left, Right"), none carrying anything, under a 3.20 ceiling. */
const twinLofts = (): Document => {
  let doc: Document = { ...layouts(tinyHouse(), ["day", "Day"], ["night", "Night"]), ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.2 } } };
  doc = withDeck(doc, { id: "left", name: "Left", at: [4, 1.25], w: 1.2, d: 2, top: 2.15, solid: false });
  return withDeck(doc, { id: "right", name: "Right", at: [5.8, 1.25], w: 1.2, d: 2, top: 2.15, solid: false });
};

const drawing = (layout: string, deck: string | null = null): SheetDrawing => ({ layout, deck });

const row = (id: string, order: number, list: readonly SheetDrawing[], over: Partial<Sheet> = {}): Sheet => ({
  id, kind: list.length >= 2 ? "compare" : "plan", order, inPdf: true, title: id, scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings(list), text: "", size: "normal", section: null, ...over,
});

const withRows = (doc: Document, ...rows: Sheet[]): Document => ({ ...doc, sheets: Object.fromEntries(rows.map((r) => [r.id, r])) });

const run = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const refusal = (doc: Document, cmd: Command): string | null => {
  const r = execute(doc, cmd);
  return r.ok ? null : r.error.message;
};
const ids = (doc: Document): string[] => sheetsOf(doc).map((s) => s.id);
const shown = (doc: Document, id: string): Sheet | undefined => sheetsOf(doc).find((s) => s.id === id);

/** Runs the command as one patch, checks the patch rebuilds its result and that inverting it restores the input. */
function asOnePatch(doc: Document, cmd: Command): Document {
  const { doc: next, patch } = unwrap(execute(doc, cmd));
  expect(unwrap(applyPatch(doc, patch))).toEqual(next);
  expect(unwrap(applyPatch(next, invertPatch(patch)))).toEqual(doc);
  return next;
}

describe("the automatic list", () => {
  it("no rows: one plan per layout at the floor, in layout order", () => {
    const doc = layouts(rectDoc(0, 0, 6, 4), ["b", "Night"], ["a", "Day"]);
    expect(sheetsOf(doc)).toEqual([
      { id: "auto/0", kind: "plan", order: 0, inPdf: true, title: "Night", scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings([drawing("b")]), text: "", size: "normal", section: null },
      { id: "auto/1", kind: "plan", order: 1, inPdf: true, title: "Day", scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings([drawing("a")]), text: "", size: "normal", section: null },
    ]);
  });

  it("a loft showing its own pieces adds a plan per layout; an empty loft doesn't", () => {
    // The mattress stands on the loft in s0 only; night has nothing there.
    const doc = layouts(loftStudio(), ["s0", "Day"], ["night", "Night"]);
    expect(sheetsOf(doc).map((s) => [s.id, s.title, sheetDrawings(s)])).toEqual([
      ["auto/0", "Day", [drawing("s0")]],
      ["auto/1", "Day · Loft", [drawing("s0", "loft")]],
      ["auto/2", "Night", [drawing("night")]],
    ]);
    expect(ids(layouts(tinyHouse(), ["s0", "Day"]))).toEqual(["auto/0"]);
  });

  it("a piece from the floor reaching past the loft is not a piece of its own", () => {
    const empty = withDeck({ ...rectDoc(0, 0, 7, 2.5), ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.05 } } }, { id: "loft", name: "Loft", at: [1.3, 1.25], w: 2.4, d: 2.3, top: 2.15, solid: false });
    // On the floor, outside the loft, reaching 2.40: the loft level shows it, and it still gives the loft no sheet.
    const doc = place(empty, { object: "shelf", kind: "desk", at: [5, 1.4], size: { w: { standard: 0.8 }, d: { standard: 0.3 }, h: { standard: 0.6 }, z: { standard: 1.8 } } });
    expect(ids(doc)).toEqual(["auto/0"]);
  });

  it("automatic ids are stable: the same doc gives the same ids, so a command can target one", () => {
    const doc = flat();
    expect(ids(doc)).toEqual(["auto/0", "auto/1", "auto/2"]);
    expect(ids({ ...doc })).toEqual(ids(doc));
    expect(automaticSheets({ ...doc })).toEqual(automaticSheets(doc));
    expect(shown(run(doc, { type: "setSheet", sheetId: "auto/1", title: "Plan B" }), "auto/1")?.title).toBe("Plan B");
  });

  it("very long names still make a storable title, so a first edit is never refused for them", () => {
    const long = "x".repeat(MAX_NAME_CHARS);
    const doc = layouts(loftStudio(), ["s0", long]);
    const titles = sheetsOf(doc).map((s) => s.title.length);
    expect(titles).toEqual([MAX_NAME_CHARS, MAX_NAME_CHARS]);
    expect(validateDocument(run(doc, { type: "setSheet", sheetId: "auto/1", inPdf: false })).ok).toBe(true);
    // Cut through an emoji in the deck's name, the pair goes whole.
    const studio = layouts(loftStudio(), ["s0", "x".repeat(MAX_NAME_CHARS - 4)]);
    const loft = studio.decks.loft;
    const emoji: Document = loft ? { ...studio, decks: { loft: { ...loft, name: "\u{1F600}oft" } } } : studio;
    expect(sheetsOf(emoji)[1]?.title).toBe(`${"x".repeat(MAX_NAME_CHARS - 4)} · `);
  });
});

describe("the first edit", () => {
  it("any sheet command writes the whole automatic list first", () => {
    const doc = flat();
    const { doc: next, patch } = unwrap(execute(doc, { type: "setSheet", sheetId: "auto/1", title: "Plan B" }));
    expect(patch.puts.map((p) => [p.table, p.entity.id])).toEqual([["sheets", "auto/0"], ["sheets", "auto/1"], ["sheets", "auto/2"]]);
    expect(patch.deletes).toEqual([]);
    expect(sheetsOf(next).map((s) => s.title)).toEqual(["Day", "Plan B", "Guests"]);
    expect(unwrap(applyPatch(next, invertPatch(patch)))).toEqual(doc); // undone, the list is automatic again
    expect(validateDocument(next).ok).toBe(true);
  });

  it("every command writes it: add, delete, move and In PDF", () => {
    const doc = flat();
    const rowCount = (cmd: Command): number => Object.keys(run(doc, cmd).sheets).length;
    expect(rowCount({ type: "addSheet", opId: "op", after: null, kind: "plan", drawings: [drawing("day")] })).toBe(4);
    expect(rowCount({ type: "deleteSheet", sheetId: "auto/0" })).toBe(2);
    expect(rowCount({ type: "moveSheet", sheetId: "auto/0", index: 2 })).toBe(3);
    expect(rowCount({ type: "setSheetsInPdf", on: false })).toBe(3);
  });

  it("it depends on the layouts it was worked out from, and on the decks it names (a later edit on its own row only)", () => {
    const doc = layouts(loftStudio(), ["s0", "Day"], ["night", "Night"]);
    const { doc: next, patch } = unwrap(execute(doc, { type: "setSheet", sheetId: "auto/0", title: "T" }));
    expect(patch.dependencies).toEqual(expect.arrayContaining([{ table: "states", id: "s0" }, { table: "states", id: "night" }, { table: "decks", id: "loft" }]));
    const later = unwrap(execute(next, { type: "setSheet", sheetId: "auto/1", title: "U" })).patch;
    expect(later.dependencies).toEqual([{ table: "sheets", id: "auto/1" }]);
    expect(later.puts.map((p) => p.entity.id)).toEqual(["auto/1"]);
  });

  it("a command that changes nothing writes nothing, so the list stays automatic", () => {
    const doc = flat();
    const noop: Command[] = [
      { type: "setSheet", sheetId: "auto/0", title: "Day" },
      { type: "moveSheet", sheetId: "auto/1", index: 1 },
      { type: "setSheetsInPdf", on: true },
    ];
    for (const cmd of noop) {
      const r = unwrap(execute(doc, cmd));
      expect(r.doc).toBe(doc);
      expect(r.patch.puts).toEqual([]);
    }
  });
});

describe("the list once it is stored", () => {
  it("rows list by order then id, and only rows", () => {
    const doc = withRows(flat(), row("b", 1, [drawing("day")]), row("a", 1, [drawing("day")]), row("c", 0, [drawing("night")]));
    expect(ids(doc)).toEqual(["c", "a", "b"]);
  });

  it("a new layout after rows exist adds no sheet", () => {
    const doc = run(flat(), { type: "setSheet", sheetId: "auto/0", title: "T" });
    const next = run(doc, { type: "addState", opId: "op", name: "Extra" });
    expect(ids(next)).toEqual(ids(doc));
  });

  it("addSheet places after the given sheet", () => {
    const doc = flat();
    const added = (after: string | null): Document => asOnePatch(doc, { type: "addSheet", opId: "op", after, kind: "plan", drawings: [drawing("night")], title: "New" });
    expect(ids(added("auto/0"))).toEqual(["auto/0", "op/t0", "auto/1", "auto/2"]);
    expect(shown(added("auto/0"), "op/t0")?.order).toBe(0.5);
    expect(ids(added("auto/2"))).toEqual(["auto/0", "auto/1", "auto/2", "op/t0"]);
    expect(shown(added("auto/2"), "op/t0")?.order).toBe(3);
    expect(ids(added(null))).toEqual(["auto/0", "auto/1", "auto/2", "op/t0"]);
    expect(refusal(doc, { type: "addSheet", opId: "op", after: "nope", kind: "plan", drawings: [drawing("day")] })).toBe("Sheet not found");
    expect(shown(added(null), "op/t0")).toEqual({ id: "op/t0", kind: "plan", order: 3, inPdf: true, title: "New", scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings([drawing("night")]), text: "", size: "normal", section: null });
  });

  it("addSheet takes a row's other fields, and writes one row on a stored list", () => {
    const stored = run(flat(), { type: "setSheet", sheetId: "auto/0", title: "T" });
    const { doc, patch } = unwrap(execute(stored, { type: "addSheet", opId: "op", after: null, kind: "report", drawings: [], title: "Relazione", text: "# Hello", size: "large", inPdf: false, scale: 50, split: "stacked", cx: 1, cy: 2, finishes: false }));
    expect(patch.puts.map((p) => p.entity.id)).toEqual(["op/t0"]);
    expect(shown(doc, "op/t0")).toEqual({ id: "op/t0", kind: "report", order: 3, inPdf: false, title: "Relazione", scale: 50, split: "stacked", cx: 1, cy: 2, finishes: false, marks: true, drawings: flatDrawings([]), text: "# Hello", size: "large", section: null });
  });

  it("addSheet refuses a used or a malformed opId", () => {
    const doc = run(flat(), { type: "addSheet", opId: "op", after: null, kind: "plan", drawings: [drawing("day")] });
    expect(refusal(doc, { type: "addSheet", opId: "op", after: null, kind: "plan", drawings: [drawing("day")] })).toBe("Operation ID already used");
    expect(refusal(doc, { type: "addSheet", opId: "constructor", after: null, kind: "plan", drawings: [drawing("day")] })).toBe("Invalid operation ID");
  });

  it("moveSheet reorders, writing only the moved row", () => {
    const doc = run(flat(), { type: "setSheet", sheetId: "auto/0", title: "T" });
    const moved = (sheetId: string, index: number): Document => asOnePatch(doc, { type: "moveSheet", sheetId, index });
    expect(ids(moved("auto/2", 0))).toEqual(["auto/2", "auto/0", "auto/1"]);
    expect(shown(moved("auto/2", 0), "auto/2")?.order).toBe(-1);
    expect(ids(moved("auto/0", 1))).toEqual(["auto/1", "auto/0", "auto/2"]);
    expect(shown(moved("auto/0", 1), "auto/0")?.order).toBe(1.5);
    expect(ids(moved("auto/0", 2))).toEqual(["auto/1", "auto/2", "auto/0"]);
    expect(unwrap(execute(doc, { type: "moveSheet", sheetId: "auto/2", index: 0 })).patch.puts.map((p) => p.entity.id)).toEqual(["auto/2"]);
    for (const index of [-1, 3, 0.5]) expect(refusal(doc, { type: "moveSheet", sheetId: "auto/0", index })).toBe("That place isn't in the list");
    expect(refusal(doc, { type: "moveSheet", sheetId: "nope", index: 0 })).toBe("Sheet not found");
  });

  it("when no number lies between two neighbours, every row is renumbered", () => {
    const next = (x: number): number => x + 2 ** -52;
    const tight = withRows(flat(), row("a", 1, [drawing("day")]), row("b", next(1), [drawing("day")]), row("c", 5, [drawing("day")]));
    const r = run(tight, { type: "moveSheet", sheetId: "c", index: 1 });
    expect(ids(r)).toEqual(["a", "c", "b"]);
    expect(sheetsOf(r).map((s) => s.order)).toEqual([0, 1, 2]);
    // Two clients placing in one gap at once leave a tie; the next edit there separates them.
    const tied = withRows(flat(), row("a", 1, [drawing("day")]), row("b", 1, [drawing("day")]));
    const added = run(tied, { type: "addSheet", opId: "op", after: "a", kind: "plan", drawings: [drawing("day")] });
    expect(ids(added)).toEqual(["a", "op/t0", "b"]);
    expect(sheetsOf(added).map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("deleteSheet removes", () => {
    const doc = flat();
    const next = asOnePatch(doc, { type: "deleteSheet", sheetId: "auto/1" });
    expect(ids(next)).toEqual(["auto/0", "auto/2"]);
    expect(next.sheets["auto/1"]).toBeUndefined();
    const again = asOnePatch(next, { type: "deleteSheet", sheetId: "auto/0" });
    expect(ids(again)).toEqual(["auto/2"]);
    expect(refusal(doc, { type: "deleteSheet", sheetId: "nope" })).toBe("Sheet not found");
  });

  it("deleting the last sheet is refused, stored or automatic, since no rows means automatic", () => {
    const stored = withRows(flat(), row("only", 0, [drawing("day")]));
    expect(refusal(stored, { type: "deleteSheet", sheetId: "only" })).toBe("A project keeps at least one sheet");
    expect(refusal(layouts(rectDoc(0, 0, 6, 4), ["day", "Day"]), { type: "deleteSheet", sheetId: "auto/0" })).toBe("A project keeps at least one sheet");
  });

  it("setSheet changes the fields given and no others", () => {
    const doc = flat();
    const next = asOnePatch(doc, { type: "setSheet", sheetId: "auto/0", inPdf: false, title: "T", scale: 50, split: "sideBySide", cx: 1.5, cy: -2, finishes: false, size: "small" });
    expect(shown(next, "auto/0")).toEqual({ id: "auto/0", kind: "plan", order: 0, inPdf: false, title: "T", scale: 50, split: "sideBySide", cx: 1.5, cy: -2, finishes: false, marks: true, drawings: flatDrawings([drawing("day")]), text: "", size: "small", section: null });
    expect(shown(run(next, { type: "setSheet", sheetId: "auto/0", scale: null }), "auto/0")?.scale).toBeNull();
    expect(refusal(doc, { type: "setSheet", sheetId: "nope", title: "T" })).toBe("Sheet not found");
  });

  it("setSheet turns a plan into a compare and back, as one change with its drawings", () => {
    const doc = flat();
    const compare = run(doc, { type: "setSheet", sheetId: "auto/0", kind: "compare", drawings: [drawing("day"), drawing("night"), drawing("guests")] });
    expect(shown(compare, "auto/0")?.drawings).toEqual({ l0: "day", d0: null, l1: "night", d1: null, l2: "guests", d2: null, l3: null, d3: null });
    expect(shown(run(compare, { type: "setSheet", sheetId: "auto/0", kind: "plan", drawings: [drawing("night")] }), "auto/0")?.kind).toBe("plan");
    expect(refusal(doc, { type: "setSheet", sheetId: "auto/0", kind: "compare" })).toBe("A compare sheet holds 2 to 4 drawings");
  });

  it("setSheetsInPdf ticks or clears every sheet, in one step", () => {
    const doc = flat();
    const none = asOnePatch(doc, { type: "setSheetsInPdf", on: false });
    expect(sheetsOf(none).map((s) => s.inPdf)).toEqual([false, false, false]);
    const one = run(none, { type: "setSheet", sheetId: "auto/1", inPdf: true });
    const { doc: all, patch } = unwrap(execute(one, { type: "setSheetsInPdf", on: true }));
    expect(sheetsOf(all).map((s) => s.inPdf)).toEqual([true, true, true]);
    expect(patch.puts.map((p) => p.entity.id)).toEqual(["auto/0", "auto/2"]); // only the rows that change
  });
});

describe("refusals", () => {
  const doc = flat();
  const set = (over: Omit<Extract<Command, { type: "setSheet" }>, "type" | "sheetId">): string | null => refusal(doc, { type: "setSheet", sheetId: "auto/0", ...over });

  it("a scale outside the list is refused", () => {
    expect([...SHEET_SCALES]).toEqual([20, 25, 50, 75, 100, 200]);
    for (const scale of SHEET_SCALES) expect(set({ scale })).toBeNull();
    for (const scale of [37, 0, -50, 1 / 50]) expect(set({ scale })).toBe("Scale must be 1:20, 1:25, 1:50, 1:75, 1:100 or 1:200");
  });

  it("over 20,000 characters is refused", () => {
    expect(MAX_SHEET_TEXT).toBe(20000);
    const report: Command = { type: "addSheet", opId: "op", after: null, kind: "report", drawings: [], text: "x".repeat(20000) };
    expect(refusal(doc, report)).toBeNull();
    expect(refusal(doc, { ...report, text: "x".repeat(20001) })).toBe("A report's text can be at most 20,000 characters");
  });

  it("a compare with 1 or 5 drawings is refused", () => {
    const compare = (n: number): Command => ({ type: "addSheet", opId: "op", after: null, kind: "compare", drawings: Array.from({ length: n }, () => drawing("day")) });
    for (const n of [2, 3, 4]) expect(refusal(doc, compare(n))).toBeNull();
    for (const n of [0, 1, 5]) expect(refusal(doc, compare(n))).toBe("A compare sheet holds 2 to 4 drawings");
  });

  it("each other kind holds its own number of drawings", () => {
    const add = (kind: Sheet["kind"], n: number): Command => ({ type: "addSheet", opId: "op", after: null, kind, drawings: Array.from({ length: n }, () => drawing("day")) });
    expect(refusal(doc, add("plan", 2))).toBe("A plan sheet holds one drawing");
    expect(refusal(doc, add("plan", 5))).toBe("A plan sheet holds one drawing");
    expect(refusal(doc, add("cover", 0))).toBe("A cover holds one drawing");
    expect(refusal(doc, add("report", 1))).toBe("A report holds no drawing");
  });

  it("a drawing naming a missing layout or deck is refused", () => {
    const add = (d: SheetDrawing): Command => ({ type: "addSheet", opId: "op", after: null, kind: "plan", drawings: [d] });
    expect(refusal(doc, add(drawing("nope")))).toBe("Layout not found");
    expect(refusal(doc, add(drawing("day", "nope")))).toBe("Deck not found");
    expect(refusal(doc, add(drawing("constructor")))).toBe("Invalid ID");
    expect(refusal(doc, add(drawing("day", "__proto__")))).toBe("Invalid ID");
    expect(set({ drawings: [drawing("nope")] })).toBe("Layout not found");
  });

  it("a title over the name limit is refused", () => {
    expect(set({ title: "x".repeat(MAX_NAME_CHARS) })).toBeNull();
    expect(set({ title: "x".repeat(MAX_NAME_CHARS + 1) })).toBe("Name too long");
  });

  it("a framing that isn't a finite number is refused", () => {
    expect(set({ cx: Number.NaN })).toBe("Invalid sheet");
    expect(set({ cy: Number.POSITIVE_INFINITY })).toBe("Invalid sheet");
  });
});

describe("validateDocument: I8 and I23", () => {
  const broken = (over: Partial<Sheet>): string[] => {
    const r = validateDocument(withRows(flat(), row("s", 0, [drawing("day")], over)));
    return r.ok ? [] : r.error.map((v) => v.invariant);
  };

  it("a good row passes, and every bad one fails", () => {
    expect(broken({})).toEqual([]);
    expect(broken({ scale: 37 })).toEqual(["I23"]);
    expect(broken({ text: "x".repeat(20001) })).toEqual(["I23"]);
    expect(broken({ kind: "compare" })).toEqual(["I23"]);
    expect(broken({ drawings: flatDrawings([drawing("gone")]) })).toEqual(["I23"]);
    expect(broken({ drawings: flatDrawings([drawing("day", "gone")]) })).toEqual(["I23"]);
    expect(broken({ drawings: { ...flatDrawings([drawing("day")]), d2: "day" } })).toEqual(["I23"]); // a deck with no layout
    expect(broken({ kind: "compare", drawings: { ...flatDrawings([drawing("day")]), l2: "day" } })).toEqual(["I23"]); // a gap
    expect(broken({ title: "x".repeat(MAX_NAME_CHARS + 1) })).toEqual(["I8"]);
  });

  it("a server rejection reads as something just removed: only a race gets a bad row past a command", () => {
    const r = validateDocument(withRows(flat(), row("s", 0, [drawing("gone")])));
    expect(r.ok ? "" : topologyMessage(r.error)).toBe("This edit needs something that was just removed");
  });

  it("parseSheet takes exact fields, each flat", () => {
    const good = row("s", 0, [drawing("day"), drawing("night", "loft")]);
    expect(parseSheet(good)).toEqual(good);
    expect(parseSheet({ ...good, extra: 1 })).toBeNull();
    expect(parseSheet({ ...good, drawings: [{ layout: "day", deck: null }] })).toBeNull();
    expect(parseSheet({ ...good, drawings: { ...good.drawings, l4: null } })).toBeNull();
    expect(parseSheet({ ...good, kind: "elevation" })).toBeNull();
    expect(parseSheet({ ...good, split: "grid" })).toBeNull();
    expect(parseSheet({ ...good, size: "huge" })).toBeNull();
    expect(parseSheet({ ...good, scale: "1:50" })).toBeNull();
    expect(parseSheet({ ...good, order: Number.NaN })).toBeNull();
    expect(parseSheet({ ...good, id: "constructor" })).toBeNull();
  });
});

describe("deleting what a sheet draws", () => {
  const stored = (doc: Document, ...rows: Sheet[]): Document => withRows(doc, ...rows);

  it("deleting a layout strips its drawings, in one patch, and undoes as one", () => {
    const doc = stored(
      flat(),
      row("plan-day", 0, [drawing("day")]),
      row("plan-night", 1, [drawing("night")]),
      row("three", 2, [drawing("day"), drawing("night"), drawing("guests")]),
      row("two", 3, [drawing("day"), drawing("guests")], { split: "stacked" }),
    );
    const { doc: next, patch } = unwrap(execute(doc, { type: "deleteState", stateId: "day" }));
    expect(ids(next)).toEqual(["plan-night", "three", "two"]);
    expect(shown(next, "three")).toMatchObject({ kind: "compare", order: 2 });
    expect(sheetDrawings(shown(next, "three") ?? row("x", 0, []))).toEqual([drawing("night"), drawing("guests")]);
    expect(shown(next, "two")).toMatchObject({ kind: "plan", order: 3, split: "stacked" });
    expect(sheetDrawings(shown(next, "two") ?? row("x", 0, []))).toEqual([drawing("guests")]);
    expect(patch.deletes).toEqual(expect.arrayContaining([{ table: "states", id: "day" }, { table: "sheets", id: "plan-day" }]));
    expect(patch.puts.map((p) => p.entity.id).sort()).toEqual(["three", "two"]);
    expect(patch.dependencies).toEqual(expect.arrayContaining([{ table: "sheets", id: "plan-day" }, { table: "sheets", id: "three" }, { table: "sheets", id: "two" }]));
    expect(unwrap(applyPatch(next, invertPatch(patch)))).toEqual(doc);
    expect(validateDocument(next).ok).toBe(true);
  });

  it("a row that doesn't draw it isn't written", () => {
    const doc = stored(flat(), row("a", 0, [drawing("night")]), row("b", 1, [drawing("guests")]));
    const { patch } = unwrap(execute(doc, { type: "deleteState", stateId: "day" }));
    expect(patch.puts).toEqual([]);
    expect(patch.deletes).toEqual([{ table: "states", id: "day" }]);
  });

  it("an automatic list has no rows to strip, and follows", () => {
    const next = run(flat(), { type: "deleteState", stateId: "day" });
    expect(next.sheets).toEqual({});
    expect(sheetsOf(next).map((s) => s.title)).toEqual(["Night", "Guests"]);
  });

  it("a delete that empties the list returns it to automatic", () => {
    const doc = stored(flat(), row("only", 0, [drawing("day")]));
    const next = asOnePatch(doc, { type: "deleteState", stateId: "day" });
    expect(next.sheets).toEqual({});
    expect(ids(next)).toEqual(["auto/0", "auto/1"]);
  });

  it("deleting a deck does the same for its level", () => {
    const solo = withDeck(layouts(tinyHouse(), ["day", "Day"], ["night", "Night"]), { id: "loft", name: "Loft", at: [4, 1.25], w: 1.2, d: 2, top: 2.05, solid: false });
    const doc = stored(
      solo,
      row("floor", 0, [drawing("day")]),
      row("up", 1, [drawing("day", "loft")]),
      row("both", 2, [drawing("day"), drawing("day", "loft")]),
      row("three", 3, [drawing("day"), drawing("night"), drawing("night", "loft")]),
    );
    const next = asOnePatch(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "loft" }] });
    expect(ids(next)).toEqual(["floor", "both", "three"]);
    expect(shown(next, "both")?.kind).toBe("plan");
    expect(sheetDrawings(shown(next, "both") ?? row("x", 0, []))).toEqual([drawing("day")]);
    expect(sheetDrawings(shown(next, "three") ?? row("x", 0, []))).toEqual([drawing("day"), drawing("night")]);
    expect(validateDocument(next).ok).toBe(true);
  });

  it("one of two decks at a level re-points to the other", () => {
    const doc = stored(twinLofts(), row("floor", 0, [drawing("day")]), row("up", 1, [drawing("day", "left")]), row("other", 2, [drawing("day", "right")]));
    const { doc: next, patch } = unwrap(execute(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "left" }] }));
    expect(ids(next)).toEqual(["floor", "up", "other"]);
    expect(sheetDrawings(shown(next, "up") ?? row("x", 0, []))).toEqual([drawing("day", "right")]);
    expect(patch.puts.map((p) => p.entity.id)).toEqual(["up"]);
    expect(unwrap(applyPatch(next, invertPatch(patch)))).toEqual(doc);
  });

  it("both decks of a level at once: nothing left to re-point to", () => {
    const doc = stored(twinLofts(), row("floor", 0, [drawing("day")]), row("up", 1, [drawing("day", "left")]));
    const next = run(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "left" }, { table: "decks", id: "right" }] });
    expect(ids(next)).toEqual(["floor"]);
  });

  it("a cover is re-pointed, not removed", () => {
    const cover = row("cover", 0, [drawing("day", "left")], { kind: "cover" });
    const doc = stored(twinLofts(), cover, row("report", 1, [], { kind: "report", text: "# Hello" }));
    const noLayout = run(doc, { type: "deleteState", stateId: "day" });
    expect(sheetDrawings(shown(noLayout, "cover") ?? row("x", 0, []))).toEqual([drawing("night", "left")]);
    const sibling = run(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "left" }] });
    expect(sheetDrawings(shown(sibling, "cover") ?? row("x", 0, []))).toEqual([drawing("day", "right")]);
    const floor = run(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "left" }, { table: "decks", id: "right" }] });
    expect(sheetDrawings(shown(floor, "cover") ?? row("x", 0, []))).toEqual([drawing("day")]);
    expect(shown(floor, "cover")?.kind).toBe("cover");
    expect(shown(floor, "report")?.text).toBe("# Hello"); // a report draws nothing, so it stays
  });

  it("deleting rows through deleteEntities is refused: a sheet goes with its own command", () => {
    const doc = stored(flat(), row("a", 0, [drawing("day")]));
    expect(refusal(doc, { type: "deleteEntities", ids: [{ table: "sheets", id: "a" }] })).toBe("Sheets are removed with their own command");
  });
});

describe("a loft sunk below the cut", () => {
  it("draws the floor: pinned, not an error", () => {
    const up = withDeck(layouts(tinyHouse(), ["day", "Day"]), { id: "loft", name: "Loft", at: [4, 1.25], w: 1.2, d: 2, top: 2.05, solid: false });
    const doc = withRows(up, row("up", 0, [drawing("day", "loft")]));
    const sunk = run(doc, { type: "setDeck", deckId: "loft", top: 0.45, solid: true });
    expect(validateDocument(sunk).ok).toBe(true);
    expect(sheetDrawings(shown(sunk, "up") ?? row("x", 0, []))).toEqual([drawing("day", "loft")]);
    expect(levelOf(sunk, "loft").deckIds).toEqual([]); // levelOf falls back to the floor
    // Deleted while sunk, the sheet already draws the floor, so it stays at the floor.
    const gone = run(sunk, { type: "deleteEntities", ids: [{ table: "decks", id: "loft" }] });
    expect(sheetDrawings(shown(gone, "up") ?? row("x", 0, []))).toEqual([drawing("day")]);
  });
});

describe("stored documents", () => {
  const file = (): Record<string, unknown> => {
    const json: Record<string, unknown> = { ...serialize(flat()) };
    delete json.sheets;
    return json;
  };

  it("loads a document with no sheets table", () => {
    expect(unwrap(deserialize(file())).sheets).toEqual({});
    expect(ids(unwrap(deserialize(file())))).toEqual(["auto/0", "auto/1", "auto/2"]);
    const stored = parseStoredDocument(file(), "empty");
    if (!stored) throw new Error("unparseable");
    expect(unwrap(fromStored(upgradeStored(stored))).sheets).toEqual({});
  });

  it("a sheet row round-trips", () => {
    const doc = run(flat(), { type: "addSheet", opId: "op", after: "auto/0", kind: "compare", drawings: [drawing("day"), drawing("night")], title: "Day and night", scale: 50, split: "stacked", cx: 0.5, cy: -0.5 });
    const back = unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))));
    expect(back).toEqual(doc);
    expect(ids(back)).toEqual(ids(doc));
  });

  it("refuses a malformed row", () => {
    const bad = { ...file(), sheets: { s: { id: "s", kind: "plan" } } };
    expect(deserialize(bad).ok).toBe(false);
  });
});

describe("addSheet's first (sheetset.70)", () => {
  const cover = { type: "addSheet", opId: "c", kind: "cover", drawings: [drawing("day")], first: true } as const;

  it("puts the new sheet at the head, writing the automatic rows behind it, as one patch", () => {
    expect(ids(asOnePatch(flat(), { ...cover, after: null }))).toEqual(["c/t0", "auto/0", "auto/1", "auto/2"]);
  });

  it("goes before a stored list, whatever `after` says", () => {
    const stored = run(flat(), { type: "addSheet", opId: "r", after: null, kind: "report", drawings: [] });
    expect(ids(run(stored, { ...cover, after: "auto/1" }))).toEqual(["c/t0", "auto/0", "auto/1", "auto/2", "r/t0"]);
  });
});
