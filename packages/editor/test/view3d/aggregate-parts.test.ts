import { describe, expect, it } from "vitest";
import { SEATED_REACH, roundSetDiameter } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout } from "../../src/view/aggregate";
import { appearanceOf } from "../../src/view3d/parts";
import { chair, tableBody } from "../../src/view3d/parts/sit-and-eat";
import { shifted } from "../../src/view3d/parts/sizes";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Part } from "../../src/view3d/parts/types";
import { ccw } from "../../src/view3d/prism";
import { STYLE_3D } from "../../src/view3d/style";
import { pieceOf, stream } from "./parts-fixtures";

// An aggregate in 3D (AC-04, seating.15): its table's own parts sized to the table and each chair's own parts moved and
// turned to its pose, from the one layout. The local frame runs y from the front (−d/2) to the back (+d/2).

const SETS = ["seatedDining", "seatedRound", "deskSet"];
const MM = 0.001;

/** A part's plan points in the local frame (an outline has none of its own). */
function planOf(p: Part): Point[] {
  switch (p.shape) {
    case "box":
    case "cylinder":
      return [{ x: p.at.x0, y: p.at.y0 }, { x: p.at.x1, y: p.at.y0 }, { x: p.at.x1, y: p.at.y1 }, { x: p.at.x0, y: p.at.y1 }];
    case "ring":
      return [...p.ring];
    case "outline":
      return [];
  }
}
const zOf = (p: Part): [number, number] => (p.shape === "box" || p.shape === "cylinder" ? [p.at.z0, p.at.z1] : [p.z0, p.z1]);
const middle = (ps: readonly Point[]): Point => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });

/** How far `p` lies outside the convex ring (negative inside). */
function outside(ring: readonly Point[], p: Point): number {
  const r = ccw(ring);
  return Math.max(...r.map((a, i) => {
    const b = r[(i + 1) % r.length] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len < 1e-12 ? -Infinity : ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len;
  }));
}

/** A part with its box's coordinates rounded to 1e-9, to compare across float noise. */
const rounded = (p: Part): Part => {
  if (p.shape !== "box") return p;
  const r = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;
  return { ...p, at: { x0: r(p.at.x0), x1: r(p.at.x1), y0: r(p.at.y0), y1: r(p.at.y1), z0: r(p.at.z0), z1: r(p.at.z1) } };
};

describe("the aggregates' 3D parts (AC-04, seating.15)", () => {
  it("a dining set of 4 has the table's parts and 4 chairs' parts", () => {
    const parts = appearanceOf("seatedDining")("standard", 1.2, 2, 0.9);
    const table = shifted(tableBody(1.2, 0.8, 0.75, false), 0, 0); // the table is centred: its reach each side
    const one = chair(0.45, 0.45, 0.9);
    expect(parts).toHaveLength(table.length + 4 * one.length);
    expect(parts.slice(0, table.length)).toEqual(table);
    // The back chairs face −y unturned, so they stay boxes: one at x −0.30, its back on the set's back edge (+1.00).
    expect(parts.map(rounded)).toEqual(expect.arrayContaining(shifted(one, -0.3, 1 - 0.225).map(rounded)));
    expect(parts.every((p) => p.shape === "box")).toBe(true); // turned by 0° or 180°, boxes stay boxes
  });

  it("a dining set of 6 has the table's parts and 6 chairs' parts, the end chairs' backs on the piece's short sides", () => {
    const parts = appearanceOf("seatedDining")("standard", 2.6, 2.1, 0.9);
    const table = tableBody(1.4, 0.9, 0.75, false);
    const one = chair(0.45, 0.45, 0.9);
    expect(parts).toHaveLength(table.length + 6 * one.length);
    expect(parts.slice(0, table.length).map(rounded)).toEqual(table.map(rounded)); // 2.60 − 1.20 is 1.4 with float noise
    expect(parts.every((p) => p.shape === "box")).toBe(true); // turned by quarters, boxes stay boxes
    const xs = parts.flatMap((p) => (p.shape === "box" ? [p.at.x0, p.at.x1] : []));
    expect(Math.min(...xs)).toBeCloseTo(-1.3, 9);
    expect(Math.max(...xs)).toBeCloseTo(1.3, 9);
  });

  it("round set chairs face the centre: each chair's back part is farther from the centre than its seat", () => {
    for (const t of [0.9, 1.2, 1.5]) {
      const D = roundSetDiameter(t, SEATED_REACH);
      const parts = appearanceOf("seatedRound")("standard", D, D, 0.9);
      const backs = parts.filter((p) => zOf(p)[1] === 0.9 && zOf(p)[0] > 0.4).map((p) => middle(planOf(p)));
      const seats = parts.filter((p) => zOf(p)[0] === 0.42).map((p) => middle(planOf(p)));
      const n = aggregateLayout("seatedRound", D, D)?.chairs.length;
      expect(backs, `${t}`).toHaveLength(n ?? -1);
      expect(seats, `${t}`).toHaveLength(n ?? -1);
      for (const b of backs) {
        const seat = seats.reduce((best, s) => (Math.hypot(s.x - b.x, s.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y) ? s : best));
        expect(Math.hypot(b.x, b.y), `${t}`).toBeGreaterThan(Math.hypot(seat.x, seat.y) + 0.1);
      }
      // The table's top is its own ring, not the piece's circle: Ø t about the centre.
      const top = parts.find((p) => p.shape === "ring" && zOf(p)[1] === 0.75);
      expect(top && Math.max(...planOf(top).map((q) => Math.hypot(q.x, q.y)))).toBeCloseTo(t / 2, 6);
    }
  });

  it.each([["seatedDining", 2.6, 2.1], ["seatedRound", 2.46, 2.46]])("%s stands its chairs 0.15 m clear of its table, at the plan's count (seated.01)", (kind, w, d) => {
    const parts = appearanceOf(kind)("standard", w, d, 0.9);
    const layout = aggregateLayout(kind, w, d);
    if (!layout) throw new Error("not a set");
    const seats = parts.filter((p) => zOf(p)[0] === 0.42);
    expect(seats).toHaveLength(layout.chairs.length);
    // The nearest any seat comes to the table's edge, from the centre of the piece, where the table stands.
    const { w: tw, d: td } = layout.tableSize;
    const gap = (q: Point) => (kind === "seatedRound" ? Math.hypot(q.x, q.y) - tw / 2 : Math.max(Math.abs(q.x) - tw / 2, Math.abs(q.y) - td / 2));
    expect(Math.min(...seats.flatMap((p) => planOf(p).map(gap)))).toBeGreaterThanOrEqual(0.15 - 1e-6);
  });

  it("the desk set has the desk's parts at the back and one chair turned to face it", () => {
    const parts = appearanceOf("deskSet")("standard", 1.2, 0.7, 0.9);
    const desk = appearanceOf("desk")("standard", 1.2, 0.6, 0.75);
    expect(parts.slice(0, desk.length)).toEqual(shifted(desk, 0, 0.05));
    expect(parts).toHaveLength(desk.length + chair(0.45, 0.45, 0.9).length);
  });

  it("every part lies inside the piece's shape and range, at 0.10–10 m and any turn; ring parts extrude like outlines", () => {
    const random = stream(11);
    const bad: string[] = [];
    for (const kind of SETS) {
      for (let i = 0; i < 60; i++) {
        const pick = (lo: number, hi: number) => lo + random() * (hi - lo);
        const [w, d] = [random() < 0.4 ? pick(0.1, 1) : pick(0.1, 10), random() < 0.4 ? pick(0.1, 1) : pick(0.1, 10)];
        const h = pick(0.1, 3);
        const item = pieceOf(kind, "standard", w, d, h, random() * 360);
        for (const f of partSolids("o", item, STYLE_3D).flatMap((s) => s.faces)) {
          for (const p of f.points) if (outside(item.ring, p) > MM || p.z < item.bottom - MM || p.z > item.top + MM) bad.push(`${kind} ${w.toFixed(3)}×${d.toFixed(3)}×${h.toFixed(3)}`);
        }
      }
    }
    expect([...new Set(bad)].slice(0, 5)).toEqual([]);
  });
});
