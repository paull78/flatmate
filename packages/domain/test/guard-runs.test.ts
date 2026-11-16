import { describe, expect, it } from "vitest";
import { emptyDocument, execute, guardRuns, missingGuards, rectangleRoom, validateDocument, type Command, type Document, type GuardRun } from "../src";

// A deck's guard runs (AC-02, AC-03, AC-05, AC-08): its open edges, less walls as tall as the guard, decks at its height and
// a stair's end. Real documents, and the two cases not yet run through real code first: a spiral's gap and an L's landing.

const LOFT = "l/k0";
const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const cabin = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 },
  ...more,
);
const notch: Command = { type: "addDeckHole", opId: "n", deck: LOFT, at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 };
const len = (r: GuardRun): number => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
const of = (doc: Document, deck: string): readonly GuardRun[] => guardRuns(doc).filter((r) => r.deck === deck);
const total = (runs: readonly GuardRun[]): number => runs.reduce((sum, r) => sum + len(r), 0);
const on = (runs: readonly GuardRun[], axis: "x" | "y", v: number): GuardRun[] => runs.filter((r) => Math.abs(r.a[axis] - v) < 1e-6 && Math.abs(r.b[axis] - v) < 1e-6);

describe("the two cases not yet run through real code", () => {
  it("a spiral in a hole leaves only its landing's width, on the side it hangs from", () => {
    const doc = cabin(
      { type: "addDeckHole", opId: "big", deck: LOFT, at: { x: 1.05, y: 1.05 }, w: 1.7, d: 1.7 },
      { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at: { x: 1.05, y: 1.9 }, shape: "straight" },
    );
    expect(validateDocument(doc).ok).toBe(true);
    const north = on(of(doc, LOFT), "y", 1.9);
    // The hole's north side is 1.70 long, x 0.20–1.90; the spiral is 1.60 wide there, its landing half of that.
    expect(total(north)).toBeCloseTo(1.7 - 0.8, 3);
    // The sides the spiral merely touches keep their rail.
    expect(total(on(of(doc, LOFT), "x", 0.2))).toBeCloseTo(1.7, 3);
  });

  it("an L's landing, itself a deck, has a rail with a gap for each flight", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
      { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "l-right" },
    );
    expect(validateDocument(doc).ok).toBe(true);
    const landing = doc.decks["ps/k0"];
    if (!landing) throw new Error("no landing");
    expect(landing.guardFront.kind).toBe("railing"); // 1.075 up
    const runs = of(doc, "ps/k0");
    const perimeter = 2 * (landing.w + landing.d);
    // Two flights each take their width off its boundary: what's left isn't everything, and isn't nothing.
    expect(total(runs)).toBeCloseTo(perimeter - 2 * 0.9, 3);
  });
});

describe("the studio's and the cabin's decks (AC-02)", () => {
  it("a cabin's loft has one run on its one open edge", () => {
    const runs = of(cabin(), LOFT);
    expect(runs).toHaveLength(1);
    expect(on(runs, "x", 2.1)).toHaveLength(1);
    expect(total(runs)).toBeCloseTo(2.8, 3);
  });

  it("with a notch, its three open edges", () => {
    const runs = of(cabin(notch), LOFT);
    expect(runs).toHaveLength(3);
    expect(total(runs)).toBeCloseTo(2.15 + 0.7 + 0.65, 3);
  });

  it("a platform has none, set to None", () => {
    const doc = cabin({ type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1 });
    expect(of(doc, "p/k0")).toEqual([]);
  });

  it("a platform set to Railing has its open edges", () => {
    const doc = cabin({ type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1, guard: "railing" });
    expect(total(of(doc, "p/k0"))).toBeCloseTo(4, 3);
  });

  it("a guard set to Glass says so", () => {
    const doc = cabin({ type: "setDeck", deckId: LOFT, guard: "glass" });
    expect(of(doc, LOFT)[0]?.kind).toBe("glass");
  });

  it("an edge touching a deck at the same height has none there", () => {
    const doc = cabin({ type: "addDeck", opId: "m", preset: "loft", at: { x: 2.6, y: 1.5 }, w: 1, d: 1, top: 2.15 });
    expect(total(on(of(doc, LOFT), "x", 2.1))).toBeCloseTo(2.8 - 1, 3);
  });

  it("an edge at another height keeps its guard", () => {
    const doc = cabin({ type: "addDeck", opId: "m", preset: "platform", at: { x: 2.6, y: 1.5 }, w: 1, d: 1 });
    expect(total(on(of(doc, LOFT), "x", 2.1))).toBeCloseTo(2.8, 3);
  });
});

describe("which walls count (AC-02, guards.14)", () => {
  const partition = (top: number | "ceiling", y0 = 0, y1 = 3): Command[] => [
    { type: "addWall", opId: "w", from: { at: { x: 2.2, y: y0 } }, to: { at: { x: 2.2, y: y1 } } },
    ...(top === "ceiling" ? [] : [{ type: "setWallTop", wallId: "w/w0", top } as Command]),
  ];

  it("a full wall against the edge counts", () => {
    expect(of(cabin(...partition("ceiling")), LOFT)).toEqual([]);
  });

  it("a wall below the slab doesn't", () => {
    expect(total(of(cabin(...partition(2.0)), LOFT))).toBeCloseTo(2.8, 3);
  });

  it("an edge partly against a wall has a run only on the open stretch", () => {
    expect(total(of(cabin(...partition("ceiling", 0, 1.5)), LOFT))).toBeCloseTo(2.8 - 1.4, 1);
  });
});

describe("a stair's gap (AC-03, guards.13)", () => {
  const ladder = (at: { x: number; y: number }): Command => ({ type: "placeStair", opId: "s", state: "s0", kind: "shipsLadder", surface: null, deck: LOFT, at, shape: "straight" });

  it("a ship's ladder in the notch leaves its 0.60 m arrival open and keeps the 0.70 m side", () => {
    const doc = cabin(notch, ladder({ x: 1.4, y: 2.55 }));
    const runs = of(doc, LOFT);
    expect(total(on(runs, "x", 1.4))).toBeCloseTo(0.65 - 0.6, 3);
    expect(total(on(runs, "y", 2.25))).toBeCloseTo(0.7, 3);
  });

  it("a scrap of rail under 2 cm beside a gap isn't drawn", () => {
    const runs = on(of(cabin(notch, ladder({ x: 1.4, y: 2.565 })), LOFT), "x", 1.4); // its gap y 2.265–2.865 of the side's 2.25–2.90
    expect(runs).toHaveLength(1); // 0.035 at the top, and no 0.015 at the bottom
    expect(total(runs)).toBeCloseTo(0.035, 3);
  });

  it("moving the stair moves the gap", () => {
    const at = (y: number): number => {
      const runs = on(of(cabin(ladder({ x: 2.1, y })), LOFT), "x", 2.1);
      return Math.max(...runs.map(len));
    };
    expect(at(1.2)).toBeCloseTo(2.9 - 1.5, 3); // its gap y 0.90–1.50 leaves 0.10–0.90 and 1.50–2.90
    expect(at(1.6)).toBeCloseTo(1.3 - 0.1, 3); // y 1.30–1.90 leaves 0.10–1.30 and 1.90–2.90
    expect(total(on(of(cabin(ladder({ x: 2.1, y: 1 })), LOFT), "x", 2.1))).toBeCloseTo(2.8 - 0.6, 3);
  });
});

describe("a guard's height (AC-05)", () => {
  it("is 1.00 m above its deck, under a high ceiling", () => {
    const doc = cabin({ type: "setCeiling", height: 3.5 });
    expect(of(doc, LOFT)[0]).toMatchObject({ bottom: 2.15, top: 3.15 });
  });

  it("stops at the ceiling: 0.90 m on the studio's numbers", () => {
    expect(of(cabin(), LOFT)[0]?.top).toBeCloseTo(3.05, 6);
  });

  it("is shorter with less room", () => {
    const doc = cabin({ type: "setCeiling", height: 2.8 });
    expect(of(doc, LOFT)[0]?.top).toBeCloseTo(2.8, 6);
  });
});

describe("it refuses nothing (AC-08)", () => {
  it("a piece flush against a railed edge stays valid", () => {
    const doc = cabin({ type: "placeObject", opId: "bed", state: "s0", object: { kind: "mattress", size: { w: 0.9, d: 1.9 } }, at: { x: 1.65, y: 2.5 }, rotation: 0, deck: LOFT });
    expect(validateDocument(doc).ok).toBe(true);
    expect(of(doc, LOFT)).toHaveLength(1);
  });
});

describe("found in review: a same-height deck closes only where its slab is (AC-02)", () => {
  const big = (...more: Command[]): Document => build(
    ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "b"), { type: "setCeiling", height: 4 },
    ...more,
  );

  it("a platform standing free in a loft's hole has a rail all round", () => {
    const doc = big(
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 5, y: 4 }, w: 3, d: 2 },
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 5, y: 4 }, w: 1.2, d: 1.2 },
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 5, y: 4 }, w: 0.5, d: 0.5, top: 2.15, guard: "railing" },
    );
    expect(total(of(doc, "p/k0"))).toBeCloseTo(2, 3);
  });

  it("set to None there, it warns", () => {
    const doc = big(
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 5, y: 4 }, w: 3, d: 2 },
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 5, y: 4 }, w: 1.2, d: 1.2 },
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 5, y: 4 }, w: 0.5, d: 0.5, top: 2.15, guard: "none" },
    );
    expect(missingGuards(doc).map((m) => [m.deck, m.side])).toEqual([["p/k0", "front"], ["p/k0", "right"], ["p/k0", "back"], ["p/k0", "left"]]); // one per side (edges.04)
  });

  it("a platform filling a hole exactly still closes it", () => {
    const doc = big(
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 5, y: 4 }, w: 3, d: 2 },
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 5, y: 4 }, w: 1, d: 1 },
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 5, y: 4 }, w: 1, d: 1, top: 2.15, guard: "railing" },
    );
    expect(of(doc, "p/k0")).toEqual([]);
    expect(total(of(doc, LOFT))).toBeCloseTo(2 * (3 + 2), 3); // its four outer sides, and no hole's
  });

  it("two abutting lofts, with a hole against the join: the join stays open over the hole", () => {
    const doc = big(
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 4 }, w: 2, d: 3 },
      { type: "addDeck", opId: "m", preset: "loft", at: { x: 5, y: 4 }, w: 2, d: 3 },
      { type: "addDeckHole", opId: "h", deck: "m/k0", at: { x: 4.5, y: 4 }, w: 1, d: 1 },
    );
    expect(total(on(of(doc, LOFT), "x", 4))).toBeCloseTo(1, 3); // y 3.5–4.5, over the notch
  });
});

describe("found in review: a stair across the seam of two same-height decks (AC-03)", () => {
  it("leaves its whole arrival open, on both decks", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 14, 14, "b"), { type: "setCeiling", height: 3.5 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 7, y: 7 }, w: 4, d: 3 },
      { type: "addDeck", opId: "m", preset: "loft", at: { x: 10.5, y: 7 }, w: 3, d: 3 },
      { type: "placeStair", opId: "s", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 9, y: 5.5 }, shape: "straight" },
    );
    const south = (deck: string): number => total(on(of(doc, deck), "y", 5.5));
    expect(south(LOFT)).toBeCloseTo(3.55, 3); // x 5–8.55
    expect(south("m/k0")).toBeCloseTo(2.55, 3); // x 9.45–12
  });
});
