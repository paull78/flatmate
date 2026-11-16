import { describe, expect, it } from "vitest";
import { anchorAt } from "../src/queries/footprints";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { deckUnder } from "../src/queries/decks";
import { levelDeckAt, levels } from "../src/queries/levels";
import { LOFT, cabinDoc, notchedCabin, run } from "./cabin";

// Pieces, decks, walls and posts against the slab (stairwell.05, .06, .15, .16; AC-03, AC-04, AC-05). The cabin's
// loft is x 0.1–2.1, y 0.1–2.9, underside 2.03; the notch x 1.40–2.10, y 2.25–2.90.

const result = (doc: Document, ...cmds: Command[]): string => {
  let d = doc;
  for (const c of cmds) {
    const r = execute(d, c);
    if (!r.ok) return r.error.message;
    d = r.value.doc;
  }
  return "accepted";
};
/** A ship's ladder (0.60 × 1.10) rising west, its centre at (x, 2.60). */
const ladder = (x: number, opId = "lad"): Command => ({ type: "placeObject", opId, state: "s0", object: { kind: "shipsLadder" }, at: anchorAt({ x, y: 2.6 }, 1.1, 90), rotation: 90, deck: null });
/** A custom box `w` × `d` × `h` centred at (x, y), on `deck` (null: the floor); on a deck under a 3.50 ceiling, as its 1.00 default would pass 3.05. */
const box = (opId: string, x: number, y: number, w: number, d: number, h: number, deck: string | null = null): Command[] => [
  ...(deck === null ? [] : [{ type: "setCeiling", height: 3.5 } satisfies Command]),
  { type: "placeObject", opId, state: "s0", object: { kind: "block", size: { w, d } }, at: anchorAt({ x, y }, d, 0), rotation: 0, deck },
  { type: "setObjectSize", objectId: `${opId}/o0`, w, d: { standard: d }, h: { standard: h } },
];
const hole = (opId: string, x: number, y: number, w: number, d: number): Command => ({ type: "addDeckHole", opId, deck: LOFT, at: { x, y }, w, d });

describe("clear of the slab (AC-04)", () => {
  it("a ship's ladder up to 2.15 within the notch's part of the loft is accepted; without the notch it is refused", () => {
    expect(result(notchedCabin(), ladder(1.95))).toBe("accepted");
    expect(result(cabinDoc(), ladder(1.95))).toBe("Ship's ladder (0.00–2.15) and Loft (2.03–2.15) overlap in Layout");
  });

  it("a rung ladder keeps its box: within the notch accepted, reaching under the slab refused with both ranges (riser.04)", () => {
    const rung = (x: number): Command => ({ type: "placeObject", opId: "lad", state: "s0", object: { kind: "rungLadder" }, at: anchorAt({ x, y: 2.6 }, 0.58, 90), rotation: 90, deck: null });
    expect(result(notchedCabin(), rung(1.8))).toBe("accepted");
    expect(result(cabinDoc(), rung(1.8))).toBe("Rung ladder (0.00–2.15) and Loft (2.03–2.15) overlap in Layout");
  });

  it("a 2.40 bookcase standing in the notch is accepted", () => {
    expect(result(notchedCabin(), ...box("bk", 1.75, 2.6, 0.5, 0.5, 2.4))).toBe("accepted");
  });

  it("a piece spanning two touching holes is accepted", () => {
    const two = run(notchedCabin(), hole("west", 1.2, 2.575, 0.4, 0.65)); // x 1.00–1.40, touching the notch
    expect(result(two, ...box("bk", 1.4, 2.6, 0.4, 0.5, 2.4))).toBe("accepted"); // x 1.20–1.60
  });
});

describe("on the slab (AC-03)", () => {
  it("a piece on the loft over the notch is refused", () => {
    expect(result(notchedCabin(), ...box("c", 1.75, 2.6, 0.4, 0.4, 0.5, LOFT))).toBe("Custom box stands over a hole in Loft in Layout");
  });

  it("a 1.60 × 2.00 bed on the loft over a 0.40 hole under its middle, every corner on the slab, is refused", () => {
    const holed = run(cabinDoc(), hole("mid", 1.1, 1.4, 0.4, 0.4));
    expect(result(holed, ...box("bed", 1.1, 1.4, 1.6, 2.0, 0.25, LOFT))).toBe("Custom box stands over a hole in Loft in Layout");
    expect(result(cabinDoc(), ...box("bed", 1.1, 1.4, 1.6, 2.0, 0.25, LOFT))).toBe("accepted");
  });

  it("a point in the notch is on no deck: a piece dropped there doesn't land on the loft", () => {
    const doc = notchedCabin();
    expect(deckUnder(doc, { x: 1.75, y: 2.6 })).toBeNull();
    expect(deckUnder(doc, { x: 1.0, y: 2.6 })?.id).toBe(LOFT);
    const loftLevel = levels(doc).find((l) => l.deckIds.includes(LOFT));
    if (!loftLevel) throw new Error("no loft level");
    expect(levelDeckAt(doc, loftLevel, { x: 1.75, y: 2.6 })).toBeNull();
  });
});

describe("other decks, walls and posts through a hole (AC-05)", () => {
  const holed = (): Document => run(cabinDoc(), hole("mid", 1.0, 1.4, 1.0, 1.0)); // x 0.50–1.50, y 0.90–1.90
  const platform = (x: number): Command => ({ type: "addDeck", opId: "plat", preset: "platform", at: { x, y: 1.4 }, w: 0.9, d: 0.9, top: 0.45 });

  it("a 0.90 platform inside a 1.00 hole is accepted; 1 cm under the slab it is refused", () => {
    expect(result(holed(), platform(1.0))).toBe("accepted");
    expect(result(holed(), platform(1.06))).toBe("Loft and Platform overlap");
  });

  it("a full-height floor wall through the hole is accepted; 1 cm under the slab it is refused", () => {
    const wall = (x1: number): Command => ({ type: "addWall", opId: "w", from: { at: { x: 0.7, y: 1.4 } }, to: { at: { x: x1, y: 1.4 } } });
    expect(result(holed(), wall(1.3))).toBe("accepted");
    expect(result(holed(), wall(1.51))).toMatch(/^Loft \(2\.03–2\.15\) overlaps a 3\.05 m wall/);
  });

  it("a free post through the hole is accepted; 1 cm under the slab it is refused", () => {
    const post = (x: number): Command => ({ type: "placeColumn", opId: "p", at: { x, y: 1.4 }, width: 0.3, depth: 0.3 });
    expect(result(holed(), post(1.0))).toBe("accepted");
    expect(result(holed(), post(1.36))).toMatch(/^Loft \(2\.03–2\.15\) and Column/);
  });
});
