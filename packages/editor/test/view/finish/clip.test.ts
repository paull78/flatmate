import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { clipFloor, clipSegment } from "../../../src/view/finish/clip";
import { rect } from "./helpers";

// A segment against a floor with holes (finishes.13, .18): cut at crossings, keep pieces whose midpoint is inside and
// off the edges, drop pieces under 1 µm.

const SQUARE = rect(0, 0, 2, 2);
const P = (x: number, y: number): Point => ({ x, y });
const clip = (a: Point, b: Point, outer: readonly Point[], holes: readonly (readonly Point[])[]) => clipSegment(a, b, clipFloor(outer, holes));

function expectPieces(got: readonly { a: Point; b: Point }[], want: readonly [Point, Point][]): void {
  expect(got).toHaveLength(want.length);
  got.forEach((piece, i) => {
    const [a, b] = want[i] ?? [P(NaN, NaN), P(NaN, NaN)];
    for (const [p, q] of [[piece.a, a], [piece.b, b]] as const) {
      expect(p.x).toBeCloseTo(q.x, 12);
      expect(p.y).toBeCloseTo(q.y, 12);
    }
  });
}

function sane(pieces: readonly { a: Point; b: Point }[]): void {
  for (const { a, b } of pieces) {
    expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(1e-6);
  }
}

describe("clipSegment", () => {
  it("crosses the floor: the piece between the two crossings", () => {
    expectPieces(clip(P(-1, 0.5), P(3, 0.5), SQUARE, []), [[P(0, 0.5), P(2, 0.5)]]);
    expectPieces(clip(P(0.5, 0.5), P(1.5, 0.5), SQUARE, []), [[P(0.5, 0.5), P(1.5, 0.5)]]); // wholly inside
    expect(clip(P(-3, 0.5), P(-1, 0.5), SQUARE, [])).toEqual([]); // wholly outside
  });

  it("a segment along an edge is dropped", () => {
    expect(clip(P(-1, 0), P(3, 0), SQUARE, [])).toEqual([]);
    expect(clip(P(0.5, 2), P(1.5, 2), SQUARE, [])).toEqual([]);
    // Float noise on the edge, as `zones()` gives (y 0.1 vs 0.10000000000000009).
    expect(clip(P(-1, 0.1), P(3, 0.1), rect(0, 0.10000000000000009, 2, 2), [])).toEqual([]);
    // Along a hole's edge: the parts beside the hole stay.
    const hole = rect(0.5, 0.5, 1, 1);
    expectPieces(clip(P(-1, 0.5), P(3, 0.5), SQUARE, [hole]), [[P(0, 0.5), P(0.5, 0.5)], [P(1, 0.5), P(2, 0.5)]]);
  });

  it("a segment through a vertex gives no piece under 1 µm and no NaN", () => {
    const diagonal = clip(P(-1, -1), P(3, 3), SQUARE, []);
    sane(diagonal);
    expectPieces(diagonal, [[P(0, 0), P(2, 2)]]);
    const touching = clip(P(-1, 1), P(1, -1), SQUARE, []); // meets the square at its corner only
    sane(touching);
    expect(touching).toEqual([]);
    // Through an L's reflex corner (1, 1): the floor on both sides, so the line runs on.
    const ell = [P(0, 0), P(2, 0), P(2, 1), P(1, 1), P(1, 2), P(0, 2)];
    const through = clip(P(-1, 3), P(3, -1), ell, []);
    sane(through);
    expectPieces(through, [[P(0, 2), P(2, 0)]]);
    // A segment ending on a vertex, and one starting on an edge.
    sane(clip(P(1, 1), P(2, 2), SQUARE, []));
    expectPieces(clip(P(0, 1), P(1, 1), SQUARE, []), [[P(0, 1), P(1, 1)]]);
  });

  it("a segment parallel to an edge but inside is kept", () => {
    expectPieces(clip(P(-1, 0.001), P(3, 0.001), SQUARE, []), [[P(0, 0.001), P(2, 0.001)]]);
    expectPieces(clip(P(1.999, -1), P(1.999, 3), SQUARE, []), [[P(1.999, 0), P(1.999, 2)]]);
  });

  it("a hole cuts a line into two pieces", () => {
    const hole = rect(0.5, 0.5, 1.5, 1.5);
    expectPieces(clip(P(-1, 1), P(3, 1), SQUARE, [hole]), [[P(0, 1), P(0.5, 1)], [P(1.5, 1), P(2, 1)]]);
  });

  it("drops a piece shorter than 1 µm", () => {
    expect(clip(P(-1, 1), P(5e-7, 1), SQUARE, [])).toEqual([]);
    expect(clip(P(-1, 1), P(2e-6, 1), SQUARE, [])).toHaveLength(1);
  });
});
