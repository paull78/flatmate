import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, stairEdges, stairOnEdge, validateDocument, type Document, type StairEdge } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { catchEdge, shapeFor, slideOnEdge } from "../src/tools/stair-gesture";
import { roomDoc, withCommands } from "./builders";

// The pointer part of the stair gesture (stairdraw.11, spec "Catching an edge"): the band, the hold, the nearest edge
// and the slide along the edge. The edges themselves are the domain's (stairEdges).
//
// The 6 × 4 room (inner faces x 0.1–5.9, y 0.1–3.9) under 3.20, with three decks, all off the grid:
//   loft/k0   top 2.15, x 0.1–1.938, y 0.1–3.9: only its right edge (x 1.938, a at y 0.1, b at y 3.9) is free.
//             A Stair to it runs 2.99, so its band is x 1.638–4.928 over y 0.1–3.9.
//   plat/k0   top 1.08, x 3.2–4.4, y 1.5–2.5: a Stair to it runs 1.35, so its left edge's band is x 1.85–3.5, y 1.5–2.5.
//   box/k0    top 0.45, x 5.0–5.6, y 2.7–3.7: its 0.60 top and bottom edges are shorter than a Stair (0.90).

const LOFT = "loft/k0";
const STAIR = { state: "s0", kind: "stair", surface: null };

function decks(): Document {
  const doc = withCommands(
    roomDoc(),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.019, y: 2 }, w: 1.838, d: 3.8, name: "Loft" },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3.8, y: 2 }, w: 1.2, d: 1, top: 1.08, name: "Platform" },
    { type: "addDeck", opId: "box", preset: "platform", at: { x: 5.3, y: 3.2 }, w: 0.6, d: 1, name: "Box" },
  );
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}

const edgeOf = (doc: Document, deck: string, normal: Point, surface: string | null = null): StairEdge => {
  const edge = stairEdges(doc, surface, 0.9).find((e) => e.deck === deck && Math.abs(e.normal.x - normal.x) < 1e-9 && Math.abs(e.normal.y - normal.y) < 1e-9);
  if (!edge) throw new Error(`no edge of ${deck}`);
  return edge;
};
const deckOf = (e: StairEdge | null): string | null => e?.deck ?? null;
const X = 1.938; // the loft's free edge

describe("catchEdge", () => {
  it("catches 0.29 m behind the edge and not 0.31 m", () => {
    const doc = decks();
    expect(deckOf(catchEdge(doc, STAIR, { x: X - 0.29, y: 0.6 }, null))).toBe(LOFT);
    expect(catchEdge(doc, STAIR, { x: X - 0.31, y: 0.6 }, null)).toBeNull();
  });

  it("› the band reaches the run's end in front: a Stair's 2.99 m catches at 2.9 m and not at 3.1 m", () => {
    const doc = decks();
    expect(deckOf(catchEdge(doc, STAIR, { x: X + 2.9, y: 0.6 }, null))).toBe(LOFT);
    expect(catchEdge(doc, STAIR, { x: X + 3.1, y: 0.6 }, null)).toBeNull();
    // A ship's ladder's run is far shorter, so its band is too.
    expect(catchEdge(doc, { ...STAIR, kind: "shipsLadder" }, { x: X + 2.9, y: 0.6 }, null)).toBeNull();
  });

  it("› the band runs along the edge's length only", () => {
    const doc = decks();
    const held = edgeOf(doc, LOFT, { x: 1, y: 0 });
    expect(held).toMatchObject({ a: { x: X, y: expect.closeTo(0.1, 9) }, b: { x: X, y: expect.closeTo(3.9, 9) } });
    expect(deckOf(catchEdge(doc, STAIR, { x: X + 0.5, y: 0.11 }, null))).toBe(LOFT);
    expect(catchEdge(doc, STAIR, { x: X + 0.5, y: 0.09 }, null)).toBeNull(); // outside the room, past its end
  });

  it("› a held edge holds to 0.30 m outside its band, an unheld one doesn't", () => {
    const doc = decks();
    const held = edgeOf(doc, LOFT, { x: 1, y: 0 });
    for (const p of [{ x: X - 0.55, y: 0.6 }, { x: X + 2.99 + 0.25, y: 0.6 }]) {
      expect(deckOf(catchEdge(doc, STAIR, p, held))).toBe(LOFT);
      expect(catchEdge(doc, STAIR, p, null)).toBeNull();
    }
    expect(catchEdge(doc, STAIR, { x: X - 0.65, y: 0.6 }, held)).toBeNull();
    expect(catchEdge(doc, STAIR, { x: X + 2.99 + 0.35, y: 0.6 }, held)).toBeNull();
    // Except near another edge (edge-catch.16): (3.0, 2.0) is 0.20 m from the platform's edge, which catches.
    expect(deckOf(catchEdge(doc, STAIR, { x: 3, y: 2 }, held))).toBe("plat/k0");
  });

  it("› the nearest of two overlapping bands wins", () => {
    const doc = decks();
    // Both points lie in the loft's band and the platform's left edge's band (x 1.85–3.5, y 1.5–2.5).
    expect(deckOf(catchEdge(doc, STAIR, { x: 2.0, y: 2 }, null))).toBe(LOFT); // 0.062 from the loft, 1.2 from the platform
    expect(deckOf(catchEdge(doc, STAIR, { x: 3.0, y: 2 }, null))).toBe("plat/k0"); // 1.062 and 0.2
  });

  it("› an edge flush on a wall, a short edge, and the surface deck's edge don't catch", () => {
    const doc = decks();
    expect(catchEdge(doc, STAIR, { x: 0.2, y: 0.6 }, null)).toBeNull(); // 0.10 behind the loft's left edge, on the wall
    expect(catchEdge(doc, STAIR, { x: 5.3, y: 3.8 }, null)).toBeNull(); // 0.10 in front of the box's 0.60 top edge
    expect(deckOf(catchEdge(doc, STAIR, { x: 5.6 + 0.1, y: 3.2 }, null))).toBe("box/k0"); // its 1.00 right edge does
    expect(catchEdge(doc, { ...STAIR, surface: LOFT }, { x: X + 0.5, y: 0.6 }, null)).toBeNull(); // standing on the loft
  });
});

describe("slideOnEdge", () => {
  it("lands on a wall target within 0.30 m, the nearer of two, after an end and ahead of the step (AC-08)", () => {
    const edge = edgeOf(decks(), LOFT, { x: 1, y: 0 });
    const on = (y: number, walls: readonly number[]) => slideOnEdge(edge, { x: 2.5, y }, 0.9, { step: 0.1, end: 0.2, walls }).y;
    const base = edge.a.y; // the targets are measured along the edge from its start
    const flip = edge.b.y > edge.a.y ? 1 : -1;
    const target = (y: number): number => (y - base) * flip;
    expect(on(1.75, [target(2)])).toBeCloseTo(2, 9); // 0.25 from it
    expect(on(1.65, [target(2)])).toBeCloseTo(1.6, 9); // 0.35 from it: the step
    expect(on(1.75, [target(2), target(1.6)])).toBeCloseTo(1.6, 9); // nearer the 1.60
    expect(on(0.68, [target(0.9)])).toBeCloseTo(0.55, 9); // the end's flush goes first
    expect(slideOnEdge(edge, { x: 2.5, y: 1.75 }, 0.9, null).y).toBeCloseTo(1.75, 9); // Ctrl: none
  });

  it("snaps flush to the end within the tolerance given (here 0.20 m), else follows the step", () => {
    const edge = edgeOf(decks(), LOFT, { x: 1, y: 0 }); // 3.80 long; a 0.90 stair's middle runs from y 0.55 to 3.45
    expect(slideOnEdge(edge, { x: 2.5, y: 0.68 }, 0.9, { step: 0.1, end: 0.2, walls: [] })).toEqual({ x: X, y: 0.55 }); // its side 0.13 from the end
    expect(slideOnEdge(edge, { x: 2.5, y: 0.83 }, 0.9, { step: 0.1, end: 0.2, walls: [] })).toEqual({ x: X, y: expect.closeTo(0.8, 9) }); // 0.28: the step
    expect(slideOnEdge(edge, { x: 2.5, y: 0.83 }, 0.9, { step: 0.25, end: 0.2, walls: [] })).toEqual({ x: X, y: expect.closeTo(0.75, 9) }); // the world's step, not from the end (0.85)
    expect(slideOnEdge(edge, { x: 1.0, y: 3.3 }, 0.9, { step: 0.1, end: 0.2, walls: [] })).toEqual({ x: X, y: expect.closeTo(3.45, 9) }); // the other end
    expect(slideOnEdge(edge, { x: 2.5, y: 5 }, 0.9, { step: 0.1, end: 0.2, walls: [] })).toEqual({ x: X, y: expect.closeTo(3.45, 9) }); // kept within it
    expect(slideOnEdge(edge, { x: 2.5, y: -1 }, 0.9, { step: 0.1, end: 0.2, walls: [] })).toEqual({ x: X, y: 0.55 });
  });

  it("› snaps flush within the tolerance it is given; free (Ctrl), to the centimetre with no end snap (stairdraw.59)", () => {
    const edge = edgeOf(decks(), LOFT, { x: 1, y: 0 });
    expect(slideOnEdge(edge, { x: 2.5, y: 0.68 }, 0.9, { step: 0.1, end: 0.1, walls: [] })).toEqual({ x: X, y: expect.closeTo(0.7, 9) }); // 0.13 from the end: the step
    expect(slideOnEdge(edge, { x: 2.5, y: 0.62 }, 0.9, { step: 0.1, end: 0.1, walls: [] })).toEqual({ x: X, y: 0.55 }); // 0.07: flush
    expect(slideOnEdge(edge, { x: 2.5, y: 0.834 }, 0.9, null)).toEqual({ x: X, y: expect.closeTo(0.83, 9) });
    expect(slideOnEdge(edge, { x: 2.5, y: 0.6 }, 0.9, null)).toEqual({ x: X, y: expect.closeTo(0.6, 9) }); // no end snap
    expect(slideOnEdge(edge, { x: 2.5, y: -1 }, 0.9, null)).toEqual({ x: X, y: 0.55 }); // still kept within the edge
  });

  it("› on a deck turned 30°", () => {
    // An 8 × 6 room with a loft 2.00 × 1.40 turned 30° in its middle: its front edge's normal is (sin 30°, −cos 30°).
    const doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "big"), { type: "setCeiling", height: 3.2 }, { type: "addDeck", opId: "t", preset: "loft", at: { x: 4.03, y: 3.07 }, w: 2, d: 1.4, rotation: 30 });
    const n = { x: 0.5, y: -Math.sqrt(3) / 2 };
    const edge = edgeOf(doc, "t/k0", n);
    const len = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    expect(len).toBeCloseTo(2, 9);
    const u = { x: (edge.b.x - edge.a.x) / len, y: (edge.b.y - edge.a.y) / len };
    const at = (t: number, s: number): Point => ({ x: edge.a.x + u.x * t + n.x * s, y: edge.a.y + u.y * t + n.y * s });
    const near = (p: Point, q: Point): void => expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-9);
    near(slideOnEdge(edge, at(0.6, 0.5), 0.9, { step: 0.1, end: 0.2, walls: [] }), at(0.45, 0)); // flush to the end
    const slid = slideOnEdge(edge, at(1.03, 0.5), 0.9, { step: 0.1, end: 0.2, walls: [] }); // the step, on the world's lattice along the edge
    const along = slid.x * u.x + slid.y * u.y;
    expect(Math.abs(along / 0.1 - Math.round(along / 0.1))).toBeLessThan(1e-9);
    expect(Math.abs(along - (at(1.03, 0).x * u.x + at(1.03, 0).y * u.y))).toBeLessThanOrEqual(0.05 + 1e-9);
    near(slideOnEdge(edge, at(1.47, -0.2), 0.9, { step: 0.1, end: 0.2, walls: [] }), at(1.55, 0)); // flush to the other end (1.55 = 2.00 − 0.45)
    // And the band follows the turn: 0.29 m behind catches, 0.31 m doesn't.
    expect(deckOf(catchEdge(doc, STAIR, at(1, -0.29), null))).toBe("t/k0");
    expect(catchEdge(doc, STAIR, at(1, -0.31), null)).toBeNull();
  });
});

describe("shapeFor (stairdraw.06, spec \"The gesture\")", () => {
  // The top fixed at (X, 2) on the loft's free edge: out is +x, along the edge +y.
  const at: Point = { x: X, y: 2 };
  const swung = (u: number, deg: number): Point => ({ x: X + Math.abs(u) / Math.tan((deg * Math.PI) / 180), y: 2 + u });
  const edge = (): StairEdge => edgeOf(decks(), LOFT, { x: 1, y: 0 });

  it("straight out, and sideways at 29°, give straight; 31° with |u| 0.5 gives an L on the cursor's side; |u| 0.4 stays straight", () => {
    const e = edge();
    expect(shapeFor(e, at, { x: X + 2, y: 2 }, true)).toBe("straight");
    for (const u of [0.5, -0.5, 2]) expect(shapeFor(e, at, swung(u, 29), true)).toBe("straight");
    // Seen from the floor facing the edge (looking −x), the right is +y.
    expect(shapeFor(e, at, swung(0.5, 31), true)).toBe("l-right");
    expect(shapeFor(e, at, swung(-0.5, 31), true)).toBe("l-left");
    for (const u of [0.4, -0.4]) expect(shapeFor(e, at, swung(u, 80), true)).toBe("straight");
    expect(shapeFor(e, at, { x: X - 0.2, y: 2.5 }, true)).toBe("l-right"); // behind the edge, over the deck: sideways
  });

  it("› the L's lower flight lies on the cursor's side, on the loft's edge and on a deck turned 30°", () => {
    const turned = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "big"), { type: "setCeiling", height: 3.2 }, { type: "addDeck", opId: "t", preset: "loft", at: { x: 4.03, y: 3.07 }, w: 2, d: 1.4, rotation: 30 });
    const cases = [
      { doc: decks(), e: edge() },
      { doc: turned, e: edgeOf(turned, "t/k0", { x: 0.5, y: -Math.sqrt(3) / 2 }) },
    ];
    for (const { doc, e } of cases) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const along = { x: -e.normal.y, y: e.normal.x };
      for (const s of [1, -1]) {
        const cursor = { x: mid.x + along.x * s * 0.8 + e.normal.x * 0.5, y: mid.y + along.y * s * 0.8 + e.normal.y * 0.5 };
        const shape = shapeFor(e, mid, cursor, true);
        const parts = stairOnEdge(doc, { ...STAIR, deck: e.deck, at: mid, shape });
        if (!parts.ok) throw new Error(parts.error);
        const lower = parts.value.flights[1];
        if (!lower) throw new Error("no lower flight");
        const toLower = { x: lower.at.x - mid.x, y: lower.at.y - mid.y };
        const toCursor = { x: cursor.x - mid.x, y: cursor.y - mid.y };
        // The lower flight's back is on the cursor's side of the upper flight's axis, and it runs further that way.
        const side = (p: Point): number => p.x * along.x + p.y * along.y;
        expect(Math.sign(side(toLower))).toBe(Math.sign(side(toCursor)));
      }
    }
  });

  it("› a kind that doesn't turn is always straight (AC-08)", () => {
    const e = edge();
    for (const cursor of [swung(0.5, 31), swung(-2, 80), { x: X - 0.2, y: 2.5 }, { x: X + 2, y: 2 }]) expect(shapeFor(e, at, cursor, false)).toBe("straight");
  });
});
