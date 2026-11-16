import { describe, expect, it } from "vitest";
import { MIN_SET_TABLE, OBJECT_KINDS, convexIntersection, diningTable, outlineOf, roundSetDiameter, roundSetTable, shapeRing, signedArea, type Aggregate } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout, arrangedSet, chairRing } from "../src/view/aggregate";

// A set's reach (seated.01): the table's edge to the piece's edge. Chairs' backs stand at the piece's edge, so a reach over a
// chair's depth stands them clear of the table.

const CHAIR = 0.45;
const dining: Aggregate = { table: "extendingTable", config: "closed", chairs: "sides", reach: 0.6 };
const round: Aggregate = { table: "roundTable", config: "standard", chairs: "around", reach: 0.6 };

describe("a set's reach", () => {
  it("a 2.60 × 2.10 dining set has a 1.40 × 0.90 table and six chairs, each standing 0.15 m off it", () => {
    expect(diningTable(2.6, 2.1, 0.6)).toEqual({ w: expect.closeTo(1.4, 9), d: expect.closeTo(0.9, 9), ends: true });
    const l = arrangedSet(dining, "extendingTable", 2.6, 2.1);
    expect(l.tableSize).toEqual({ w: expect.closeTo(1.4, 9), d: expect.closeTo(0.9, 9) });
    expect(l.chairs).toHaveLength(6);
    const backs = l.chairs.filter((c) => c.rotation === 0).map((c) => c.at.y);
    expect(backs).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    expect(l.tableAt.y).toBeCloseTo(-0.6, 9);
    expect(0.6 - CHAIR).toBeCloseTo(0.15, 9); // from the chair's front to the table's back edge
    const ends = l.chairs.filter((c) => c.rotation === 90 || c.rotation === 270);
    expect(ends.map((c) => Math.abs(c.at.x))).toEqual([expect.closeTo(1.3, 9), expect.closeTo(1.3, 9)]);
  });

  it("a 1.20 × 2.00 dining set has no end chairs, and its table is its whole length", () => {
    const l = arrangedSet(dining, "extendingTable", 1.2, 2);
    expect(l.tableSize).toEqual({ w: expect.closeTo(1.2, 9), d: expect.closeTo(0.8, 9) });
    expect(l.chairs).toHaveLength(4);
  });

  it.each([[2.6, 2.1, 6], [3.2, 2.1, 8], [3.8, 2.1, 10], [1.2, 2, 4]])("a %s × %s dining set seats %s, every chair inside it", (w, d, seats) => {
    const l = arrangedSet(dining, "extendingTable", w, d);
    expect(l.chairs).toHaveLength(seats);
  });

  it("a piece whose table would be under 0.20 m is a bare table, though its chairs would fit", () => {
    expect(MIN_SET_TABLE).toBe(0.2);
    // 1.00 m deep at a reach of 0.60: a table of −0.20 m, with both rows of chairs inside the piece.
    const shallow = arrangedSet(dining, "extendingTable", 1.2, 1);
    expect(shallow.chairs).toEqual([]);
    expect(shallow.tableSize).toEqual({ w: 1.2, d: 1 });
    // Just over: a 0.21 m table keeps its chairs.
    expect(arrangedSet(dining, "extendingTable", 1.2, 1.41).chairs).toHaveLength(4);
  });

  it.each([[0.9, 4], [1.2, 6], [1.5, 8]])("a round table of Ø %s at a reach of 0.60 has %s chairs inside the piece's ring, clear of the table", (t, seats) => {
    const D = roundSetDiameter(t, 0.6);
    expect(roundSetTable(D, 0.6)).toBeCloseTo(t, 9);
    const l = arrangedSet(round, "roundTable", D, D);
    expect(l.chairs).toHaveLength(seats);
    expect(l.tableSize.w).toBeCloseTo(t, 9);
    expect(shapeRing("round", D, D)).toHaveLength(32);
  });

  it("the old reach gives the old table", () => {
    expect(diningTable(1.6, 1.1, 0.1)).toEqual({ w: expect.closeTo(1.4, 9), d: expect.closeTo(0.9, 9), ends: true });
    expect(diningTable(1.2, 1, 0.1)).toEqual({ w: 1.2, d: expect.closeTo(0.8, 9), ends: false });
  });
});

// Chairs are real: no two of a set may share floor, under a table or anywhere (seated.23). A size that can't hold them draws a bare table.
describe("no two chairs of a set overlap", () => {
  const overlap = (a: readonly Point[], b: readonly Point[]): number => Math.abs(signedArea(convexIntersection(a, b)));

  it.each(OBJECT_KINDS.filter((k) => k.aggregate !== null).map((k) => k.id))("%s, at any size", (kind) => {
    const round = outlineOf(kind) === "round";
    for (let w = 30; w <= 500; w += 5) {
      for (let d = round ? w : 30; d <= (round ? w : 400); d += 5) {
        const l = aggregateLayout(kind, w / 100, d / 100);
        const rings = (l?.chairs ?? []).map((c) => chairRing(c));
        rings.forEach((a, i) => rings.slice(i + 1).forEach((b) => expect(overlap(a, b), `${w} × ${d}`).toBeLessThan(1e-9)));
      }
    }
  });
});
