import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import type { Point } from "@fm/protocol";
import { slabCells, slabEdges, type FrameEdge, type FrameRect } from "../src/queries/slab";
import { deckFrame, slabView } from "../src/queries/decks";

// The slab in a deck's frame (stairwell.15, .17): the rectangle less its holes as convex cells, and its boundary.
// A 2.0 × 2.8 deck: x −1.0 to 1.0, y −1.4 to 1.4 (the cabin's loft about its centre).

const W = 2;
const D = 2.8;
const area = (r: FrameRect): number => (r.x1 - r.x0) * (r.y1 - r.y0);
const total = (cells: readonly FrameRect[]): number => cells.reduce((s, r) => s + area(r), 0);
const round = (v: number): number => Math.round(v * 1e6) / 1e6 + 0; // + 0 turns −0 into 0
const seg = (e: FrameEdge): [number, number, number, number, number, number] => [round(e.a.x), round(e.a.y), round(e.b.x), round(e.b.y), e.normal.x + 0, e.normal.y + 0];
const sorted = (edges: readonly FrameEdge[]) => edges.map(seg).sort((p, q) => p.join().localeCompare(q.join()));

describe("the slab's cells", () => {
  it("no hole: one cell, the rectangle", () => {
    expect(slabCells(W, D, [])).toEqual([{ x0: -1, y0: -1.4, x1: 1, y1: 1.4 }]);
  });

  it("a notch at the north-east corner: the cells cover the rest, the notch left out", () => {
    const notch = { x0: 0.3, y0: 0.75, x1: 1, y1: 1.4 }; // the cabin's notch x 1.40–2.10, y 2.25–2.90
    const cells = slabCells(W, D, [notch]);
    expect(round(total(cells))).toBe(round(W * D - area(notch)));
    expect(cells.every((c) => !(c.x0 < notch.x1 && c.x1 > notch.x0 && c.y0 < notch.y1 && c.y1 > notch.y0))).toBe(true);
    expect(cells.length).toBe(2);
  });

  it("a hole as wide as the deck: two slabs", () => {
    const cells = slabCells(W, D, [{ x0: -1, y0: -0.2, x1: 1, y1: 0.2 }]);
    expect(cells.map((c) => [c.y0, c.y1].map(round))).toEqual([[-1.4, -0.2], [0.2, 1.4]]);
  });
});

describe("the slab's edges", () => {
  it("no hole: the four sides, counter-clockwise, normals outward", () => {
    expect(sorted(slabEdges(W, D, []))).toEqual(sorted([
      { a: { x: -1, y: -1.4 }, b: { x: 1, y: -1.4 }, normal: { x: 0, y: -1 } },
      { a: { x: 1, y: -1.4 }, b: { x: 1, y: 1.4 }, normal: { x: 1, y: 0 } },
      { a: { x: 1, y: 1.4 }, b: { x: -1, y: 1.4 }, normal: { x: 0, y: 1 } },
      { a: { x: -1, y: 1.4 }, b: { x: -1, y: -1.4 }, normal: { x: -1, y: 0 } },
    ]));
  });

  it("a notch: the east side stops at it, its two inner sides face into it, its open sides are no edges", () => {
    const edges = slabEdges(W, D, [{ x0: 0.3, y0: 0.75, x1: 1, y1: 1.4 }]);
    expect(sorted(edges)).toEqual(sorted([
      { a: { x: -1, y: -1.4 }, b: { x: 1, y: -1.4 }, normal: { x: 0, y: -1 } }, // south, whole
      { a: { x: 1, y: -1.4 }, b: { x: 1, y: 0.75 }, normal: { x: 1, y: 0 } }, // east, up to the notch
      { a: { x: 1, y: 0.75 }, b: { x: 0.3, y: 0.75 }, normal: { x: 0, y: 1 } }, // the notch's south side, facing north into it
      { a: { x: 0.3, y: 0.75 }, b: { x: 0.3, y: 1.4 }, normal: { x: 1, y: 0 } }, // the notch's west side, facing east into it
      { a: { x: 0.3, y: 1.4 }, b: { x: -1, y: 1.4 }, normal: { x: 0, y: 1 } }, // north, up to the notch
      { a: { x: -1, y: 1.4 }, b: { x: -1, y: -1.4 }, normal: { x: -1, y: 0 } }, // west, whole
    ]));
  });

  it("a hole as wide as the deck: two slabs, each with four edges", () => {
    expect(slabEdges(W, D, [{ x0: -1, y0: -0.2, x1: 1, y1: 0.2 }])).toHaveLength(8);
  });

  it("two touching holes: their shared side is no edge, and each long side is one edge", () => {
    const edges = slabEdges(W, D, [{ x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 }, { x0: 0, y0: -0.5, x1: 0.5, y1: 0.5 }]);
    expect(edges.filter((e) => Math.abs(e.a.x) < 1e-9 && Math.abs(e.b.x) < 1e-9)).toEqual([]);
    expect(sorted(edges.filter((e) => e.normal.x === 0 && Math.abs(Math.abs(e.a.y) - 0.5) < 1e-9))).toEqual(sorted([
      { a: { x: 0.5, y: -0.5 }, b: { x: -0.5, y: -0.5 }, normal: { x: 0, y: 1 } },
      { a: { x: -0.5, y: 0.5 }, b: { x: 0.5, y: 0.5 }, normal: { x: 0, y: -1 } },
    ]));
  });
});

describe("the deck's frame", () => {
  it("round-trips a point on a deck turned by 30°", () => {
    const frame = deckFrame({ at: { x: 3, y: 2 }, rotation: 30 });
    const p = { x: 3.7, y: 1.2 };
    const back = frame.toPlan(frame.toDeck(p));
    expect([back.x, back.y]).toEqual([expect.closeTo(p.x, 12), expect.closeTo(p.y, 12)]);
    const q = frame.toPlan({ x: 1, y: 0 }); // one metre along the deck's width from its centre
    expect([q.x, q.y]).toEqual([expect.closeTo(3 + Math.cos(Math.PI / 6), 12), expect.closeTo(2 + Math.sin(Math.PI / 6), 12)]);
  });

  it("slabView maps holes, cells and edges to plan on a turned deck", () => {
    const deck = { id: "loft/k0", name: "Loft", at: { x: 3, y: 2 }, w: 2, d: 2.8, rotation: 30, top: 2.15, solid: false, finish: null, ...sameGuards("railing") };
    const at: Point = deckFrame(deck).toPlan({ x: 0.65, y: 1.075 });
    const view = slabView(deck, [{ id: "h/h0", deck: deck.id, at, w: 0.7, d: 0.65, guard: { kind: "railing", height: 1 } }]);
    expect(view.holes[0]?.ring).toHaveLength(4);
    expect(view.cells.length).toBe(2);
    expect(view.edges.length).toBe(6);
    for (const e of view.edges) expect(Math.hypot(e.normal.x, e.normal.y)).toBeCloseTo(1, 12);
  });
});
