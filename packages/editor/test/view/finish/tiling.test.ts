import { describe, expect, it } from "vitest";
import { motifDefaults, rotateAbout, type MotifId } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { finishGeometry, type FinishLine } from "../../../src/view/finish/geometry";
import type { MotifDrawing, MotifShape } from "../../../src/view/finish/motifs";
import { MAX_CELLS, tilePattern } from "../../../src/view/finish/tiling";
import { crosses, lerp, rect, ringDistance, rng } from "./helpers";

// Tiling from (0,0) in the pattern's own frame, merged by line key, then rotated (finishes.02, .18; AC-06).

const ORIGIN = { x: 0, y: 0 };
const isAlongX = (l: FinishLine): boolean => Math.abs(l.a.y - l.b.y) < 1e-12;
const isAlongY = (l: FinishLine): boolean => Math.abs(l.a.x - l.b.x) < 1e-12;

function byKey(lines: readonly FinishLine[]): Map<string, FinishLine[]> {
  const out = new Map<string, FinishLine[]>();
  for (const l of lines) out.set(l.key, [...(out.get(l.key) ?? []), l]);
  return out;
}

describe("tiling the pattern", () => {
  it("square tiles 0.30 over (0,0)–(2.0,2.0) at 0° give 6 joint lines each way after clipping", () => {
    const g = finishGeometry(rect(0, 0, 2, 2), [], { ...motifDefaults("squareTiles"), size: 0.3 });
    const alongX = g.lines.filter(isAlongX);
    const alongY = g.lines.filter(isAlongY);
    expect(alongX).toHaveLength(6);
    expect(alongY).toHaveLength(6);
    expect(alongX.map((l) => l.a.y).sort((p, q) => p - q)).toEqual([1, 2, 3, 4, 5, 6].map((k) => k * 0.3));
    for (const l of g.lines) expect(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y)).toBeCloseTo(2, 12); // the lines along the edges at 0 are dropped
    expect(g.spacing).toBeCloseTo(0.3, 12);
    expect(g.tooFine).toBe(false);
  });

  it("at 30° every joint is one merged segment per crossing of the floor", () => {
    const ring = rect(0, 0, 2, 2);
    const g = finishGeometry(ring, [], { ...motifDefaults("squareTiles"), size: 0.3, angle: 30 });
    expect(g.lines.length).toBeGreaterThan(12);
    for (const [key, pieces] of byKey(g.lines)) {
      expect(pieces, key).toHaveLength(1);
      for (const p of pieces) for (const end of [p.a, p.b]) expect(ringDistance(end, ring), key).toBeLessThan(1e-9);
    }
  });

  it("planks rows shifted by a third: the end joints of row k sit at x = (k/3 · 6w) mod 6w", () => {
    const w = 0.2;
    const g = finishGeometry(rect(0.1, 0.1, 4.1, 3.1), [], { ...motifDefaults("planks"), size: w });
    const ends = g.lines.filter(isAlongY);
    expect(ends.length).toBeGreaterThan(20);
    for (const l of ends) {
      const k = Math.floor((l.a.y + l.b.y) / 2 / w);
      const turns = (l.a.x / w - 2 * k) / 6;
      expect(Math.abs(turns - Math.round(turns)), JSON.stringify(l)).toBeLessThan(1e-9);
    }
    // Rows are whole: the joints along x run the room's full width.
    for (const l of g.lines.filter(isAlongX)) expect(Math.abs(l.b.x - l.a.x)).toBeCloseTo(4, 12);
  });

  it("every motif's joints are exactly the boundaries of its tiling (sampled, at 0° and 30°)", () => {
    for (const motif of Object.keys(TILINGS).filter((m): m is LineMotif => m in TILINGS)) {
      for (const angle of [0, 30]) {
        const finish = { ...motifDefaults(motif), angle };
        const w = finish.size;
        const ring = rect(0.13, 0.27, 2.53, 2.07);
        const g = finishGeometry(ring, [], finish);
        const plank = (p: Point): string => TILINGS[motif](scaled(rotateAbout(p, ORIGIN, -angle), 1 / w));
        const what = `${motif} at ${angle}°`;
        expect(g.lines.length, what).toBeGreaterThan(0);
        // Every piece is a boundary: just either side of it lie two different planks.
        for (const l of g.lines) {
          const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
          const n = { x: ((l.a.y - l.b.y) / len) * 1e-6, y: ((l.b.x - l.a.x) / len) * 1e-6 };
          for (const t of [0.25, 0.5, 0.75]) {
            const m = lerp(l.a, l.b, t);
            expect(plank({ x: m.x + n.x, y: m.y + n.y }), `${what} ${JSON.stringify(l)}`).not.toBe(plank({ x: m.x - n.x, y: m.y - n.y }));
          }
        }
        // And every boundary is drawn: two nearby points lie in different planks exactly when a piece runs between them.
        const r = rng(7 + angle);
        for (let i = 0; i < 1500; i++) {
          const p = { x: 0.13 + w + r() * (2.4 - 2 * w), y: 0.27 + w + r() * (1.8 - 2 * w) };
          const q = { x: p.x + (r() - 0.5) * 1.4 * w, y: p.y + (r() - 0.5) * 1.4 * w };
          const crossed = g.lines.some((l) => crosses(p, q, l.a, l.b));
          expect(crossed, `${what} ${JSON.stringify([p, q])}`).toBe(plank(p) !== plank(q));
        }
      }
    }
  });

  it("the herringbone oracle is a tiling: every point lies in exactly one plank, half of them across", () => {
    const r = rng(11);
    let across = 0;
    for (let i = 0; i < 4000; i++) {
      const p = { x: (r() - 0.5) * 60, y: (r() - 0.5) * 60 };
      const hits = herringbonePlanks(p);
      expect(hits, JSON.stringify(p)).toHaveLength(1);
      if (hits[0]?.startsWith("H")) across++;
    }
    expect(across / 4000).toBeGreaterThan(0.45);
    expect(across / 4000).toBeLessThan(0.55);
  });
});

describe("tiling shapes (step 10)", () => {
  const P = (x: number, y: number): Point => ({ x, y });
  /** A diamond across the cell's origin, sticking out of the cell on every side. */
  const CORNER: MotifShape = { points: [P(0, -0.25), P(0.25, 0), P(0, 0.25), P(-0.25, 0)], shade: 0.8 };
  const grid = (lines: MotifDrawing["lines"]): MotifDrawing => ({ repeat: [P(1, 0), P(0, 1)], spacing: 1, lines, shapes: [CORNER] });
  const centres = (shapes: readonly { points: readonly Point[] }[]): string[] =>
    shapes.map((s) => {
      const c = s.points.reduce((sum, p) => ({ x: sum.x + p.x / s.points.length, y: sum.y + p.y / s.points.length }), P(0, 0));
      return `${Math.round(c.x * 1e6) / 1e6},${Math.round(c.y * 1e6) / 1e6}`;
    }).sort();
  const corners = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let x = from; x <= to; x++) for (let y = from; y <= to; y++) out.push(`${x},${y}`);
    return out.sort();
  };

  it("a drawing with shapes and no lines still tiles: a diamond at every grid corner whose box meets the floor's", () => {
    const t = tilePattern(grid([]), rect(0.1, 0.1, 2.9, 2.9), 1, 0);
    expect(t.tooFine).toBe(false);
    expect(t.lines).toEqual([]);
    expect(centres(t.shapes)).toEqual(corners(0, 3));
    expect(t.shapes.every((s) => s.shade === 0.8)).toBe(true);
  });

  it("the cell reach includes shape points: diamonds across the far corners come from cells off the box", () => {
    const t = tilePattern(grid([{ family: "x", a: P(0, 0), b: P(1, 0), shade: 0.6 }]), rect(0.1, 0.1, 2.9, 2.9), 1, 0);
    expect(centres(t.shapes)).toEqual(corners(0, 3)); // (3, y) and (x, 3) belong to cells whose lines miss the box
  });

  it("shapes are scaled by the size and turned about (0,0) like the lines", () => {
    const t = tilePattern(grid([]), rect(0.1, 0.1, 0.5, 0.5), 0.2, 30);
    expect(t.shapes.length).toBeGreaterThan(0);
    for (const s of t.shapes) {
      const local = s.points.map((p) => scaled(rotateAbout(p, ORIGIN, -30), 1 / 0.2));
      const c = { x: Math.round(local[0]?.x ?? NaN), y: Math.round((local[0]?.y ?? NaN) + 0.25) };
      local.forEach((p, i) => {
        const want = CORNER.points[i] ?? P(NaN, NaN);
        expect(p.x - c.x).toBeCloseTo(want.x, 9);
        expect(p.y - c.y).toBeCloseTo(want.y, 9);
      });
    }
  });

  it("shapes count toward the one cell cap: over it, no shapes and no lines", () => {
    const side = Math.sqrt(MAX_CELLS) + 2;
    const t = tilePattern(grid([]), rect(0, 0, side, side), 1, 0);
    expect(t.tooFine).toBe(true);
    expect(t.shapes).toEqual([]);
    expect(tilePattern(grid([]), rect(0, 0, 10, 10), 1, 0).shapes).toHaveLength(121);
  });
});

const scaled = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });

/** Running bond: rows one unit wide along x, planks `length` long, row k shifted by k · shift. */
const bond = (length: number, shift: number) => (p: Point): string => {
  const row = Math.floor(p.y);
  return `${row},${Math.floor((p.x - row * shift) / length)}`;
};

/**
 * The classic herringbone of 1 × 5 planks, written out independently of the drawing: cell (i, m) at i·(1,1) + m·(5,−5)
 * holds an across plank [0,5]×[0,1] and an upright one [5,6]×[−4,1]. Every plank containing p (a tiling has one).
 */
function herringbonePlanks(p: Point): string[] {
  const out: string[] = [];
  const n = Math.floor(p.y); // an across plank's row: i − 5m
  const mH = Math.floor((p.x - n) / 10);
  if (p.x - n - 10 * mH < 5) out.push(`H${n + 5 * mH},${mH}`);
  const c = Math.floor(p.x); // an upright plank's column: i + 5m + 5
  const r = p.y - c + 9;
  const mV = -Math.floor(r / 10);
  if (r + 10 * mV < 5) out.push(`V${c - 5 - 5 * mV},${mV}`);
  return out;
}

type LineMotif = Exclude<MotifId, "plain">;
/** Which plank or tile a point (in units of the size, pattern frame) lies in, per motif. */
const TILINGS: Record<LineMotif, (p: Point) => string> = {
  planks: bond(6, 2),
  widePlanks: bond(8, 4),
  herringbone: (p) => herringbonePlanks(p).join("|"),
  squareTiles: bond(1, 0),
  largeTiles: bond(2, 1),
  mosaic: bond(1, 0),
  cementTiles: bond(1, 0),
  brick: bond(4, 2),
  subwayTiles: bond(2, 1),
  shingles: bond(2, 1),
  roofTiles: bond(1, 0),
  // Stripes with no joints across them (surfaces.06): a seam's or a rib's row; a batten 1 unit wide every 8.
  standingSeam: (p) => String(Math.floor(p.y)),
  corrugated: (p) => String(Math.floor(p.y)),
  boardAndBatten: (p) => {
    const k = Math.floor(p.y / 8);
    return `${k}${p.y - 8 * k < 1 ? "batten" : "board"}`;
  },
};
