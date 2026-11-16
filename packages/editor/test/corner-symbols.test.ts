import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, pieceShape, type Arms } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectLook } from "../src/view/furniture";
import type { Primitive } from "../src/view/scene-types";
import { insideRing, reach } from "./object-look-helpers";

// The corner symbols (catalog.14, AC-03): every `L` kind's symbol stays inside its six-corner outline (point in
// polygon, segments sampled along their length so none crosses the empty quarter) at its default size, its presets and
// the extreme sizes, with default, thinnest and deepest arms; the wardrobe and the counter draw the mockup's lines.

const TOL = 0.001;
const LOOK = { fill: "F", line: "L", frontPx: 3, linePx: 1, detail: "D" };
const ELL = OBJECT_KINDS.filter((k) => k.outline === "ell");
const near = (u: number, v: number) => Math.abs(u - v) < 1e-9;
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const joins = (s: { a: Point; b: Point }, a: Point, b: Point) =>
  (near(s.a.x, a.x) && near(s.a.y, a.y) && near(s.b.x, b.x) && near(s.b.y, b.y)) || (near(s.a.x, b.x) && near(s.a.y, b.y) && near(s.b.x, a.x) && near(s.b.y, a.y));

/** Points along a primitive: a segment's ends and three points between them, else what it reaches. */
const samples = (p: Primitive): Point[] =>
  p.kind === "segment" ? [0, 0.25, 0.5, 0.75, 1].map((t) => ({ x: p.a.x + t * (p.b.x - p.a.x), y: p.a.y + t * (p.b.y - p.a.y) })) : reach(p);

/** The sizes a kind is checked at: its default, its presets and the extremes, each with default, thinnest and deepest arms. */
function cases(id: string): { w: number; d: number; arms?: Arms }[] {
  const k = ELL.find((x) => x.id === id);
  const c = k?.configs[0];
  if (!k || !c) throw new Error(`no kind ${id}`);
  const sizes: [number, number][] = [[c.w, c.d], ...k.presets.map((p): [number, number] => [p.w, p.d.standard ?? 0]), [0.1, 0.1], [10, 10], [0.1, 10], [10, 0.1], [0.25, 0.25]];
  return sizes.flatMap(([w, d]) => [
    { w, d },
    ...(w >= 0.2 && d >= 0.2 ? [{ w, d, arms: { back: 0.1, left: 0.1 } }, { w, d, arms: { back: d - 0.1, left: w - 0.1 } }] : []),
  ]);
}

describe("the corner symbols stay inside their outline (AC-03)", () => {
  it("there are the corner desk, wardrobe, counter and sofa", () => {
    expect(ELL.map((k) => k.id)).toEqual(expect.arrayContaining(["cornerDesk", "cornerWardrobe", "cornerCounter", "cornerSofa"]));
  });

  for (const k of ELL) {
    it(`${k.id}: every point of its symbol lies inside the L, and it draws a detail`, () => {
      const bad: string[] = [];
      for (const { w, d, arms } of cases(k.id)) {
        const { outline } = pieceShape(k.id, w, d, arms);
        const look = objectLook(k.id, "standard", w, d, LOOK, {}, arms);
        const msg = `${w}×${d} arms ${arms ? `${arms.back}/${arms.left}` : "default"}`;
        expect(look.filter((p) => p.color === "D").length, msg).toBeGreaterThan(0);
        for (const q of look.flatMap(samples)) if (!insideRing(q, outline, TOL)) bad.push(`${msg} at (${q.x.toFixed(4)}, ${q.y.toFixed(4)})`);
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});

describe("the mockup's lines (catalog.14)", () => {
  const detail = (kind: string, w: number, d: number, arms: Arms) => segments(objectLook(kind, "standard", w, d, LOOK, {}, arms).filter((p) => p.color === "D"));

  it("the corner wardrobe: a rail down each arm at 0.45 of its depth, the door band at 0.90, the corner door's hinge line", () => {
    const [w, d, arms] = [1.5, 1.0, { back: 0.6, left: 0.6 }];
    const lines = detail("cornerWardrobe", w, d, arms);
    const rail = { x: -w / 2 + 0.45 * arms.left, y: -0.45 * arms.back };
    const band = { x: -w / 2 + 0.9 * arms.left, y: -0.9 * arms.back };
    expect(lines.some((s) => joins(s, rail, { x: w / 2 - 0.03, y: rail.y })), "back rail").toBe(true);
    expect(lines.some((s) => joins(s, rail, { x: rail.x, y: -d + 0.03 })), "left rail").toBe(true);
    expect(lines.some((s) => joins(s, band, { x: w / 2, y: band.y })), "back door band").toBe(true);
    expect(lines.some((s) => joins(s, band, { x: band.x, y: -d })), "left door band").toBe(true);
    expect(lines.some((s) => joins(s, band, { x: -w / 2 + arms.left, y: -arms.back })), "corner door hinge").toBe(true);
    // Hangers cross each rail: vertical ones over the back rail, horizontal ones over the left rail.
    const hangers = lines.filter((s) => (near(s.a.x, s.b.x) && s.a.y > rail.y !== s.b.y > rail.y) || (near(s.a.y, s.b.y) && s.a.x > rail.x !== s.b.x > rail.x));
    expect(hangers.length).toBeGreaterThan(10);
  });

  it("the corner wardrobe's door joints come about every 0.50 m down each arm", () => {
    const [w, d, arms] = [2.6, 2.6, { back: 0.6, left: 0.6 }];
    const band = { x: -w / 2 + 0.9 * arms.left, y: -0.9 * arms.back };
    const lines = detail("cornerWardrobe", w, d, arms);
    // Back arm: joints from the band to the inner edge; the run w/2 − band.x = 2.06 m makes 4 leaves, 3 joints.
    expect(lines.filter((s) => near(s.a.x, s.b.x) && [s.a.y, s.b.y].every((y) => near(y, band.y) || near(y, -arms.back)) && !near(s.a.y, s.b.y))).toHaveLength(3);
    // Left arm: the run d + band.y = 2.06 m makes 4 leaves, 3 joints.
    expect(lines.filter((s) => near(s.a.y, s.b.y) && [s.a.x, s.b.x].every((x) => near(x, band.x) || near(x, -w / 2 + arms.left)) && !near(s.a.x, s.b.x))).toHaveLength(3);
  });

  it("the corner counter: the worktop's front edge inset along both inner edges, and the mitre", () => {
    const [w, d, arms] = [2.4, 1.8, { back: 0.6, left: 0.6 }];
    const lines = detail("cornerCounter", w, d, arms);
    const i = 0.036;
    const corner = { x: -w / 2 + arms.left - i, y: -arms.back + i };
    expect(lines.some((s) => joins(s, { x: corner.x, y: -d }, corner)), "left arm's front edge").toBe(true);
    expect(lines.some((s) => joins(s, corner, { x: w / 2, y: corner.y })), "back arm's front edge").toBe(true);
    expect(lines.some((s) => joins(s, { x: -w / 2 + arms.left, y: -arms.back }, { x: -w / 2, y: 0 })), "mitre").toBe(true);
  });
});
