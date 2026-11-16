import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { CEILING_ID, type Deck, type Document, sameGuards } from "../src/model";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// addDeck, setDeck and deleting a deck (spec "The deck", decks.13, .16, .21): presets, overrides and names resolve
// in the domain; values are kept to the millimetre and whole degrees; every result is checked by I18.

const house = tinyHouse();
const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const add = (opId: string, extra: Partial<Extract<Command, { type: "addDeck" }>> = {}): Command => ({ type: "addDeck", opId, preset: "loft", at: { x: 4.5, y: 1.25 }, ...extra });

describe("addDeck", () => {
  it("uses the preset: name, top and solid flag, the default 2.00 × 1.40 size, unrotated", () => {
    const loft = run(house, add("op")).decks["op/k0"];
    expect(loft).toEqual({ id: "op/k0", name: "Loft", at: { x: 4.5, y: 1.25 }, w: 2, d: 1.4, rotation: 0, top: 2.15, solid: false, finish: null, ...sameGuards("railing") });
    const platform = run(house, add("op", { preset: "platform" })).decks["op/k0"];
    expect(platform).toEqual({ id: "op/k0", name: "Platform", at: { x: 4.5, y: 1.25 }, w: 2, d: 1.4, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") });
  });

  it("overrides beat the preset", () => {
    const doc = run(house, add("op", { name: "Bench", w: 1.5, d: 0.5, rotation: 90, top: 0.6, solid: true }));
    expect(doc.decks["op/k0"]).toEqual({ id: "op/k0", name: "Bench", at: { x: 4.5, y: 1.25 }, w: 1.5, d: 0.5, rotation: 90, top: 0.6, solid: true, finish: null, ...sameGuards("none") });
  });

  it("names Loft 2 when Loft is taken, then Loft 3; another preset starts at its own name", () => {
    let doc = run(house, add("a", { at: { x: 3, y: 1.25 }, w: 1 }));
    doc = run(doc, add("b", { at: { x: 4, y: 1.25 }, w: 1 }));
    doc = run(doc, add("c", { at: { x: 5, y: 1.25 }, w: 1 }));
    doc = run(doc, add("d", { at: { x: 6, y: 1.25 }, w: 1, preset: "platform" }));
    expect(["a", "b", "c", "d"].map((op) => doc.decks[`${op}/k0`]?.name)).toEqual(["Loft", "Loft 2", "Loft 3", "Platform"]);
  });

  it("a name freed by renaming is reused", () => {
    let doc = run(house, add("a", { at: { x: 3, y: 1.25 }, w: 1 }));
    doc = run(doc, { type: "setDeck", deckId: "a/k0", name: "Sleeping loft" });
    expect(run(doc, add("b", { at: { x: 4, y: 1.25 }, w: 1 })).decks["b/k0"]?.name).toBe("Loft");
  });

  it("rounds to the millimetre and the rotation to whole degrees (decks.21)", () => {
    const doc = run(house, add("op", { at: { x: 4.12345, y: 1.23456 }, w: 1.23456, d: 0.98765, top: 2.15049, rotation: 30.4 }));
    expect(doc.decks["op/k0"]).toMatchObject({ at: { x: 4.123, y: 1.235 }, w: 1.235, d: 0.988, top: 2.15, rotation: 30 });
    expect(run(house, add("op", { rotation: 359.6 })).decks["op/k0"]?.rotation).toBe(0);
    expect(run(house, add("op", { rotation: -90 })).decks["op/k0"]?.rotation).toBe(270);
    expect(run(house, add("op", { rotation: 450 })).decks["op/k0"]?.rotation).toBe(90);
  });

  it("is refused by I18 with its text", () => {
    expect(refusal(house, add("op", { at: { x: 10, y: 10 } }))).toBe("Loft must lie over the building");
    expect(refusal(house, add("op", { w: 0.2 }))).toBe("Deck sizes must be at least 0.30 m, tops 0.15 to 10 m");
  });

  it("refuses bad input before validation", () => {
    expect(refusal(house, add("op", { preset: JSON.parse('"stage"') }))).toBe("Unknown deck preset");
    expect(refusal(house, add("op", { w: Number.NaN }))).toBe("Invalid size");
    expect(refusal(house, add("op", { top: Number.POSITIVE_INFINITY }))).toBe("Invalid height");
    expect(refusal(house, add("op", { rotation: Number.NaN }))).toBe("Invalid rotation");
    expect(refusal(house, add("op", { at: { x: Number.NaN, y: 0 } }))).toBe("Invalid position");
    expect(refusal(house, add("op", { solid: JSON.parse('"yes"') }))).toBe("Invalid solid flag");
    expect(refusal(house, add("op", { name: "x".repeat(201) }))).toBe("Name too long");
    expect(refusal(house, add("bad id"))).toBe("Invalid operation ID");
    expect(refusal(run(house, add("op")), add("op", { at: { x: 3, y: 1.25 }, w: 1 }))).toBe("Operation ID already used");
  });

  it("depends on the new deck, every wall and the ceiling", () => {
    const r = execute(house, add("op"));
    if (!r.ok) throw new Error(r.error.message);
    const deps = r.value.patch.dependencies.map((k) => `${k.table}/${k.id}`);
    expect(deps).toEqual(expect.arrayContaining(["decks/op/k0", "ceilings/ceiling", "walls/P", "walls/W1a"]));
    expect(r.value.patch.puts).toEqual([{ table: "decks", entity: r.value.doc.decks["op/k0"] }]);
  });
});

describe("setDeck", () => {
  const doc = run(house, add("op"));
  const deck = doc.decks["op/k0"];
  const set = (fields: Partial<Omit<Deck, "id">>): Command => ({ type: "setDeck", deckId: "op/k0", ...fields });
  const edited = (fields: Partial<Omit<Deck, "id">>): Deck | undefined => run(doc, set(fields)).decks["op/k0"];

  it("edits each field, to the millimetre and whole degrees", () => {
    expect(edited({ name: "Sleeping loft" })).toEqual({ ...deck, name: "Sleeping loft" });
    expect(edited({ at: { x: 4.40049, y: 1.2 } })).toEqual({ ...deck, at: { x: 4.4, y: 1.2 } });
    expect(edited({ w: 1.5004 })).toEqual({ ...deck, w: 1.5 });
    expect(edited({ d: 1.0006 })).toEqual({ ...deck, d: 1.001 });
    expect(edited({ rotation: 14.6 })).toEqual({ ...deck, rotation: 15 });
    expect(edited({ top: 2.2 })).toEqual({ ...deck, top: 2.2 });
    expect(edited({ solid: true })).toEqual({ ...deck, solid: true });
  });

  it("changing nothing is a no-op with an empty patch", () => {
    const r = execute(doc, set({ top: 2.15, name: "Loft" }));
    expect(r.ok && r.value.patch.puts).toEqual([]);
    expect(r.ok && r.value.doc).toBe(doc);
  });

  it("is refused when the result breaks I18", () => {
    expect(refusal(doc, set({ top: 2.6 }))).toBe("Loft reaches 2.60 m; the ceiling is 2.50 m");
    expect(refusal(doc, set({ at: { x: 2, y: 1.25 }, d: 2.3, top: 2.14 }))).toBe("Loft (2.02–2.14) overlaps a 2.03 m wall");
    expect(refusal(doc, set({ at: { x: 9, y: 1.25 } }))).toBe("Loft must lie over the building");
    expect(refusal(doc, set({ w: 0.29 }))).toBe("Deck sizes must be at least 0.30 m, tops 0.15 to 10 m");
  });

  it("refuses an unknown deck and bad input", () => {
    expect(refusal(doc, { type: "setDeck", deckId: "nope", top: 1 })).toBe("Deck not found");
    expect(refusal(doc, set({ w: Number.NaN }))).toBe("Invalid size");
    expect(refusal(doc, set({ top: Number.NaN }))).toBe("Invalid height");
    expect(refusal(doc, set({ name: "x".repeat(201) }))).toBe("Name too long");
  });

  it("depends on the deck, every wall and the ceiling, so a concurrent wall or ceiling change re-validates", () => {
    const r = execute(withCeilingRow(doc), set({ top: 2.2 }));
    if (!r.ok) throw new Error(r.error.message);
    const deps = r.value.patch.dependencies.map((k) => `${k.table}/${k.id}`);
    expect(deps).toEqual(expect.arrayContaining(["decks/op/k0", "ceilings/ceiling", ...Object.keys(doc.walls).map((id) => `walls/${id}`)]));
  });
});

function withCeilingRow(doc: Document): Document {
  return { ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 2.5 } } };
}

describe("deleting a deck", () => {
  const doc = withDeck(house, { id: "k", name: "Loft", at: [4.5, 1.25], top: 2.15, solid: false });
  const del: Command = { type: "deleteEntities", ids: [{ table: "decks", id: "k" }] };

  it("deleting an empty deck removes it", () => {
    expect(validateDocument(doc).ok).toBe(true);
    const r = execute(doc, del);
    expect(r.ok && r.value.doc.decks).toEqual({});
    expect(r.ok && r.value.patch.deletes).toEqual([{ table: "decks", id: "k" }]);
  });

  it("is refused while a piece stands on it, naming the first by layout order, then ID (decks.13)", () => {
    let carrying: Document = { ...doc, states: { night: { id: "night", name: "Night", order: 1 }, day: { id: "day", name: "Day", order: 0 } } };
    carrying = place(carrying, { object: "z", kind: "bed", at: [4.5, 1.9], state: "night", deck: "k", size: { w: { standard: 1 }, d: { standard: 1 } } });
    carrying = place(carrying, { object: "y", kind: "chair", at: [6, 1], state: "night" });
    expect(refusal(carrying, del)).toBe("Loft carries Bed in Night; move it off first");
    carrying = place(carrying, { object: "a", kind: "chair", at: [4.5, 1.9], state: "night", deck: "k" });
    expect(refusal(carrying, del)).toBe("Loft carries Chair in Night; move it off first");
    carrying = place(carrying, { object: "x", kind: "desk", at: [4.5, 1.9], state: "day", deck: "k" });
    expect(refusal(carrying, del)).toBe("Loft carries Desk in Day; move it off first");
  });

  it("is accepted when the pieces on it are deleted with it", () => {
    const carrying = place(doc, { object: "c", kind: "chair", at: [4.5, 1.9], deck: "k" });
    const r = execute(carrying, { type: "deleteEntities", ids: [{ table: "decks", id: "k" }, { table: "placements", id: "c/s0" }] });
    expect(r.ok && r.value.doc.decks).toEqual({});
  });
});
