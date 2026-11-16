import { describe, expect, it } from "vitest";
import { hobBurners } from "../src/view/piece-counts";
import { objectLook } from "../src/view/furniture";
import type { Primitive } from "../src/view/scene-types";
import { appearanceOf } from "../src/view3d/parts";
import type { Panel } from "../src/view3d/parts/types";

// The hob's burners by width (catalog.07, AC-06): one count for the plan symbol and the 3D rings. Footprint space on
// the plan: x from −w/2 to w/2, y from −d to 0; in 3D: x and y about the centre, the front at −d/2.

type Arc = Extract<Primitive, { kind: "arc" }>;

const rings2d = (w: number, d: number): Arc[] =>
  objectLook("hobUnit", "standard", w, d, { line: "L", frontPx: 1, detail: "D" }).flatMap((p) => (p.kind === "arc" && p.color === "D" ? [p] : []));
const rings3d = (w: number, d: number): Panel[] => appearanceOf("hobUnit")("standard", w, d, 0.9).flatMap((p) => (p.panels ?? []).filter((q) => q.normal === "+z"));

/** Widths and depths from a narrow to a wide hob, each width with every depth. */
const WIDTHS = [0.1, 0.2, 0.3, 0.44, 0.45, 0.5, 0.6, 0.69, 0.7, 0.75, 0.84, 0.85, 0.9, 1.2, 3, 10];
const DEPTHS = [0.1, 0.3, 0.6, 0.9, 2, 10];
const sizes = WIDTHS.flatMap((w) => DEPTHS.map((d) => [w, d] as const));

describe("hobBurners (spec Preset lists)", () => {
  it("gives the preset widths' counts", () => {
    expect([0.3, 0.6, 0.75, 0.9].map(hobBurners)).toEqual([2, 4, 5, 6]);
  });

  it("2 below 0.45, 4 to 0.70, 5 to 0.85, then 6, at the centimetre the Width field shows", () => {
    expect([0.1, 0.44, 0.45, 0.69, 0.7, 0.84, 0.85, 10].map(hobBurners)).toEqual([2, 2, 4, 4, 5, 5, 6, 6]);
    expect([0.4449, 0.445, 0.6949, 0.695, 0.8449, 0.845].map(hobBurners)).toEqual([2, 4, 4, 5, 5, 6]);
  });
});

describe("the hob's symbol", () => {
  it("draws as many rings as burners, at every width", () => {
    for (const [w, d] of sizes) expect(rings2d(w, d), `${w} × ${d}`).toHaveLength(hobBurners(w));
  });

  it("every ring lies inside the footprint and no two overlap", () => {
    for (const [w, d] of sizes) {
      const rings = rings2d(w, d);
      for (const r of rings) {
        expect(Math.abs(r.center.x) + r.radius, `${w} × ${d} x`).toBeLessThanOrEqual(w / 2);
        expect(r.center.y + r.radius, `${w} × ${d} back`).toBeLessThanOrEqual(0);
        expect(r.center.y - r.radius, `${w} × ${d} front`).toBeGreaterThanOrEqual(-d);
      }
      rings.forEach((a, i) => {
        for (const b of rings.slice(i + 1)) expect(Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y), `${w} × ${d}`).toBeGreaterThan(a.radius + b.radius);
      });
    }
  });

  it("the 0.60 hob keeps its four rings exactly, the large ones on one diagonal", () => {
    expect(rings2d(0.6, 0.6).map((r) => [r.center.x, r.center.y, r.radius])).toEqual([
      [(-1 * 0.6) / 4, (1 * 0.6) / 4 - 0.6 / 2, 0.16 * 0.6],
      [(1 * 0.6) / 4, (1 * 0.6) / 4 - 0.6 / 2, 0.11 * 0.6],
      [(-1 * 0.6) / 4, (-1 * 0.6) / 4 - 0.6 / 2, 0.11 * 0.6],
      [(1 * 0.6) / 4, (-1 * 0.6) / 4 - 0.6 / 2, 0.16 * 0.6],
    ]);
  });

  const sorted = (rings: readonly Arc[]) => rings.map((r) => [r.center.x, r.center.y, r.radius].map((v) => Number(v.toFixed(4)))).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0));

  it("two burners stand in line along the depth, the larger at the front", () => {
    expect(sorted(rings2d(0.3, 0.6))).toEqual([[0, -0.45, 0.072], [0, -0.15, 0.0528]]);
  });

  it("five burners are the 2 × 2 and a centre wok, the largest", () => {
    expect(sorted(rings2d(0.75, 0.6))).toEqual([[-0.25, -0.45, 0.06], [-0.25, -0.15, 0.06], [0, -0.3, 0.09], [0.25, -0.45, 0.06], [0.25, -0.15, 0.06]]);
  });

  it("six burners are 3 × 2, the middle column larger", () => {
    expect(sorted(rings2d(0.9, 0.6))).toEqual([
      [-0.2813, -0.45, 0.06], [-0.2813, -0.15, 0.06], [0, -0.45, 0.078], [0, -0.15, 0.078], [0.2813, -0.45, 0.06], [0.2813, -0.15, 0.06],
    ]);
  });
});

describe("the hob's 3D rings", () => {
  it("has as many rings as the plan's symbol, at every width", () => {
    for (const [w, d] of sizes) expect(rings3d(w, d), `${w} × ${d}`).toHaveLength(hobBurners(w));
  });

  it("every ring lies on the worktop, inside the footprint, under the plan's centres; no two overlap", () => {
    for (const [w, d] of sizes) {
      const rings = rings3d(w, d);
      const plan = rings2d(w, d).map((r) => `${r.center.x.toFixed(6)},${(r.center.y + d / 2).toFixed(6)}`).sort();
      expect(rings.map((q) => `${((q.at.x0 + q.at.x1) / 2).toFixed(6)},${((q.at.y0 + q.at.y1) / 2).toFixed(6)}`).sort(), `${w} × ${d}`).toEqual(plan);
      for (const q of rings) {
        expect(q.at.x0, `${w} × ${d}`).toBeGreaterThanOrEqual(-w / 2);
        expect(q.at.x1, `${w} × ${d}`).toBeLessThanOrEqual(w / 2);
        expect(q.at.y0, `${w} × ${d}`).toBeGreaterThanOrEqual(-d / 2);
        expect(q.at.y1, `${w} × ${d}`).toBeLessThanOrEqual(d / 2);
        expect([q.at.z0, q.at.z1]).toEqual([0.9, 0.9]);
      }
      rings.forEach((a, i) => {
        for (const b of rings.slice(i + 1)) expect(a.at.x1 <= b.at.x0 || b.at.x1 <= a.at.x0 || a.at.y1 <= b.at.y0 || b.at.y1 <= a.at.y0, `${w} × ${d}`).toBe(true);
      });
    }
  });

  it("the 0.60 hob keeps its four squares: 0.18 m, at ±0.15", () => {
    const at = (x: number, y: number) => ({ x0: x - 0.09, x1: x + 0.09, y0: y - 0.09, y1: y + 0.09, z0: 0.9, z1: 0.9 });
    const rings = rings3d(0.6, 0.6).map((q) => q.at);
    expect(rings).toHaveLength(4);
    for (const want of [at(-0.15, -0.15), at(-0.15, 0.15), at(0.15, -0.15), at(0.15, 0.15)]) {
      const found = rings.some((b) => [b.x0 - want.x0, b.x1 - want.x1, b.y0 - want.y0, b.y1 - want.y1].every((v) => Math.abs(v) < 1e-9));
      expect(found, `${want.x0},${want.y0}`).toBe(true);
    }
  });
});
