import { describe, expect, it } from "vitest";
import { appearanceOf } from "../../src/view3d/parts";
import type { Part } from "../../src/view3d/parts/types";

// The hung pieces' and the coat stand's 3D bodies (hangings step 03, AC-03): what makes each read as itself; the
// every-kind rules (inside the shape, fill, no overlap, face cap) are parts-properties.test.ts's.

const parts = (kind: string, w: number, d: number, h: number): readonly Part[] => appearanceOf(kind)("standard", w, d, h);
const boxes = (ps: readonly Part[]) => ps.flatMap((p) => (p.shape === "box" || p.shape === "cylinder" ? [p] : []));
const panels = (ps: readonly Part[]) => ps.flatMap((p) => p.panels ?? []);

describe("the hung pieces in 3D (step 03)", () => {
  it("a picture: a frame in front of a backing, its print a part set back inside the frame, with no panel to tie with the frame's depth", () => {
    const ps = parts("picture", 0.53, 0.03, 0.73);
    expect(panels(ps)).toEqual([]); // a panel 0.5 mm off the dark frame showed through as dark triangles from afar (the user's review)
    const print = boxes(ps).find((p) => p.slot === "linen");
    const frameFront = Math.min(...boxes(ps).filter((p) => p.slot === "dark").map((p) => p.at.y0));
    expect(print && print.at.x0 > -0.53 / 2 && print.at.x1 < 0.53 / 2 && print.at.z0 > 0 && print.at.z1 < 0.73).toBe(true);
    expect(print && print.at.y0 - frameFront).toBeGreaterThanOrEqual(0.003); // well apart in any depth buffer
  });

  it("a mirror: its glass a metal part inside its wood frame", () => {
    const ps = parts("mirror", 0.6, 0.03, 0.8);
    expect(panels(ps)).toEqual([]);
    expect(boxes(ps).some((p) => p.slot === "metal" && p.at.x0 > -0.3 && p.at.x1 < 0.3)).toBe(true);
  });

  it("a clock: a body wider at its middle than at its top and bottom, with a pale dial", () => {
    const bs = boxes(parts("clock", 0.3, 0.05, 0.3));
    const width = (b: (typeof bs)[number]) => b.at.x1 - b.at.x0;
    const byZ = [...bs].sort((a, b) => a.at.z0 - b.at.z0);
    expect(byZ.length).toBeGreaterThanOrEqual(3);
    expect(width(byZ[1]!)).toBeGreaterThan(width(byZ[0]!));
    expect(width(byZ[1]!)).toBeGreaterThan(width(byZ[byZ.length - 1]!));
    expect(panels(parts("clock", 0.3, 0.05, 0.3)).some((p) => p.slot === "ceramic")).toBe(true);
  });

  it("a wall TV: a dark screen at the front", () => {
    const front = boxes(parts("wallTv", 1.24, 0.06, 0.72)).find((b) => b.at.y0 === -0.03);
    expect(front?.slot).toBe("dark");
  });

  it("a pegboard: a board against the wall and tools in front of it, more on a wider board", () => {
    const tools = (w: number) => boxes(parts("pegboard", w, 0.1, 0.6)).filter((b) => b.at.y0 === -0.05).length;
    expect(tools(0.6)).toBeGreaterThanOrEqual(2);
    expect(tools(1.2)).toBeGreaterThan(tools(0.6));
  });

  it("coat hooks: a rail against the wall and hooks reaching the front", () => {
    const bs = boxes(parts("coatHooks", 0.9, 0.08, 0.12));
    expect(bs.filter((b) => b.at.y0 === -0.04).length).toBeGreaterThanOrEqual(3);
  });

  it("a coat stand: a base, a pole at the middle up to the top, and hooks at the top", () => {
    const ps = parts("coatStand", 0.45, 0.45, 1.75);
    const pole = boxes(ps).find((b) => b.shape === "cylinder" && b.at.z1 === 1.75);
    expect(pole && Math.abs(pole.at.x0 + pole.at.x1) < 1e-9 && pole.at.x1 - pole.at.x0 < 0.08).toBe(true);
    expect(ps.some((p) => p.shape === "outline" && p.z0 === 0)).toBe(true);
    expect(boxes(ps).filter((b) => b.shape === "box" && b.at.z1 > 1.5).length).toBeGreaterThanOrEqual(4);
  });

  it("a towel rail: a ladder, two posts the full height at its ends, bars between them all the way up, brackets to the wall", () => {
    const [w, d, h] = [0.5, 0.1, 1.2];
    const bs = boxes(parts("towelRail", w, d, h));
    const posts = bs.filter((b) => b.shape === "cylinder" && b.at.z0 === 0 && b.at.z1 === h);
    expect(posts.map((p) => Math.round((p.at.x0 + p.at.x1) * 1e6))).toHaveLength(2);
    expect(Math.min(...posts.map((p) => p.at.x0))).toBeCloseTo(-w / 2, 9);
    expect(Math.max(...posts.map((p) => p.at.x1))).toBeCloseTo(w / 2, 9);
    const inner = Math.min(...posts.map((p) => p.at.x1));
    const bars = bs.filter((b) => b.shape === "box" && b.at.x0 <= inner + 1e-9 && b.at.x1 - b.at.x0 > w / 2);
    expect(bars.length).toBeGreaterThanOrEqual(10);
    const zs = bars.map((b) => b.at.z0).sort((a, b) => a - b);
    expect(zs[0]).toBeLessThan(0.2 * h); // from near the bottom
    expect(zs.at(-1)).toBeGreaterThan(0.85 * h); // to near the top
    expect(Math.max(...zs.slice(1).map((z, i) => z - (zs[i] ?? 0)))).toBeLessThan(0.15); // no tall gap
    expect(bs.filter((b) => b.shape === "box" && b.at.y1 === d / 2)).toHaveLength(4); // brackets against the wall
    const taller = boxes(parts("towelRail", 0.6, 0.1, 1.5)).filter((b) => b.shape === "box" && b.at.x1 - b.at.x0 > 0.3).length;
    expect(taller).toBeGreaterThan(bars.length);
  });

  describe("a pegboard's tools (the user's review)", () => {
    const at = (w: number, h = 0.6) => boxes(parts("pegboard", w, 0.1, h)).filter((b) => b.shape === "box");
    const width = (b: { at: { x0: number; x1: number } }) => b.at.x1 - b.at.x0;
    const height = (b: { at: { z0: number; z1: number } }) => b.at.z1 - b.at.z0;
    const above = (low: { at: { z1: number; x0: number; x1: number } }, high: { at: { z0: number; x0: number; x1: number } }) =>
      Math.abs(low.at.z1 - high.at.z0) < 1e-9 && low.at.x0 < high.at.x1 && high.at.x0 < low.at.x1;

    it.each([0.6, 0.9, 1.2])("%s wide: a drill, an orange body wider than tall over a dark grip, with a steel nose", (w) => {
      const bs = at(w);
      const body = bs.find((b) => b.slot === "flame" && width(b) > height(b));
      expect(body).toBeDefined();
      expect(bs.some((b) => b.slot === "dark" && body && above(b, body) && width(b) < width(body))).toBe(true);
      expect(bs.some((b) => b.slot === "metal" && body && Math.abs(b.at.x0 - body.at.x1) < 1e-9)).toBe(true);
    });

    it.each([0.6, 0.9, 1.2])("%s wide: screwdrivers, a thin steel shaft under each handle; a hammer, a dark head over a wood handle", (w) => {
      const bs = at(w);
      const shafts = bs.filter((b) => b.slot === "metal" && width(b) < 0.012 && bs.some((h) => h !== b && above(b, h) && width(h) > width(b)));
      expect(shafts.length).toBeGreaterThanOrEqual(2);
      expect(bs.some((h) => h.slot === "wood" && bs.some((d) => d.slot === "dark" && above(h, d) && width(d) > 3 * width(h)))).toBe(true);
    });

    it("small bins along the bottom, labelled, more on a wider board", () => {
      const bins = (w: number) => at(w).filter((b) => b.at.z1 < 0.4 * 0.6 && (b.panels ?? []).length > 0);
      expect(bins(0.6).length).toBeGreaterThanOrEqual(3);
      expect(bins(1.2).length).toBeGreaterThan(bins(0.6).length);
    });
  });

  it("a radiator: slim panels side by side at the front with narrow gaps, off the wall on rails and brackets, connectors at its left end, valves under", () => {
    const [w, d, h] = [0.8, 0.1, 0.6];
    const bs = boxes(parts("radiator", w, d, h)).filter((b) => b.shape === "box");
    const panels = bs.filter((b) => b.at.y0 === -d / 2 && b.at.z1 === h);
    expect(panels.length).toBeGreaterThanOrEqual(9);
    const xs = [...panels].sort((a, b) => a.at.x0 - b.at.x0);
    for (const [i, p] of xs.entries()) {
      expect(p.at.x1 - p.at.x0).toBeLessThan(0.09);
      expect(p.at.y1 - p.at.y0).toBeLessThan(0.4 * d); // a thin front, off the wall
      const next = xs[i + 1];
      if (next) expect(next.at.x0 - p.at.x1).toBeGreaterThan(0);
      if (next) expect(next.at.x0 - p.at.x1).toBeLessThan(0.01);
    }
    expect(bs.filter((b) => b.at.y1 === d / 2)).toHaveLength(2); // brackets
    expect(bs.filter((b) => b.at.x0 === -w / 2)).toHaveLength(2); // connectors, top and bottom
    expect(bs.filter((b) => b.at.z0 === 0)).toHaveLength(2); // valves
    expect(panels.every((p) => p.slot === "laminate")).toBe(true);
  });
});
