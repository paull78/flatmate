import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { invertPatch, applyPatch } from "../src/patch";
import { LOFT, NOTCH, notchedCabin, run } from "./cabin";

// A deck's holes follow it (stairwell.34, AC-02): a move or a turn carries them, a resize keeps them on the plan and
// I22 refuses one left outside; deleting the deck deletes its holes. The notch: x 1.40–2.10, y 2.25–2.90.

const HOLE = "notch/h0";
const hole = (doc: Document) => doc.deckHoles[HOLE];
const tried = (cmd: Command): string => {
  const r = execute(notchedCabin(), cmd);
  return r.ok ? "accepted" : r.error.message;
};

describe("a deck's holes follow it (AC-02)", () => {
  it("a move carries the hole by the same delta", () => {
    const doc = run(notchedCabin(), { type: "setDeck", deckId: LOFT, at: { x: 1.2, y: 1.5 } });
    expect(hole(doc)).toEqual({ id: HOLE, deck: LOFT, at: { x: 1.85, y: 2.575 }, w: NOTCH.w, d: NOTCH.d, guard: { kind: "railing", height: 1 } });
  });

  it("a turn turns the hole's centre around the deck's; its sides stay along the deck's axes", () => {
    // Half a turn maps the loft onto itself: the notch goes to the south-west corner, x 0.10–0.80, y 0.10–0.75.
    const doc = run(notchedCabin(), { type: "setDeck", deckId: LOFT, rotation: 180 });
    expect(hole(doc)).toEqual({ id: HOLE, deck: LOFT, at: { x: 0.45, y: 0.425 }, w: NOTCH.w, d: NOTCH.d, guard: { kind: "railing", height: 1 } });
  });

  it("a move and a turn in one edit carry the hole rigidly", () => {
    const doc = run(notchedCabin(), { type: "setDeck", deckId: LOFT, at: { x: 1.2, y: 1.5 }, rotation: 180 });
    expect(hole(doc)?.at).toEqual({ x: 0.55, y: 0.425 });
  });

  it("a resize keeps the hole where it is on the plan", () => {
    // The west side pulled in by 0.10 (a side grip): the loft is x 0.20–2.10, the notch still fits.
    const doc = run(notchedCabin(), { type: "setDeck", deckId: LOFT, at: { x: 1.15, y: 1.5 }, w: 1.9 });
    expect(hole(doc)).toEqual(notchedCabin().deckHoles[HOLE]);
  });

  it("a resize that leaves the hole outside the deck is refused by I22", () => {
    // The east side pulled in by 0.10: the loft ends at x 2.00, the notch at 2.10.
    expect(tried({ type: "setDeck", deckId: LOFT, at: { x: 1.05, y: 1.5 }, w: 1.9 })).toBe("A hole in Loft lies inside it");
  });

  it("the edit depends on the deck's holes, so a concurrent hole edit conflicts", () => {
    const r = execute(notchedCabin(), { type: "setDeck", deckId: LOFT, at: { x: 1.2, y: 1.5 } });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.dependencies.map((k) => `${k.table}/${k.id}`)).toContain(`deckHoles/${HOLE}`);
  });

  it("a move's inverse brings the hole back", () => {
    const before = notchedCabin();
    const r = execute(before, { type: "setDeck", deckId: LOFT, at: { x: 1.2, y: 1.5 } });
    if (!r.ok) throw new Error(r.error.message);
    const back = applyPatch(r.value.doc, invertPatch(r.value.patch));
    expect(back.ok && back.value.deckHoles).toEqual(before.deckHoles);
  });

  it("a ladder rising through the hole stays behind, so the move is refused", () => {
    const withLadder = run(notchedCabin(), { type: "placeStair", opId: "lad", state: "s0", kind: "shipsLadder", deck: LOFT, at: { x: 1.4, y: 2.6 }, shape: "straight", surface: null });
    const r = execute(withLadder, { type: "setDeck", deckId: LOFT, at: { x: 1.2, y: 1.5 } });
    expect(r.ok ? "accepted" : r.error.message).toBe("Ship's ladder (0.00–2.15) and Loft (2.03–2.15) overlap in Layout");
  });

  it("its name, top and Solid still change", () => {
    const doc = run(notchedCabin(), { type: "setDeck", deckId: LOFT, name: "Sleeping loft", top: 2.2, solid: false });
    expect(doc.decks[LOFT]).toEqual(expect.objectContaining({ name: "Sleeping loft", top: 2.2 }));
  });

  it("deleting the deck deletes its holes in one edit; its inverse brings back both", () => {
    const before = notchedCabin();
    const r = execute(before, { type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    if (!r.ok) throw new Error(r.error.message);
    expect([r.value.doc.decks, r.value.doc.deckHoles]).toEqual([{}, {}]);
    const back = applyPatch(r.value.doc, invertPatch(r.value.patch));
    expect(back.ok && [Object.keys(back.value.decks), Object.keys(back.value.deckHoles)]).toEqual([[LOFT], [HOLE]]);
  });
});
