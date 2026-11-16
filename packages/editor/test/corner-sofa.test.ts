import { describe, expect, it } from "vitest";
import type { Arms } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectLook } from "../src/view/furniture";
import { cornerSofaSeats } from "../src/view/piece-counts";
import type { Primitive } from "../src/view/scene-types";
import { appearanceOf } from "../src/view3d/parts";
import { MAX_REPEAT } from "../src/view3d/parts/sizes";
import type { Box3 } from "../src/view3d/parts/types";

// The corner sofa (catalog.05, .14, seating.03, AC-03, AC-08): cushions at 0.70 m down each arm's run, from the inner
// corner to the armrest at its far end, and a corner seat; one owner (`cornerSofaSeats`) for the plan and 3D. Every
// `L` kind's symbol and parts staying inside the outline at the default and extreme sizes is checked for all of them
// in corner-symbols.test.ts and view3d/ell-parts.test.ts.

const LOOK = { fill: "F", line: "L", frontPx: 3, linePx: 1, detail: "D" };
const ARMS_90: Arms = { back: 0.9, left: 0.9 };
const near = (u: number, v: number) => Math.abs(u - v) < 1e-9;
const joins = (s: { a: Point; b: Point }, a: Point, b: Point) =>
  (near(s.a.x, a.x) && near(s.a.y, a.y) && near(s.b.x, b.x) && near(s.b.y, b.y)) || (near(s.a.x, b.x) && near(s.a.y, b.y) && near(s.b.x, a.x) && near(s.b.y, a.y));

const detail = (w: number, d: number, arms?: Arms): Primitive[] => objectLook("cornerSofa", "standard", w, d, LOOK, {}, arms).filter((p) => p.color === "D");
/** The symbol's cushions: each is a rounded rectangle with four corner arcs, and nothing else draws an arc. */
const symbolCushions = (w: number, d: number, arms?: Arms): number => detail(w, d, arms).filter((p) => p.kind === "arc").length / 4;

const boxesOf = (w: number, d: number, arms?: Arms, h = 0.9): Box3[] =>
  appearanceOf("cornerSofa")("standard", w, d, h, undefined, arms).map((p) => {
    if (p.shape !== "box") throw new Error("the corner sofa draws boxes only");
    return p.at;
  });
/** The 3D cushions: the boxes standing highest off the floor (on the seat base). */
const seatBoxes = (w: number, d: number, arms?: Arms): Box3[] => {
  const bs = boxesOf(w, d, arms);
  const z = Math.max(...bs.map((b) => b.z0));
  return bs.filter((b) => b.z0 === z);
};

describe("the corner sofa's cushion count (seating.03's 0.70 m rule per run)", () => {
  // Each run goes from the other arm's inner face to the armrest at its far end, min(0.15, run length / 4) wide:
  // seats = max(1, round((length − armrest) / 0.70)), the corner seat always on top.
  it("2.20 × 1.60, arms 0.90: the back run 1.15 m → 2, the left run 0.55 m → 1", () => {
    expect(cornerSofaSeats(2.2, 1.6, ARMS_90)).toEqual({ back: 2, left: 1 });
  });

  it("2.60 × 2.00 (the default), arms 0.90: the back run 1.55 m → 2, the left run 0.95 m → 1", () => {
    expect(cornerSofaSeats(2.6, 2.0, ARMS_90)).toEqual({ back: 2, left: 1 });
  });

  it("3.00 × 2.40, arms 0.90: the back run 1.95 m → 3, the left run 1.35 m → 2", () => {
    expect(cornerSofaSeats(3.0, 2.4, ARMS_90)).toEqual({ back: 3, left: 2 });
  });

  it("at least one cushion per run, however short", () => {
    expect(cornerSofaSeats(1.0, 1.0, ARMS_90)).toEqual({ back: 1, left: 1 });
    expect(cornerSofaSeats(0.1, 0.1, { back: 0.05, left: 0.05 })).toEqual({ back: 1, left: 1 });
  });
});

describe("the plan symbol and the 3D parts agree with the one count", () => {
  const SIZES: { w: number; d: number; arms?: Arms }[] = [
    { w: 2.6, d: 2.0 }, { w: 2.2, d: 1.6 }, { w: 3.0, d: 2.4 },
    { w: 3.0, d: 2.4, arms: { back: 0.6, left: 1.0 } }, { w: 4.2, d: 3.1, arms: ARMS_90 }, { w: 10, d: 10 },
  ];

  it("the symbol draws a cushion per seat on each run and the corner seat", () => {
    for (const { w, d, arms } of SIZES) {
      const n = cornerSofaSeats(w, d, arms ?? ARMS_90);
      expect(symbolCushions(w, d, arms), `${w}×${d}`).toBe(n.back + n.left + 1);
    }
  });

  it("the 3D parts stand a seat box per cushion (each run capped at MAX_REPEAT, parts.06)", () => {
    for (const { w, d, arms } of SIZES) {
      const n = cornerSofaSeats(w, d, arms ?? ARMS_90);
      expect(seatBoxes(w, d, arms).length, `${w}×${d}`).toBe(Math.min(MAX_REPEAT, n.back) + Math.min(MAX_REPEAT, n.left) + 1);
    }
  });

  it("at the presets the plan and 3D cushions are equal, the corner seat included: 2.20 × 1.60 → 4, 2.60 × 2.00 → 4, 3.00 × 2.40 → 6", () => {
    expect([[2.2, 1.6], [2.6, 2.0], [3.0, 2.4]].map(([w = 0, d = 0]) => [symbolCushions(w, d), seatBoxes(w, d).length])).toEqual([[4, 4], [4, 4], [6, 6]]);
  });
});

describe("the mockup's lines (catalog.14)", () => {
  it("the back along the outer edges at 0.24 of each arm's depth, and an armrest across each far end", () => {
    const [w, d, t1, t2] = [2.6, 2.0, 0.9, 0.9];
    const lines = detail(w, d, ARMS_90).flatMap((p) => (p.kind === "segment" ? [p] : []));
    const end = 0.15; // min(0.15, run length / 4) on both runs here
    const corner = { x: -w / 2 + 0.24 * t2, y: -0.24 * t1 };
    expect(lines.some((s) => joins(s, corner, { x: w / 2 - end, y: corner.y })), "the back arm's back").toBe(true);
    expect(lines.some((s) => joins(s, corner, { x: corner.x, y: -d + end })), "the left arm's back").toBe(true);
    expect(lines.some((s) => joins(s, { x: w / 2 - end, y: 0 }, { x: w / 2 - end, y: -t1 + 0.04 })), "the back arm's armrest").toBe(true);
    expect(lines.some((s) => joins(s, { x: -w / 2, y: -d + end }, { x: -w / 2 + t2 - 0.04, y: -d + end })), "the left arm's armrest").toBe(true);
  });

  it("in 3D: a back box along each outer edge to the piece's height, an armrest box at each far end", () => {
    const [w, d, h] = [2.6, 2.0, 0.9];
    const bs = boxesOf(w, d, ARMS_90, h);
    const tall = bs.filter((b) => b.z1 === h);
    expect(tall.some((b) => near(b.y1, d / 2) && near(b.x0, -w / 2)), "the back arm's back").toBe(true);
    expect(tall.some((b) => near(b.x0, -w / 2) && b.y0 < d / 2 - 0.9), "the left arm's back").toBe(true);
    const armrests = bs.filter((b) => b.z1 < h && b.z1 > 0.5);
    expect(armrests.some((b) => near(b.x1, w / 2) && near(b.y1, d / 2) && near(b.y0, d / 2 - 0.9)), "back armrest").toBe(true);
    expect(armrests.some((b) => near(b.y0, -d / 2) && near(b.x0, -w / 2) && near(b.x1, -w / 2 + 0.9)), "left armrest").toBe(true);
  });
});
