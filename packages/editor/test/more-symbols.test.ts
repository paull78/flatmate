import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, kindConfigs, kindOf, pieceShape } from "@fm/domain";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import type { Primitive } from "../src/view/scene-types";
import { insideRing, reach, roundRects } from "./object-look-helpers";

// The plant, cot, radiator, towel rail and rugs on the plan (catalog.14, .23): segments and arcs only (ux-polish.05), every
// point inside the kind's shape at its default, its presets and the extreme sizes, the mockup's lines at the default
// (docs/current/mockup-corners.mjs.txt). Footprint space: x from −w/2 to w/2, y from −d (front) to 0 (back).

const KINDS = ["plant", "cot", "radiator", "towelRail", "rug", "roundRug"] as const;
const LOOK = { fill: "F", line: "L", frontPx: 3, linePx: 1, detail: "D" };
const TOL = 1e-6;
const detail = (kind: string, w: number, d: number): Primitive[] => objectLook(kind, "standard", w, d, LOOK).filter((p) => p.color === "D");
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const arcs = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const near = (u: number, v: number, tol = 1e-9) => Math.abs(u - v) < tol;

function sizesOf(kind: string): [number, number][] {
  const c = kindConfigs(kind)[0];
  if (!c) throw new Error(`no kind ${kind}`);
  const presets = (kindOf(kind)?.presets ?? []).map((p): [number, number] => [p.w, p.d.standard ?? 0]);
  return [[c.w, c.d], ...presets, [0.1, 0.1], [10, 10], [0.1, 10], [10, 0.1], [0.25, 0.25], [0.13, 0.17]];
}

describe("every new symbol stays inside its shape", () => {
  for (const kind of KINDS) {
    it(`${kind}: its details lie inside its shape at its default, presets and the extreme sizes, drawn as segments and arcs`, () => {
      const bad: string[] = [];
      for (const [w, d] of sizesOf(kind)) {
        const { outline } = pieceShape(kind, w, d);
        const look = detail(kind, w, d);
        expect(look.length, `${w}×${d}`).toBeGreaterThan(0);
        for (const p of look) expect(["segment", "arc"], `${w}×${d}`).toContain(p.kind);
        for (const q of look.flatMap(reach)) if (!insideRing(q, outline, TOL)) bad.push(`${w}×${d} at (${q.x.toFixed(4)}, ${q.y.toFixed(4)})`);
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });

    it(`${kind}: draws a detail beyond its outline at every size checked`, () => {
      for (const [w, d] of sizesOf(kind)) {
        expect(furnitureSymbol(kind, "standard", w, d).length, `${w}×${d}`).toBeGreaterThan(pieceShape(kind, w, d).outline.length);
      }
    });
  }
});

describe("the mockup's lines (catalog.14, .23)", () => {
  it("the cot: the mattress inset 0.04, the pillow at its head, fifteen bars down each long side", () => {
    const [w, d] = [0.66, 1.26];
    const look = detail("cot", w, d);
    const boxes = roundRects(look);
    expect(boxes).toHaveLength(2);
    const [mattress, pillow] = [boxes.find((b) => b.x1 - b.x0 > 0.5), boxes.find((b) => b.x1 - b.x0 < 0.5)];
    expect(mattress).toMatchObject({ x0: expect.closeTo(-w / 2 + 0.04, 9), x1: expect.closeTo(w / 2 - 0.04, 9), y0: expect.closeTo(-d + 0.04, 9), y1: expect.closeTo(-0.04, 9) });
    expect(pillow).toMatchObject({ x0: expect.closeTo(-0.13, 9), x1: expect.closeTo(0.13, 9), y0: expect.closeTo(-0.17, 9), y1: expect.closeTo(-0.05, 9) });
    const bars = (x0: number, x1: number) => segments(look).filter((s) => near(Math.min(s.a.x, s.b.x), x0) && near(Math.max(s.a.x, s.b.x), x1) && near(s.a.y, s.b.y));
    expect(bars(-w / 2, -w / 2 + 0.04)).toHaveLength(15);
    expect(bars(w / 2 - 0.04, w / 2)).toHaveLength(15);
  });

  it("the radiator: its sections about every 0.05 m, across its depth less 0.015 each side", () => {
    const [w, d] = [0.8, 0.1];
    const lines = segments(detail("radiator", w, d));
    expect(lines).toHaveLength(15);
    for (const s of lines) {
      expect(s.a.x).toBeCloseTo(s.b.x, 9);
      expect(Math.max(s.a.y, s.b.y)).toBeCloseTo(-0.015, 9);
      expect(Math.min(s.a.y, s.b.y)).toBeCloseTo(-d + 0.015, 9);
    }
    const xs = lines.map((s) => s.a.x).sort((a, b) => a - b);
    xs.slice(1).forEach((x, i) => expect(x - (xs[i] ?? 0)).toBeCloseTo(0.05, 9));
    expect(segments(detail("radiator", 1.2, d))).toHaveLength(23);
  });

  it("the towel rail: two posts and a double bar, the mockup's sizes", () => {
    const [w, d] = [0.5, 0.1];
    const look = detail("towelRail", w, d);
    const posts = arcs(look);
    expect(posts.map((p) => [p.center.x, p.center.y, p.radius]).sort()).toEqual([[-w / 2 + 0.04, -d / 2, 0.02], [w / 2 - 0.04, -d / 2, 0.02]]);
    const bars = segments(look);
    expect(bars).toHaveLength(2);
    for (const s of bars) {
      expect(Math.min(s.a.x, s.b.x)).toBeCloseTo(-w / 2 + 0.06, 9);
      expect(Math.max(s.a.x, s.b.x)).toBeCloseTo(w / 2 - 0.06, 9);
    }
    expect(bars.map((s) => s.a.y).sort((a, b) => a - b).map((y) => Number(y.toFixed(9)))).toEqual([-0.062, -0.038]);
  });

  it("the rug: an inset border, the body's two ends and fringes every 0.05 m on the short ends", () => {
    const [w, d] = [2, 1.4];
    const [f, b] = [0.05, 0.098]; // the fringe, 0.05; the border, 0.07 of the depth
    const look = detail("rug", w, d);
    const lines = segments(look);
    const fringes = lines.filter((s) => near(s.a.y, s.b.y) && near(Math.abs(s.a.x - s.b.x), f));
    expect(fringes).toHaveLength(2 * 27); // from 0.04 under the back, while over 0.02 above the front
    expect(fringes.filter((s) => Math.min(s.a.x, s.b.x) < 0).every((s) => near(Math.min(s.a.x, s.b.x), -w / 2))).toBe(true);
    expect(fringes.filter((s) => Math.max(s.a.x, s.b.x) > 0).every((s) => near(Math.max(s.a.x, s.b.x), w / 2))).toBe(true);
    const border = lines.filter((s) => !fringes.includes(s));
    expect(border).toHaveLength(4);
    const xs = border.flatMap((s) => [s.a.x, s.b.x]);
    const ys = border.flatMap((s) => [s.a.y, s.b.y]);
    expect(Math.min(...xs)).toBeCloseTo(-w / 2 + f + b, 9);
    expect(Math.max(...xs)).toBeCloseTo(w / 2 - f - b, 9);
    expect(Math.max(...ys)).toBeCloseTo(-b, 9);
    expect(Math.min(...ys)).toBeCloseTo(-d + b, 9);
    // The body's ends are outline lines, in the line colour, across the whole depth.
    const ends = objectLook("rug", "standard", w, d, LOOK).filter((p) => p.color === "L" && p.kind === "segment" && near(Math.abs(p.a.x), w / 2 - f));
    expect(ends).toHaveLength(2);
  });

  it("a rug turned long by its depth keeps its fringes on its short ends", () => {
    const [w, d] = [1.4, 2];
    const fringes = segments(detail("rug", w, d)).filter((s) => near(s.a.x, s.b.x) && Math.abs(s.a.y - s.b.y) < 0.051);
    expect(fringes).toHaveLength(2 * 27);
    expect(new Set(fringes.map((s) => Number(Math.max(s.a.y, s.b.y).toFixed(6))))).toEqual(new Set([0, -d + 0.05]));
  });

  it("a very deep rug stays at most 60 fringes a side", () => {
    expect(segments(detail("rug", 10, 10)).length).toBeLessThanOrEqual(2 * 60 + 4);
  });

  it("the round rug: one inner ring, 0.06 of the diameter in", () => {
    const D = 1.6;
    const lines = segments(detail("roundRug", D, D));
    expect(lines.length).toBeGreaterThanOrEqual(32);
    for (const s of lines) expect(Math.hypot(s.a.x, s.a.y + D / 2)).toBeCloseTo(D / 2 - 0.06 * D, 9);
    for (const s of segments(detail("roundRug", 3, 3))) expect(Math.hypot(s.a.x, s.a.y + 1.5)).toBeCloseTo(1.4, 9); // at most 0.10 in
  });

  it("a radiator and a towel rail of one size draw differently (catalog.23)", () => {
    expect(arcs(detail("radiator", 0.5, 0.1))).toEqual([]);
    expect(segments(detail("radiator", 0.5, 0.1)).length).toBeGreaterThan(2);
  });
});

describe("the heavier front line (the kinds' `front` column, catalog.54)", () => {
  const heavy = (kind: string, w: number, d: number): Primitive[] => objectLook(kind, "standard", w, d, LOOK).filter((p) => p.kind === "segment" && "px" in p.width && p.width.px === LOOK.frontPx);

  it.each([["plant", 0.4, 0.4], ["rug", 2, 1.4], ["roundRug", 1.6, 1.6]] as const)("%s has none", (kind, w, d) => {
    expect(kindOf(kind)?.front).toBe(false);
    expect(heavy(kind, w, d)).toEqual([]);
  });

  it("every other kind but a set keeps it", () => {
    expect(OBJECT_KINDS.filter((k) => !k.front).map((k) => k.id)).toEqual(["toilet", "bidet", "washbasin", "nightstand", "plant", "rug", "roundRug", "palm", "fern", "rosette", "stool", "wheelWell", "beam", "coatStand"]);
    expect(heavy("roundTable", 1, 1).length).toBeGreaterThan(0);
    expect(heavy("sofa", 2.1, 0.9).length).toBeGreaterThan(0);
  });
});
