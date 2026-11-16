import { describe, expect, it } from "vitest";
import { SEATED_REACH, CHAIR_SIZE, SEAT_BACK, roundSetDiameter, type ObjectOptions } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout } from "../../src/view/aggregate";
import { appearanceOf } from "../../src/view3d/parts";
import { chair, roundChair } from "../../src/view3d/parts/sit-and-eat";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Part } from "../../src/view3d/parts/types";
import { ccw } from "../../src/view3d/prism";
import { STYLE_3D } from "../../src/view3d/style";
import { pieceOf, stream } from "./parts-fixtures";

// Round chairs in 3D (AC-05, library.09): a set with the option has, at each chair's pose, a round seat (a cylinder)
// and a back of short pieces along a curve in the chair's back SEAT_BACK, inside the piece's box. The chair's local
// frame runs y from its front (−d/2) to its back (+d/2).

const SETS = ["seatedDining", "seatedRound", "deskSet"];
const ROUND: ObjectOptions = { roundChairs: true };
const MM = 0.001;

/** A part's plan points (a cylinder's and a box's extent corners). */
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

function outside(ring: readonly Point[], p: Point): number {
  const r = ccw(ring);
  return Math.max(...r.map((a, i) => {
    const b = r[(i + 1) % r.length] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len < 1e-12 ? -Infinity : ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len;
  }));
}

const sizesOf = (kind: string): [number, number][] =>
  kind === "seatedRound" ? [0.9, 1.2, 1.5].map((t) => [roundSetDiameter(t, SEATED_REACH), roundSetDiameter(t, SEATED_REACH)]) : kind === "seatedDining" ? [[1.2, 2], [2.6, 2.1], [3.8, 2.1]] : [[1.2, 0.7]];

describe("the round chair in 3D (AC-05)", () => {
  it("a round seat and a back of 3–5 pieces along a curve in the back SEAT_BACK, inside the chair's box", () => {
    for (const [w, d, h] of [[0.45, 0.45, 0.9], [0.1, 0.1, 0.1], [0.3, 2, 1.2], [10, 0.45, 3]] as const) {
      const parts = roundChair(w, d, h);
      expect(parts.filter((p) => p.shape === "cylinder"), `${w}×${d}`).toHaveLength(1);
      const back = parts.filter((p) => p.shape === "ring");
      expect(back.length).toBeGreaterThanOrEqual(3);
      expect(back.length).toBeLessThanOrEqual(5);
      for (const p of back.flatMap(planOf)) expect(p.y, `${w}×${d}`).toBeGreaterThanOrEqual(d / 2 - SEAT_BACK - 1e-9);
      // Along a curve: the pieces' middles are not on one line across.
      const ys = back.map((r) => planOf(r).reduce((s, q) => s + q.y, 0) / 4);
      expect(Math.max(...ys) - Math.min(...ys), `${w}×${d}`).toBeGreaterThan(1e-4);
      for (const p of parts.flatMap(planOf)) expect(Math.abs(p.x) <= w / 2 + 1e-9 && Math.abs(p.y) <= d / 2 + 1e-9, `${w}×${d} (${p.x}, ${p.y})`).toBe(true);
    }
  });

  it("3D: a set with roundChairs has the round chair parts at each pose, inside the piece's box; without, square", () => {
    for (const kind of SETS) {
      for (const [w, d] of sizesOf(kind)) {
        const n = aggregateLayout(kind, w, d)?.chairs.length ?? 0;
        expect(n).toBeGreaterThan(0);
        const plain = appearanceOf(kind)("standard", w, d, 0.9);
        const round = appearanceOf(kind)("standard", w, d, 0.9, ROUND);
        const table = plain.length - n * chair(CHAIR_SIZE.w, CHAIR_SIZE.d, 0.9).length;
        expect(round.slice(0, table), kind).toEqual(plain.slice(0, table));
        expect(round, kind).toHaveLength(table + n * roundChair(CHAIR_SIZE.w, CHAIR_SIZE.d, 0.9).length);
        expect(round.filter((p) => p.shape === "cylinder" && p.at.z0 > 0.4), `${kind} seats`).toHaveLength(n);
        expect(plain.filter((p) => p.shape === "cylinder" && p.at.z0 > 0.4), `${kind} no round seat without`).toHaveLength(0); // a round table stands on cylinders
      }
    }
  });

  it("every part lies inside the piece's shape and range with round chairs, at 0.10–10 m and any turn", () => {
    const random = stream(17);
    const bad: string[] = [];
    for (const kind of SETS) {
      for (let i = 0; i < 60; i++) {
        const pick = (lo: number, hi: number) => lo + random() * (hi - lo);
        const [w, d] = [random() < 0.4 ? pick(0.1, 1) : pick(0.1, 10), random() < 0.4 ? pick(0.1, 1) : pick(0.1, 10)];
        const h = pick(0.1, 3);
        const item = { ...pieceOf(kind, "standard", w, d, h, random() * 360), options: ROUND };
        for (const f of partSolids("o", item, STYLE_3D).flatMap((s) => s.faces)) {
          for (const p of f.points) if (outside(item.ring, p) > MM || p.z < item.bottom - MM || p.z > item.top + MM) bad.push(`${kind} ${w.toFixed(3)}×${d.toFixed(3)}×${h.toFixed(3)}`);
        }
      }
    }
    expect([...new Set(bad)].slice(0, 5)).toEqual([]);
  });
});
