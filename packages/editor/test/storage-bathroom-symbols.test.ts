import { describe, expect, it } from "vitest";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import type { Primitive } from "../src/view/scene-types";
import { reach, roundRects } from "./object-look-helpers";

// The storage and bathroom symbols of the seating cycle (seating.04, AC-03): wardrobe, chest of drawers, TV unit, shelf,
// bathtub, shower tray.

type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;

/** The detail lines: the outline and the front take the line colour "L", so only the symbol's inner parts are "D". */
const D = (kind: string, w: number, d: number) =>
  objectLook(kind, "standard", w, d, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const arcs = (ps: readonly Primitive[]): Arc[] => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const near = (u: number, v: number, tol = 1e-9) => Math.abs(u - v) < tol;
const full = (a: Arc) => near(a.to - a.from, 2 * Math.PI, 1e-12);
const vertical = (s: Segment) => near(s.a.x, s.b.x);
const horizontal = (s: Segment) => near(s.a.y, s.b.y);
const ys = (s: Segment) => [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)] as const;
/** The k-th item, which the test needs to exist. */
function nth<T>(items: readonly T[], k: number): T {
  const item = items[k];
  if (item === undefined) throw new Error(`no item ${k} of ${items.length}`);
  return item;
}
const xs = (s: Segment) => [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] as const;

describe("storage and bathroom symbols (seating.04)", () => {
  /** The wardrobe's rail (the horizontal line at −0.45·d) and the lines that cross it (the hangers). */
  const wardrobe = (w: number, d: number) => {
    const lines = segs(D("wardrobe", w, d));
    const rail = lines.filter((s) => horizontal(s) && near(s.a.y, -0.45 * d));
    const hangers = lines.filter((s) => !rail.includes(s) && ys(s)[0] < -0.45 * d && ys(s)[1] > -0.45 * d);
    return { lines, rail, hangers };
  };

  it("wardrobe hangers are perpendicular to the rail", () => {
    const [w, d] = [1.2, 0.6];
    const { rail, hangers } = wardrobe(w, d);
    expect(rail).toHaveLength(1);
    expect(xs(nth(rail, 0))).toEqual([expect.closeTo(-w / 2 + 0.03, 9), expect.closeTo(w / 2 - 0.03, 9)]);
    // n = max(3, floor(w / 0.09)) = 13 shares, so 12 hangers, each min(0.20, 0.32·d) either side of the rail.
    expect(hangers).toHaveLength(12);
    hangers.sort((a, b) => a.a.x - b.a.x).forEach((s, k) => {
      expect(s.a.x, `hanger ${k}`).toBeCloseTo(s.b.x, 12);
      expect(s.a.x, `hanger ${k}`).toBeCloseTo(-w / 2 + (w * (k + 1)) / 13, 9);
      expect(ys(s), `hanger ${k}`).toEqual([expect.closeTo(-0.27 - 0.192, 9), expect.closeTo(-0.27 + 0.192, 9)]);
    });
    for (const [sw, sd] of [[0.5, 0.6], [3, 0.6], [1, 1]] as const) {
      const sized = wardrobe(sw, sd).hangers;
      expect(sized.length, `${sw}×${sd}`).toBe(Math.max(3, Math.floor(sw / 0.09 + 1e-9)) - 1);
      for (const s of sized) expect(vertical(s), `${sw}×${sd}`).toBe(true);
    }
  });

  it("wardrobe door leaves", () => {
    const d = 0.6;
    /** The door joints: vertical lines from the band at −0.90·d to the front. */
    const joints = (w: number) => segs(D("wardrobe", w, d)).filter((s) => vertical(s) && near(ys(s)[0], -d) && near(ys(s)[1], -0.9 * d));
    for (const [w, leaves] of [[1.2, 2], [2, 4], [0.4, 1], [0.75, 2], [1.5, 3]] as const) {
      const found = joints(w).map((s) => s.a.x).sort((a, b) => a - b);
      expect(found, `${w}`).toEqual(Array.from({ length: leaves - 1 }, (_, k) => expect.closeTo(-w / 2 + (w * (k + 1)) / leaves, 9)));
      const band = segs(D("wardrobe", w, d)).filter((s) => horizontal(s) && near(s.a.y, -0.9 * d) && near(xs(s)[1] - xs(s)[0], w));
      expect(band, `${w} band`).toHaveLength(1);
    }
  });

  it("chest of drawers has an inset top above the drawer strip", () => {
    const [w, d] = [1, 0.5];
    const lines = segs(D("drawers", w, d));
    const strip = -0.86 * d;
    for (const [ax, ay, bx, by] of [[-0.47, strip + 0.03, 0.47, strip + 0.03], [0.47, strip + 0.03, 0.47, -0.03], [-0.47, -0.03, 0.47, -0.03], [-0.47, strip + 0.03, -0.47, -0.03]] as const) {
      const hit = lines.filter((s) => near(xs(s)[0], Math.min(ax, bx)) && near(xs(s)[1], Math.max(ax, bx)) && near(ys(s)[0], Math.min(ay, by)) && near(ys(s)[1], Math.max(ay, by)));
      expect(hit, `top edge ${ax},${ay} → ${bx},${by}`).toHaveLength(1);
    }
    // Today's strip, pulls and divider stay: 4 top lines + strip + 2 pulls + 1 divider.
    expect(lines).toHaveLength(8);
  });

  it("TV screen is thin and at the back", () => {
    for (const [w, tw] of [[1.2, 1.02], [2, 1.4]] as const) {
      const detail = D("tvUnit", w, 0.4);
      const lines = segs(detail);
      // The screen: a plain rectangle, tw = min(1.40, 0.85·w) wide, from y −0.11 to −0.06 (0.05 deep).
      const top = lines.filter((s) => horizontal(s) && near(s.a.y, -0.06));
      expect(top, `${w} top`).toHaveLength(1);
      expect(xs(nth(top, 0)), `${w} top`).toEqual([expect.closeTo(-tw / 2, 9), expect.closeTo(tw / 2, 9)]);
      const sides = lines.filter((s) => vertical(s) && near(Math.abs(s.a.x), tw / 2));
      expect(sides, `${w} sides`).toHaveLength(2);
      for (const s of sides) expect(ys(s)[1] - ys(s)[0], `${w} screen depth`).toBeCloseTo(0.05, 9);
      expect(Math.max(...detail.flatMap(reach).map((p) => p.y)), `${w} back`).toBeCloseTo(-0.06, 9);
      // The stand plate: a rounded rectangle min(0.40, 0.35·tw) wide, from −0.30 to −0.11, radius 0.02.
      const bw = Math.min(0.4, 0.35 * tw);
      expect(roundRects(detail), `${w} stand`).toEqual([{ x0: expect.closeTo(-bw / 2, 9), x1: expect.closeTo(bw / 2, 9), y0: expect.closeTo(-0.3, 9), y1: expect.closeTo(-0.11, 9), r: expect.closeTo(0.02, 9) }]);
    }
  });

  it("shelf spines stay inside and vary", () => {
    const [w, d] = [0.8, 0.4];
    const lines = segs(D("shelf", w, d));
    // Each book is its left side (from the back) and its front.
    const fronts = lines.filter(horizontal).sort((a, b) => xs(a)[0] - xs(b)[0]);
    const depths = new Set(fronts.map((s) => Math.round((-s.a.y / d) * 1000)));
    expect(depths.size).toBeGreaterThanOrEqual(3);
    for (const s of lines) for (const x of xs(s)) expect(x >= -w / 2 + 0.03 - 1e-9 && x <= w / 2 - 0.03 + 1e-9, `x ${x}`).toBe(true);
    for (const s of lines.filter(vertical)) expect(near(ys(s)[1], 0), "spines start at the back").toBe(true);
    // The first book starts 0.03 m from the left end; a 0.06 m gap after every eight books.
    expect(xs(nth(fronts, 0))[0]).toBeCloseTo(-w / 2 + 0.03, 9);
    const gaps = fronts.slice(1).map((s, k) => xs(s)[0] - xs(nth(fronts, k))[1]);
    expect(gaps.map((g, k) => (near(g, 0.06) ? k + 1 : -1)).filter((k) => k > 0)).toEqual([8, 16]);
    expect(fronts.length).toBe(21);
  });

  it("bathtub head end is round, drain at the foot", () => {
    const [w, d] = [1.7, 0.7];
    const detail = D("bathtub", w, d);
    // The head end: two quarter arcs of 0.48 × the inner depth (0.56) on the +x side.
    const head = arcs(detail).filter((a) => !full(a) && a.radius >= 0.2);
    expect(head).toHaveLength(2);
    for (const a of head) {
      expect(a.radius).toBeCloseTo(0.48 * 0.56, 9);
      expect(a.center.x).toBeGreaterThan(0);
    }
    // The foot end: tight corners of 0.06 on the −x side.
    const foot = arcs(detail).filter((a) => !full(a) && a.radius < 0.2);
    expect(foot.map((a) => a.radius)).toEqual([expect.closeTo(0.06, 9), expect.closeTo(0.06, 9)]);
    for (const a of foot) expect(a.center.x).toBeLessThan(0);
    // The drain: a full circle r 0.025 within 0.2 m of the foot (−x), 0.12 m from the inner foot wall.
    const drains = arcs(detail).filter(full);
    expect(drains).toHaveLength(1);
    expect(nth(drains, 0).center.x + w / 2).toBeLessThan(0.2);
    expect(nth(drains, 0).center.x).toBeCloseTo(-w / 2 + 0.07 + 0.12, 9);
    expect(nth(drains, 0).radius).toBeCloseTo(0.025, 9);
    // The rim is 0.07 m: the basin's lines reach exactly the inset rectangle.
    const basin = detail.filter((p) => p.kind === "arc" || Math.min(...reach(p).map((q) => q.x)) > -w / 2 + 0.06);
    const pts = basin.flatMap(reach);
    expect([Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))])
      .toEqual([-w / 2 + 0.07, w / 2 - 0.07, -d + 0.07, -0.07].map((v) => expect.closeTo(v, 9)));
    // The tap: a small rectangle on the foot rim.
    const tap = segs(detail).filter((s) => xs(s)[1] < -w / 2 + 0.06);
    expect(tap).toHaveLength(4);
  });

  it("shower tray slope lines end on the drain ring", () => {
    const [w, d] = [0.8, 0.8];
    const detail = D("showerTray", w, d);
    const rings = arcs(detail).filter(full).sort((a, b) => b.radius - a.radius);
    expect(rings.map((a) => [a.center.x, a.center.y, a.radius])).toEqual([[0, -0.4, 0.05], [0, -0.4, 0.025]].map((r) => r.map((v) => expect.closeTo(v, 9))));
    const slopes = segs(detail).filter((s) => !vertical(s) && !horizontal(s));
    expect(slopes).toHaveLength(4);
    const corners = [[-0.36, -0.76], [0.36, -0.76], [0.36, -0.04], [-0.36, -0.04]] as const;
    for (const s of slopes) {
      const fromCentre = [s.a, s.b].map((p) => Math.hypot(p.x, p.y + 0.4)).sort((a, b) => a - b);
      expect(fromCentre[0], "drain end").toBeCloseTo(0.05, 9);
      const outer = Math.hypot(s.a.x, s.a.y + 0.4) > Math.hypot(s.b.x, s.b.y + 0.4) ? s.a : s.b;
      expect(corners.some(([x, y]) => near(outer.x, x) && near(outer.y, y)), `rim corner ${outer.x},${outer.y}`).toBe(true);
    }
    // The 0.04 m rim: the tray's inset rectangle.
    expect(segs(detail).filter((s) => vertical(s) || horizontal(s))).toHaveLength(4);
  });

  it("symbols stay inside the footprint", () => {
    const sizes = [0.1, 0.45, 1, 3, 10];
    for (const kind of ["wardrobe", "drawers", "tvUnit", "shelf", "bathtub", "showerTray"]) {
      for (const w of sizes) {
        for (const d of sizes) {
          const where = `${kind} ${w}×${d}`;
          for (const p of furnitureSymbol(kind, "standard", w, d)) {
            expect(p.kind === "segment" || p.kind === "arc", where).toBe(true);
            if (p.kind === "arc") expect(p.radius, where).toBeGreaterThanOrEqual(0);
            for (const q of reach(p)) {
              expect(Number.isFinite(q.x) && Number.isFinite(q.y), where).toBe(true);
              expect(q.x >= -w / 2 - 1e-9 && q.x <= w / 2 + 1e-9 && q.y >= -d - 1e-9 && q.y <= 1e-9, `${where} at (${q.x}, ${q.y})`).toBe(true);
            }
          }
        }
      }
    }
  });
});
