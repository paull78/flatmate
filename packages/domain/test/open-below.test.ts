import { describe, expect, it } from "vitest";
import { emptyDocument, execute, levels, openBelow, rectangleRoom, type Command, type Document, type Level } from "../src";

// What a loft's level leaves open to below (edges.07, AC-10): each room its decks cover in part, at the most open point
// of the uncovered part, and each hole with no stair in it; nothing at the floor.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const LOFT = "l/k0";
/** A 7 × 4 room (clear x 0.1–6.9, y 0.1–3.9), 3.05 ceiling, a loft over its left part, x 0.1–2.5, top 2.15. */
const studio = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 7, 4, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.3, y: 2 }, w: 2.4, d: 3.8 },
  ...more,
);
const levelOfDeck = (doc: Document, deck: string): Level => {
  const l = levels(doc).find((x) => x.deckIds.includes(deck));
  if (!l) throw new Error("no level");
  return l;
};
const floor = (doc: Document): Level => {
  const l = levels(doc)[0];
  if (!l) throw new Error("no floor");
  return l;
};

describe("a room the loft covers in part", () => {
  it("at the loft's level, one region in the uncovered part, as far as it can be from every edge", () => {
    const doc = studio();
    const open = openBelow(doc, levelOfDeck(doc, LOFT));
    expect(open).toHaveLength(1);
    const [o] = open;
    expect(o?.hole).toBeNull();
    // the uncovered part is x 2.5–6.9, y 0.1–3.9: its most open point is on its middle line, 1.9 from top and bottom
    expect(o?.at.x).toBeGreaterThan(2.5 + 1.8);
    expect(o?.at.x).toBeLessThan(6.9 - 1.8);
    expect(o?.at.y).toBeCloseTo(2, 1);
    expect(o?.clear).toBeCloseTo(1.9, 1);
  });

  it("at the floor, nothing", () => {
    const doc = studio();
    expect(openBelow(doc, floor(doc))).toEqual([]);
  });

  it("a room the loft doesn't touch gives nothing; a room it covers wholly gives nothing", () => {
    // A partition at x 4 makes two rooms: the left one (x 0.1–3.9) is covered in part, the right one not at all.
    const split = studio({ type: "addWall", opId: "p", from: { at: { x: 4, y: 0 } }, to: { at: { x: 4, y: 4 } } });
    const open = openBelow(split, levelOfDeck(split, LOFT));
    expect(open).toHaveLength(1);
    expect(open[0]?.at.x).toBeGreaterThan(2.5);
    expect(open[0]?.at.x).toBeLessThan(3.9);
    // A loft over the whole of a small room covers it wholly.
    const whole = build(
      ...rectangleRoom({ x: 0, y: 0 }, 3, 3, "c"), { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.5, y: 1.5 }, w: 2.8, d: 2.8 },
    );
    expect(openBelow(whole, levelOfDeck(whole, LOFT))).toEqual([]);
  });
});

describe("a room whose box reaches the loft but whose floor it doesn't", () => {
  it("an L-shaped room round a corner room holding the loft gives nothing", () => {
    // Walls from (3, 4) down to (3, 2) and across to (0, 2) close a corner room, x 0.1–2.9, y 2.1–3.9; the loft fills it.
    // The rest of the shell is an L whose box takes in the corner room.
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 7, 4, "c"), { type: "setCeiling", height: 3.05 },
      { type: "addWall", opId: "p1", from: { at: { x: 3, y: 4 } }, to: { at: { x: 3, y: 2 } } },
      { type: "addWall", opId: "p2", from: { at: { x: 3, y: 2 } }, to: { at: { x: 0, y: 2 } } },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.5, y: 3 }, w: 2.8, d: 1.8 },
    );
    expect(openBelow(doc, levelOfDeck(doc, LOFT))).toEqual([]);
  });
});

describe("a hole", () => {
  const hole: Command = { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1.3, y: 2.5 }, w: 1, d: 1.6 };

  it("an empty hole is open to below, at its centre, as far as its nearer sides", () => {
    const doc = studio(hole);
    const h = openBelow(doc, levelOfDeck(doc, LOFT)).find((o) => o.hole === "h/h0");
    expect(h?.at).toEqual({ x: 1.3, y: 2.5 });
    expect(h?.clear).toBeCloseTo(0.5, 6);
  });

  it("a hole with a stair standing in it isn't", () => {
    const doc = studio(
      hole,
      { type: "placeStair", opId: "ps", state: "s0", kind: "storageStair", surface: null, deck: LOFT, at: { x: 1.3, y: 3.3 }, shape: "straight" },
    );
    expect(openBelow(doc, levelOfDeck(doc, LOFT)).some((o) => o.hole === "h/h0")).toBe(false);
  });
});
