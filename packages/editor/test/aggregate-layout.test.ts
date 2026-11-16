import { describe, expect, it } from "vitest";
import { SEATED_REACH, CHAIR_SIZE, SEAT_BACK, convexIntersection, convexOverlap, footprintQuad, inConvex, kindOf, outlineOf, roundSetDiameter, shapeRing, signedArea } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout, type AggregateLayout } from "../src/view/aggregate";

// The aggregates' chair poses (seating.15, AC-04): one owner, in footprint space (x ±w/2, y −d…0), read by the plan
// symbol and the 3D parts. A pose is a loose chair's placement relative to the set's: its back edge's middle and turn.

const SETS = ["seatedDining", "seatedRound", "deskSet"];

function layoutOf(kind: string, w: number, d: number): AggregateLayout {
  const layout = aggregateLayout(kind, w, d);
  if (!layout) throw new Error(`${kind} is not an aggregate`);
  return layout;
}

const chairRing = (c: { at: Point; rotation: number }): Point[] => footprintQuad(c.at, CHAIR_SIZE.w, CHAIR_SIZE.d, c.rotation);
/** The chair's backrest strip: its back SEAT_BACK, the part that stays solid against a table (seating.14). */
const stripOf = (c: { at: Point; rotation: number }): Point[] => footprintQuad(c.at, CHAIR_SIZE.w, SEAT_BACK, c.rotation);

/** Distance from p to segment ab. */
function toSegment(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Smallest distance between two rings' boundaries (vertex to edge, both ways). */
function ringGap(a: readonly Point[], b: readonly Point[]): number {
  const one = (u: readonly Point[], v: readonly Point[]) =>
    Math.min(...u.flatMap((p) => v.map((q, i) => toSegment(p, q, v[(i + 1) % v.length] ?? q))));
  return Math.min(one(a, b), one(b, a));
}

/** Sizes from 0.10 to 10 m, the small ones around where chairs stop fitting. */
const SIZES = [0.1, 0.2, 0.3, 0.44, 0.45, 0.5, 0.6, 0.65, 0.75, 0.9, 1, 1.2, 1.48, 1.6, 1.77, 2.2, 2.4, 2.8, 3.3, 10];

describe("aggregateLayout (seating.15, AC-04)", () => {
  it("is null for a kind that isn't an aggregate", () => {
    expect(aggregateLayout("extendingTable", 0.8, 1.2)).toBeNull();
    expect(aggregateLayout("chair", 0.45, 0.45)).toBeNull();
  });

  it("layout counts: dining 1.20 / 2.60 / 3.20 / 3.40 / 3.80 → 4 / 6 / 8 / 10 / 10; round with tables 0.90 / 1.20 / 1.50 → 4 / 6 / 8; desk → 1", () => {
    expect([1.2, 2.6, 3.2, 3.4, 3.8].map((w) => layoutOf("seatedDining", w, 2.1).chairs.length)).toEqual([4, 6, 8, 10, 10]);
    const round = [0.9, 1.2, 1.5].map((t) => roundSetDiameter(t, SEATED_REACH));
    expect(round.map((D) => layoutOf("seatedRound", D, D).chairs.length)).toEqual([4, 6, 8]);
    for (const [D, t] of round.map((D, i) => [D, [0.9, 1.2, 1.5][i]] as const)) expect(layoutOf("seatedRound", D, D).tableSize.w).toBeCloseTo(t ?? 0, 9);
    expect(layoutOf("deskSet", 1.2, 0.7).chairs).toHaveLength(1);
  });

  it("each set's table: the closed extending table less its reach each side, the round table, the desk less a backrest at the front", () => {
    expect(layoutOf("seatedDining", 1.2, 2)).toMatchObject({ tableKind: "extendingTable", tableConfig: "closed", tableAt: { x: 0, y: -SEATED_REACH } });
    expect(layoutOf("seatedDining", 1.2, 2).tableSize).toEqual({ w: 1.2, d: expect.closeTo(0.8, 9) });
    // With end chairs the table is also its reach shorter at each end, still centred on the piece's length.
    expect(layoutOf("seatedDining", 2.6, 2.1)).toMatchObject({ tableAt: { x: 0, y: -SEATED_REACH }, tableSize: { w: expect.closeTo(1.4, 9), d: expect.closeTo(0.9, 9) } });
    expect(layoutOf("seatedRound", 2.16, 2.16)).toMatchObject({ tableKind: "roundTable", tableConfig: "standard" });
    expect(layoutOf("deskSet", 1.2, 0.7)).toMatchObject({ tableKind: "desk", tableConfig: "standard", tableAt: { x: 0, y: 0 } });
    expect(layoutOf("deskSet", 1.2, 0.7).tableSize).toEqual({ w: 1.2, d: expect.closeTo(0.6, 9) });
  });

  it("dining chairs sit evenly on the front and back, centred in w/n cells, facing the table; round chairs start at the front", () => {
    const dining = layoutOf("seatedDining", 1.2, 2).chairs;
    expect(dining.map((c) => [c.at.x, c.at.y, c.rotation])).toEqual(
      expect.arrayContaining([[-0.3, 0, 0], [0.3, 0, 0], [-0.3, -2, 180], [0.3, -2, 180]].map((v) => v.map((n) => expect.closeTo(n, 9)))),
    );
    const [first] = layoutOf("seatedRound", 2.16, 2.16).chairs;
    expect(first?.rotation).toBe(180); // the front chair faces +y, the centre
    expect(first?.at.x).toBeCloseTo(0, 9);
    expect(layoutOf("deskSet", 1.2, 0.7).chairs).toEqual([{ at: { x: 0, y: -0.7 }, rotation: 180 }]);
  });

  it("each preset draws the chairs its seats name (AC-04)", () => {
    for (const p of kindOf("seatedDining")?.presets ?? []) expect(layoutOf("seatedDining", p.w, p.d.standard ?? 0).chairs.length, p.id).toBe(p.seats);
  });

  it("end chairs clear of the table and inside: one at each end, back on the piece's short side, facing in, centred on the table's depth", () => {
    for (const [w, d] of [[2.6, 2.1], [3.2, 2.1], [3.8, 2.1], [3.2, 2.3], [4.2, 2.4]] as const) {
      const { table, chairs } = layoutOf("seatedDining", w, d);
      const ends = chairs.filter((c) => c.rotation === 90 || c.rotation === 270);
      expect(ends.map((c) => [c.at.x, c.at.y, c.rotation]), `${w}×${d}`).toEqual([[-w / 2, -d / 2, 90], [w / 2, -d / 2, 270]].map((v) => v.map((n) => expect.closeTo(n, 9))));
      const outer = shapeRing("rect", w, d);
      for (const c of chairs) expect(chairRing(c).every((p) => inConvex(p, outer, 1e-9)), `${w}×${d} inside`).toBe(true);
      for (const c of ends) {
        expect(convexOverlap(stripOf(c), table), `${w}×${d} overlap`).toBe(false);
        expect(ringGap(stripOf(c), table), `${w}×${d} clear`).toBeCloseTo(SEATED_REACH - SEAT_BACK, 6);
        // The whole strip stands off the table's end: its inner edge is parallel to the table's short side.
        const inner = stripOf(c).filter((p) => Math.abs(Math.abs(p.x) - (w / 2 - SEAT_BACK)) < 1e-9);
        expect(inner, `${w}×${d} flush`).toHaveLength(2);
      }
    }
  });

  it("no end chairs below a 1.40 m table: a 2.50 piece has none and its whole length as the table", () => {
    const l = layoutOf("seatedDining", 2.5, 2.1);
    expect(l.chairs).toHaveLength(8); // round(2.50 / 0.60) is 4 a side
    expect(l.chairs.every((c) => c.rotation === 0 || c.rotation === 180)).toBe(true);
    expect(l.tableSize.w).toBe(2.5);
  });

  it("every chair inside the piece: the outer rectangle, or the round set's fit ring (an ellipse too), at 0.10–10 m", () => {
    const bad: string[] = [];
    for (const kind of SETS) {
      for (const w of SIZES) {
        for (const d of SIZES) {
          const outer = shapeRing(outlineOf(kind), w, d);
          for (const c of layoutOf(kind, w, d).chairs) if (!chairRing(c).every((p) => inConvex(p, outer, 1e-9))) bad.push(`${kind} ${w}×${d}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("the table lies inside the piece, and no two chairs overlap, under it or anywhere (seated.23)", () => {
    const bad: string[] = [];
    for (const kind of SETS) {
      for (const w of SIZES) {
        for (const d of SIZES) {
          const { table, chairs } = layoutOf(kind, w, d);
          if (!table.every((p) => inConvex(p, shapeRing("rect", w, d), 1e-9))) bad.push(`${kind} ${w}×${d} table`);
          chairs.forEach((a, i) => chairs.slice(i + 1).forEach((b) => {
            const both = convexIntersection(chairRing(a), chairRing(b));
            if (Math.abs(signedArea(both)) > 1e-12) bad.push(`${kind} ${w}×${d} chairs ${i}`);
          }));
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("each backrest strip stands its kind's reach less its own depth off the table (the round table's circle), and never overlaps it", () => {
    for (const [kind, w, d] of [["seatedDining", 1.2, 2], ["seatedDining", 2.6, 2.1], ["seatedDining", 3.4, 2.1], ["seatedDining", 3.8, 2.1], ["deskSet", 1.2, 0.7], ...[0.9, 1.2, 1.5].map((t) => ["seatedRound", roundSetDiameter(t, SEATED_REACH), roundSetDiameter(t, SEATED_REACH)] as const)] as const) {
      const { table, chairs, tableSize } = layoutOf(kind, w, d);
      expect(chairs.length).toBeGreaterThan(0);
      const clear = (kindOf(kind)?.aggregate?.reach ?? 0) - SEAT_BACK; // none for the desk: its one chair tucks fully
      for (const c of chairs) {
        const strip = stripOf(c);
        expect(convexOverlap(strip, table), `${kind} ${w} overlap`).toBe(false);
        if (outlineOf(kind) === "round") {
          // Its inner edge's middle is r from the centre: the strip touches the circle the 32-gon is drawn in.
          const [a, b] = [strip[0], strip[1]];
          const mid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: NaN, y: NaN };
          expect(Math.hypot(mid.x, mid.y + d / 2), `${kind} ${w} stands off`).toBeCloseTo(tableSize.w / 2 + clear, 6);
        } else {
          expect(ringGap(strip, table), `${kind} ${w} stands off`).toBeCloseTo(clear, 6);
        }
      }
    }
  });

  it("round chairs face the centre: each back edge's middle is farther from it than the chair's front", () => {
    for (const t of [0.9, 1.2, 1.5]) {
      const D = roundSetDiameter(t, SEATED_REACH);
      for (const c of layoutOf("seatedRound", D, D).chairs) {
        const [f0, f1] = chairRing(c);
        const front = f0 && f1 ? { x: (f0.x + f1.x) / 2, y: (f0.y + f1.y) / 2 } : c.at;
        expect(Math.hypot(c.at.x, c.at.y + D / 2) - Math.hypot(front.x, front.y + D / 2)).toBeCloseTo(CHAIR_SIZE.d, 6);
      }
    }
  });

  it("an ellipse takes min(w, d) for its table; below where chairs fit there are none and the table is the whole piece", () => {
    const ellipse = layoutOf("seatedRound", 3, 2.16);
    expect(ellipse.tableSize).toEqual(layoutOf("seatedRound", 2.16, 2.16).tableSize);
    expect(ellipse.chairs).toHaveLength(4);
    expect(layoutOf("seatedRound", 0.45, 0.45)).toMatchObject({ chairs: [], tableSize: { w: 0.45, d: 0.45 } });
    expect(layoutOf("seatedDining", 0.4, 1)).toMatchObject({ chairs: [], tableSize: { w: 0.4, d: 1 }, tableAt: { x: 0, y: 0 } });
    expect(layoutOf("deskSet", 1.2, 0.3)).toMatchObject({ chairs: [], tableSize: { w: 1.2, d: 0.3 } });
  });
});
