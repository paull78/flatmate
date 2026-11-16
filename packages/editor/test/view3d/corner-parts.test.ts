import { describe, expect, it } from "vitest";
import type { Arms } from "@fm/domain";
import { appearanceOf } from "../../src/view3d/parts";
import type { Box3, Part } from "../../src/view3d/parts/types";

// The corner wardrobe and counter in 3D (catalog.14, AC-08): boxes per arm, never in the empty quarter (the every-L
// checks are in ell-parts.test.ts). The wardrobe: a plinth, a carcass and door fronts on both inner faces; the counter:
// a plinth, a carcass and a worktop per arm, the worktop's top at the piece's height. Local frame: y from the front
// (−d/2) to the back (d/2), the back arm [d/2 − t1, d/2], the left arm [−w/2, −w/2 + t2] below it.

const near = (u: number, v: number) => Math.abs(u - v) < 1e-9;
const boxes = (parts: readonly Part[]): Box3[] =>
  parts.map((p) => {
    if (p.shape !== "box") throw new Error("the corner kinds draw boxes only");
    return p.at;
  });
/** The plan area of the boxes standing across height z. */
const areaAt = (bs: readonly Box3[], z: number) => bs.filter((b) => b.z0 < z && z < b.z1).reduce((sum, b) => sum + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
const ellArea = (w: number, d: number, a: Arms) => w * a.back + a.left * (d - a.back);

const SIZES: { w: number; d: number; arms: Arms }[] = [
  { w: 1.5, d: 1.0, arms: { back: 0.6, left: 0.6 } },
  { w: 2.4, d: 1.8, arms: { back: 0.6, left: 0.6 } },
  { w: 3.0, d: 2.4, arms: { back: 0.45, left: 0.75 } },
  { w: 10, d: 10, arms: { back: 9.9, left: 0.1 } },
];

describe("the corner wardrobe's parts", () => {
  const H = 2.05;
  const partsOf = (w: number, d: number, arms: Arms) => appearanceOf("cornerWardrobe")("standard", w, d, H, undefined, arms);

  it("fills the L above its plinth (but the gaps between doors), and every part is a box from the floor to its height", () => {
    for (const { w, d, arms } of SIZES) {
      const bs = boxes(partsOf(w, d, arms));
      expect(areaAt(bs, H / 2), `${w}×${d}`).toBeCloseTo(ellArea(w, d, arms), 2);
      expect(Math.min(...bs.map((b) => b.z0))).toBe(0);
      expect(Math.max(...bs.map((b) => b.z1))).toBe(H);
    }
  });

  it("stands its door fronts on both inner faces, thin wood boxes that cover each inner edge", () => {
    for (const { w, d, arms } of SIZES) {
      const parts = partsOf(w, d, arms);
      const seam = d / 2 - arms.back;
      const innerX = -w / 2 + arms.left;
      const doors = parts.flatMap((p) => (p.shape === "box" && p.slot === "wood" ? [p.at] : []));
      const backDoors = doors.filter((b) => near(b.y0, seam) && b.y1 - b.y0 <= 0.05);
      const leftDoors = doors.filter((b) => near(b.x1, innerX) && b.x1 - b.x0 <= 0.05);
      expect(backDoors.length, `${w}×${d} back`).toBeGreaterThanOrEqual(1);
      expect(leftDoors.length, `${w}×${d} left`).toBeGreaterThanOrEqual(1);
      // Up to a door gap (3 mm) from each arm's end, and the two runs meet at the inner corner.
      expect(Math.max(...backDoors.map((b) => b.x1)), `${w}×${d}`).toBeCloseTo(w / 2, 2);
      expect(Math.min(...leftDoors.map((b) => b.y0)), `${w}×${d}`).toBeCloseTo(-d / 2, 2);
      expect(Math.min(...backDoors.map((b) => b.x0)), `${w}×${d}`).toBeLessThan(innerX);
    }
  });

  it("at the default size, a door about every 0.50 m down each arm", () => {
    const parts = partsOf(1.5, 1.0, { back: 0.6, left: 0.6 });
    const doors = parts.flatMap((p) => (p.shape === "box" && p.slot === "wood" && Math.min(p.at.x1 - p.at.x0, p.at.y1 - p.at.y0) <= 0.05 ? [p] : []));
    expect(doors.length).toBe(3); // the back run about 0.9 m: 2 doors; the left run 0.40 m: 1
  });
});

describe("the corner counter's parts", () => {
  const H = 0.9;
  const partsOf = (w: number, d: number, arms: Arms, h = H) => appearanceOf("cornerCounter")("standard", w, d, h, undefined, arms);

  it("a wood worktop over each arm with its top at the piece's height, a laminate carcass and a dark plinth under it", () => {
    for (const { w, d, arms } of SIZES) {
      const parts = partsOf(w, d, arms);
      const worktops = parts.flatMap((p) => (p.shape === "box" && p.slot === "wood" ? [p.at] : []));
      expect(worktops, `${w}×${d}`).toHaveLength(2);
      for (const b of worktops) expect(b.z1, `${w}×${d}`).toBe(H);
      const top = Math.min(...worktops.map((b) => b.z0));
      expect(areaAt(worktops, (top + H) / 2), `${w}×${d} worktop`).toBeCloseTo(ellArea(w, d, arms), 9);
      const carcass = parts.flatMap((p) => (p.shape === "box" && p.slot === "laminate" ? [p.at] : []));
      expect(carcass, `${w}×${d}`).toHaveLength(2);
      expect(areaAt(carcass, top - 0.01), `${w}×${d} carcass`).toBeCloseTo(ellArea(w, d, arms), 9);
      expect(parts.filter((p) => p.slot === "dark").length, `${w}×${d}`).toBe(2);
    }
  });

  it("follows the piece's height", () => {
    const parts = partsOf(2.4, 1.8, { back: 0.6, left: 0.6 }, 1.05);
    expect(Math.max(...boxes(parts).map((b) => b.z1))).toBe(1.05);
  });
});
