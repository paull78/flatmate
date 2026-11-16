import { describe, expect, it } from "vitest";
import { parseStoredDocument, unwrap, validateChangeset, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { MESSAGES, invariantsMessage } from "../src/errors";
import { MIN_SECTION_LENGTH, SECTION_LETTERS, type Document, type Section } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { sectionLabel, sectionsOf } from "../src/queries/sections";
import { deserialize, serialize, upgradeStored } from "../src/serialize";
import { fromStored } from "../src/shape-tables";
import { parseSection } from "../src/shape-sections";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// Sections as shared rows (section.09): the letter is the row's ID, so two people taking B at once clash as any edit of
// one row does. No rule reads walls or pieces, so nothing else can make a section invalid.

const room = rectDoc(0, 0, 6, 4);
const add = (extra: Partial<Extract<Command, { type: "addSection" }>> = {}): Command => ({ type: "addSection", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: 1, ...extra });
const del = (id: string): Command => ({ type: "deleteEntities", ids: [{ table: "sections", id }] });
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const letters = (doc: Document): string[] => Object.keys(doc.sections).sort();
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const withRow = (row: Section, key = row.id): Document => ({ ...room, sections: { [key]: row } });
const violations = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => `${v.invariant}: ${v.message}`);
};
const lineOf = (a: Point, b: Point): Section => ({ id: "A", a, b, side: 1, depth: null });
const row: Section = lineOf({ x: 1, y: 2 }, { x: 5, y: 2 });

describe("letters", () => {
  it("addSection takes the first free letter", () => {
    const ab = run(room, add(), add());
    expect(letters(ab)).toEqual(["A", "B"]);
    const abc = run(ab, add());
    const bc = run(abc, del("A"));
    expect(letters(bc)).toEqual(["B", "C"]);
    expect(bc.sections["C"]).toEqual(abc.sections["C"]); // C stays C
    expect(letters(run(bc, add()))).toEqual(["A", "B", "C"]);
    expect(letters(run(abc, del("B"), add()))).toEqual(["A", "B", "C"]);
  });

  it("a 27th section is refused, and a freed letter is taken again", () => {
    const full = run(room, ...[...SECTION_LETTERS].map(() => add()));
    expect(letters(full)).toEqual([...SECTION_LETTERS]);
    expect(letters(full).at(-1)).toBe("Z");
    expect(refusal(full, add())).toBe(MESSAGES.sectionsFull);
    expect(letters(run(full, del("M"), add()))).toEqual([...SECTION_LETTERS]);
  });

  it("a new row depends on its own letter only, so two people taking it clash and nothing else does", () => {
    const { doc, patch } = unwrap(execute(run(room, add()), add()));
    expect(patch.dependencies).toEqual([{ table: "sections", id: "B" }]);
    expect(patch.puts).toEqual([{ table: "sections", entity: doc.sections["B"] }]);
    expect(patch.deletes).toEqual([]);
  });

  it("a section is whole by default, with the side it's given; a depth is kept, Zero included", () => {
    const doc = run(room, add(), add({ side: -1, depth: 1.5 }), add({ depth: 0 }));
    expect(doc.sections["A"]).toEqual({ id: "A", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: 1, depth: null });
    expect(doc.sections["B"]).toEqual({ id: "B", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: -1, depth: 1.5 });
    expect(doc.sections["C"]?.depth).toBe(0);
  });

  it("a new row is kept to the millimetre", () => {
    const doc = run(room, add({ a: { x: 1.00049, y: -0.0001 }, b: { x: 5, y: 2 }, depth: 1.23449 }));
    expect(doc.sections["A"]).toEqual({ id: "A", a: { x: 1, y: 0 }, b: { x: 5, y: 2 }, side: 1, depth: 1.234 });
    expect(Object.is(doc.sections["A"]?.a.y, 0)).toBe(true); // not -0, which would differ after the wire
  });

  it("the queries read the rows in letter order, and the label has the letter twice", () => {
    const doc = run(room, add(), add(), add(), del("B"), add({ side: -1 }));
    expect(sectionsOf(doc).map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(sectionLabel("B")).toBe("B–B");
  });
});

describe("the line", () => {
  const along = (length: number): Command => add({ a: { x: 1, y: 2 }, b: { x: 1 + length, y: 2 } });

  it("a line under 0.50 m is refused, and exactly 0.50 accepted", () => {
    expect(MIN_SECTION_LENGTH).toBe(0.5);
    expect(refusal(room, along(0.49))).toBe(MESSAGES.sectionLine);
    expect(refusal(room, along(0.499))).toBe(MESSAGES.sectionLine);
    expect(refusal(room, along(0))).toBe(MESSAGES.sectionLine);
    expect(refusal(room, along(0.5))).toBe("accepted");
    expect(refusal(room, add({ a: { x: 1, y: 1 }, b: { x: 1.3, y: 1.4 } }))).toBe("accepted"); // on a slant too
  });

  it("float noise doesn't refuse a 0.50 line: 0.7 − 0.2 is under 0.5 in floats", () => {
    expect(0.7 - 0.2).toBeLessThan(0.5);
    expect(refusal(room, add({ a: { x: 0.2, y: 1 }, b: { x: 0.7, y: 1 } }))).toBe("accepted");
    expect(violations(withRow(lineOf({ x: 0.2, y: 1 }, { x: 0.7, y: 1 })))).toEqual([]);
  });

  it("a refused line stores nothing", () => {
    const r = execute(room, along(0.2));
    expect(r.ok).toBe(false);
    expect(room.sections).toEqual({});
  });

  it("addSection refuses a bad point, side or depth from JSON", () => {
    const json = (fields: object): Command => JSON.parse(JSON.stringify({ ...add(), ...fields }));
    expect(refusal(room, json({ a: null }))).toBe("Invalid position");
    expect(refusal(room, json({ b: { x: "1", y: 2 } }))).toBe("Invalid position");
    expect(refusal(room, add({ a: { x: Number.NaN, y: 2 } }))).toBe("Invalid position");
    expect(refusal(room, json({ side: 2 }))).toBe("A section looks to one side of its line: 1 or -1");
    expect(refusal(room, json({ depth: "1" }))).toBe("Invalid depth");
    expect(refusal(room, add({ depth: Number.NaN }))).toBe("Invalid depth");
    expect(refusal(room, add({ depth: -0.1 }))).toBe(MESSAGES.sectionDepth);
  });
});

describe("setSection", () => {
  const doc = run(room, add(), add({ side: -1, depth: 2 }));

  it("setSection changes only what it's given", () => {
    const b = doc.sections["B"];
    expect(run(doc, { type: "setSection", sectionId: "B", a: { x: 0.5, y: 1 } }).sections["B"]).toEqual({ ...b, a: { x: 0.5, y: 1 } });
    expect(run(doc, { type: "setSection", sectionId: "B", b: { x: 4, y: 1 } }).sections["B"]).toEqual({ ...b, b: { x: 4, y: 1 } });
    expect(run(doc, { type: "setSection", sectionId: "B", side: 1 }).sections["B"]).toEqual({ ...b, side: 1 });
    expect(run(doc, { type: "setSection", sectionId: "B", depth: 0 }).sections["B"]).toEqual({ ...b, depth: 0 });
    expect(run(doc, { type: "setSection", sectionId: "B", depth: null }).sections["B"]).toEqual({ ...b, depth: null });
    expect(run(doc, { type: "setSection", sectionId: "B", side: 1 }).sections["A"]).toBe(doc.sections["A"]);
  });

  it("depends on its own row only, and the same value writes nothing", () => {
    const { patch } = unwrap(execute(doc, { type: "setSection", sectionId: "B", depth: 3 }));
    expect(patch.dependencies).toEqual([{ table: "sections", id: "B" }]);
    expect(patch.puts.map((p) => p.entity.id)).toEqual(["B"]);
    const same = unwrap(execute(doc, { type: "setSection", sectionId: "B", side: -1, depth: 2 }));
    expect(same.doc).toBe(doc);
    expect(same.patch.puts).toEqual([]);
  });

  it("keeps a new line and depth to the millimetre", () => {
    const next = run(doc, { type: "setSection", sectionId: "B", a: { x: 0.12345, y: 1 }, depth: 2.34567 });
    expect(next.sections["B"]?.a).toEqual({ x: 0.123, y: 1 });
    expect(next.sections["B"]?.depth).toBe(2.346);
  });

  it("refuses a too-short line, a bad side, a negative depth, and a row that isn't there", () => {
    expect(refusal(doc, { type: "setSection", sectionId: "A", b: { x: 1.2, y: 2 } })).toBe(MESSAGES.sectionLine);
    const flip: Command = JSON.parse(JSON.stringify({ type: "setSection", sectionId: "A", side: 0 }));
    expect(refusal(doc, flip)).toBe("A section looks to one side of its line: 1 or -1");
    expect(refusal(doc, { type: "setSection", sectionId: "A", depth: -1 })).toBe(MESSAGES.sectionDepth);
    expect(refusal(doc, { type: "setSection", sectionId: "Z", side: 1 })).toBe("Section not found");
    expect(refusal(doc, { type: "setSection", sectionId: "constructor", side: 1 })).toBe("Invalid ID");
  });
});

describe("deleting and undoing", () => {
  const doc = run(room, add(), add({ side: -1, depth: 2 }), add());

  it("undo of a delete restores the section with its letter", () => {
    const { doc: without, patch } = unwrap(execute(doc, del("B")));
    expect(letters(without)).toEqual(["A", "C"]);
    expect(patch.deletes).toEqual([{ table: "sections", id: "B" }]);
    expect(patch.puts).toEqual([]);
    expect(patch.dependencies).toEqual([{ table: "sections", id: "B" }]);
    expect(applyPatch(without, invertPatch(patch))).toEqual({ ok: true, value: doc });
  });

  it("undo of an add takes its letter back, and of an edit restores the row", () => {
    const added = unwrap(execute(doc, add()));
    expect(applyPatch(added.doc, invertPatch(added.patch))).toEqual({ ok: true, value: doc });
    const flipped = unwrap(execute(doc, { type: "setSection", sectionId: "A", side: -1 }));
    expect(applyPatch(flipped.doc, invertPatch(flipped.patch))).toEqual({ ok: true, value: doc });
  });

  it("a letter that isn't there can't be deleted", () => {
    expect(refusal(doc, del("Q"))).toBe("Section not found");
  });
});

describe("files and the wire", () => {
  it("an old file with no sections table loads with none", () => {
    const old = JSON.parse(JSON.stringify(serialize(room)));
    delete old.sections;
    expect(Object.hasOwn(old, "sections")).toBe(false);
    const loaded = unwrap(deserialize(old));
    expect(loaded.sections).toEqual({});
    expect(loaded).toEqual(room);
    // As the server reads it: missing tables empty, then the upgrade.
    const stored = parseStoredDocument(old, "empty");
    expect(stored).not.toBeNull();
    if (stored) expect(unwrap(fromStored(upgradeStored(stored))).sections).toEqual({});
  });

  it("a file's sections survive, in letter order", () => {
    const doc = run(room, add(), add({ side: -1, depth: 0 }), del("A"), add()); // A's row is written after B's
    expect(Object.keys(doc.sections)).toEqual(["B", "A"]);
    const json = JSON.parse(JSON.stringify(serialize(doc)));
    expect(Object.keys(json.sections)).toEqual(["A", "B"]);
    expect(deserialize(json)).toEqual({ ok: true, value: doc });
  });

  it("a file with a bad sections table or row doesn't load", () => {
    const json = JSON.parse(JSON.stringify(serialize(room)));
    expect(deserialize({ ...json, sections: [] })).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid sections table" } });
    expect(deserialize({ ...json, sections: { A: { ...row, side: 2 } } })).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid sections entry A" } });
    expect(deserialize({ ...json, sections: { B: row } })).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid sections entry B" } });
    expect(deserialize({ ...json, sections: { A: { ...row, a: { x: 1, y: 2 }, b: { x: 1.1, y: 2 } } } })).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("the row passes the wire's check, and a patch can't carry a bad one", () => {
    const { patch } = unwrap(execute(room, add()));
    expect(validateChangeset({ id: "c1", patch: { puts: patch.puts, deletes: patch.deletes }, expect: [{ table: "sections", id: "A", lastCs: null }] }).ok).toBe(true);
    expect(applyPatch(room, patch)).toMatchObject({ ok: true });
    const bad = { puts: [{ table: "sections" as const, entity: { ...row, side: 2 } }], deletes: [] };
    expect(applyPatch(room, bad).ok).toBe(false);
  });

  it.each([
    ["a good row", row, true],
    ["whole depth", { ...row, depth: null }, true],
    ["Zero", { ...row, depth: 0 }, true],
    ["the other side", { ...row, side: -1 }, true],
    ["an extra key", { ...row, name: "x" }, false],
    ["no depth", { id: "A", a: row.a, b: row.b, side: 1 }, false],
    ["no side", { id: "A", a: row.a, b: row.b, depth: null }, false],
    ["no id", { a: row.a, b: row.b, side: 1, depth: null, x: 1 }, false],
    ["a bad id", { ...row, id: "a b" }, false],
    ["an extra key on a point", { ...row, a: { x: 1, y: 2, z: 3 } }, false],
    ["a missing coordinate", { ...row, b: { x: 1 } }, false],
    ["a string coordinate", { ...row, b: { x: "1", y: 2 } }, false],
    ["an infinite coordinate", { ...row, a: { x: Infinity, y: 2 } }, false],
    ["side 0", { ...row, side: 0 }, false],
    ["side as a string", { ...row, side: "1" }, false],
    ["depth as a string", { ...row, depth: "1" }, false],
    ["an infinite depth", { ...row, depth: Infinity }, false],
    ["not an object", 3, false],
    ["null", null, false],
  ])("parseSection: %s", (_name, value, good) => {
    expect(parseSection(value)).toEqual(good ? value : null);
  });
});

describe("I25", () => {
  const i25 = (doc: Document): string[] => violations(doc).filter((v) => v.startsWith("I25"));

  it("a good row passes", () => {
    expect(violations(withRow(row))).toEqual([]);
    expect(violations(withRow({ ...row, depth: 0 }))).toEqual([]);
    expect(violations(withRow({ ...row, id: "Z" }))).toEqual([]);
  });

  it.each(["a", "AA", "AB", "1", "A/0", "-"])("validate refuses a section whose id isn't one capital letter: %s", (id) => {
    expect(i25(withRow({ ...row, id }))).toEqual([`I25: ${MESSAGES.sectionLetter}`]);
  });

  it("validate refuses a section too short", () => {
    expect(i25(withRow(lineOf({ x: 1, y: 2 }, { x: 1.49, y: 2 })))).toEqual([`I25: ${MESSAGES.sectionLine}`]);
    expect(i25(withRow(lineOf({ x: 1, y: 2 }, { x: 1.5, y: 2 })))).toEqual([]);
  });

  it("validate refuses a negative depth", () => {
    expect(i25(withRow({ ...row, depth: -0.01 }))).toEqual([`I25: ${MESSAGES.sectionDepth}`]);
  });

  it("names the row in its entities", () => {
    const r = validateDocument(withRow({ ...row, depth: -1 }));
    expect(r.ok ? [] : r.error.flatMap((v) => v.entities)).toEqual([{ table: "sections", id: "A" }]);
  });

  it("a row under another letter's key is I8", () => {
    expect(violations(withRow(row, "B"))).toEqual(["I8: sections B: invalid fields"]);
  });

  it("a server's refusal, which carries no names, has its own words", () => {
    expect(invariantsMessage(new Set(["I25"]))).toBe(MESSAGES.section);
  });

  it("no rule reads anything else: a section needs no walls", () => {
    const empty = { ...rectDoc(0, 0, 6, 4), joints: {}, walls: {} };
    expect(violations({ ...empty, sections: { A: { ...row, a: { x: 100, y: 100 }, b: { x: 200, y: 100 } } } })).toEqual([]);
  });
});
