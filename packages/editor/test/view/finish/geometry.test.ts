import { describe, expect, it } from "vitest";
import { convexOverlap, MOTIF_IDS, MOTIFS, motifDefaults, pointInPolygon, rotateAbout, type Finish, type MotifId } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { createFinishCache, finishGeometry, mixColour, patternShows, type FinishGeometry, type FinishLine, type FinishShape } from "../../../src/view/finish/geometry";
import { MOTIF_DRAWINGS } from "../../../src/view/finish/motifs";
import { lerp, onFloor, rect, ringDistance, rng, STUDIO_FLOORS } from "./helpers";
import { PERF } from "../../perf-switch";

// finishGeometry's properties (AC-02, AC-04 lines, AC-05, AC-06 cap) and the per-room cache (finishes.18).

// The core tsconfig has no DOM or Node lib; vitest runs in Node, where `performance` is a global.
declare const performance: { now(): number };

type Room = { name: string; outer: Point[]; holes: Point[][] };
type Case = { room: Room; finish: Finish };

const LINE_MOTIFS = MOTIF_IDS.filter((m) => m !== "plain");
const HEX = /^#[0-9a-f]{6}$/;

/** A random rectangle or L shape, 1.6–3.6 m, with maybe a stair core and maybe a 0.30 column in its lower band. */
function randomRoom(seed: number): Room {
  const r = rng(seed);
  const between = (lo: number, hi: number): number => lo + r() * (hi - lo);
  const [x0, y0, w, h] = [between(-4, 4), between(-4, 4), between(1.6, 3.6), between(1.6, 3.6)];
  const ell = r() < 0.5;
  const band = ell ? h * between(0.5, 0.7) : h; // the full-width lower band the holes sit in
  const notch = x0 + w * between(0.4, 0.6);
  const outer = ell
    ? [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + band }, { x: notch, y: y0 + band }, { x: notch, y: y0 + h }, { x: x0, y: y0 + h }]
    : rect(x0, y0, x0 + w, y0 + h);
  const holes: Point[][] = [];
  if (r() < 0.6) holes.push(rect(x0 + 0.15, y0 + 0.15, x0 + between(0.45, w / 2 - 0.1), y0 + between(0.45, band - 0.15)));
  if (r() < 0.6) {
    const cx = between(x0 + w / 2 + 0.05, x0 + w - 0.4);
    const cy = between(y0 + 0.1, y0 + band - 0.4);
    holes.push(rect(cx, cy, cx + 0.3, cy + 0.3));
  }
  return { name: `random ${seed} (${ell ? "L" : "rect"})`, outer, holes };
}

const step = (k: number): number => k * 0.05; // walls on the 0.05 grid, with the float noise multiplying gives

/** Rooms whose walls sit on the 0.05 m grid, one with a corner at the origin. */
const GRID_ROOMS: Room[] = [
  { name: "grid rect", outer: rect(step(2), step(3), step(47), step(39)), holes: [] },
  { name: "grid at origin", outer: rect(0, 0, 1, 1), holes: [] },
  {
    name: "grid L with a column",
    outer: [{ x: step(-7), y: step(1) }, { x: step(33), y: step(1) }, { x: step(33), y: step(25) }, { x: step(13), y: step(25) }, { x: step(13), y: step(41) }, { x: step(-7), y: step(41) }],
    holes: [rect(step(17), step(7), step(23), step(13))],
  },
];

const STUDIO: Room[] = STUDIO_FLOORS.map((ring, i) => ({ name: `studio ${i}`, outer: [...ring], holes: [] }));

function sizesOf(motif: MotifId): number[] {
  const { min, max, default: d } = MOTIFS[motif].size;
  return [min, d, max];
}

/** What's wrong with one case's lines, or null. */
function problem({ room, finish }: Case): string | null {
  const g = finishGeometry(room.outer, room.holes, finish);
  for (const l of g.lines) {
    if (![l.a.x, l.a.y, l.b.x, l.b.y].every(Number.isFinite)) return `NaN in ${JSON.stringify(l)}`;
    if (Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) < 1e-6) return `under 1 µm: ${JSON.stringify(l)}`;
    if (!HEX.test(l.color)) return `colour ${l.color}`;
    // Both ends and points between: on the floor and off every hole, within 1 µm.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      if (!onFloor(lerp(l.a, l.b, t), room.outer, room.holes, 1e-6)) return `off the floor at t=${t}: ${JSON.stringify(l)}`;
    }
  }
  return null;
}

function sweep(cases: readonly Case[]): string[] {
  const failures: string[] = [];
  for (const c of cases) {
    const p = problem(c);
    if (p) failures.push(`${c.room.name} ${JSON.stringify(c.finish)}: ${p} | ${JSON.stringify(c.room)}`);
  }
  return failures;
}

const finishOf = (motif: MotifId, size: number, angle: number): Finish => ({ ...motifDefaults(motif), size, angle });

describe("finishGeometry", () => {
  it("AC-04 sweep: random rooms with holes, grid-aligned rooms and the studio keep every line on the floor", () => {
    const cases: Case[] = [];
    const rooms = [...Array.from({ length: 12 }, (_, i) => randomRoom(100 + i)), ...STUDIO];
    for (const room of rooms) {
      for (const motif of LINE_MOTIFS) for (const size of sizesOf(motif)) for (const angle of [0, 30, 45, 90]) cases.push({ room, finish: finishOf(motif, size, angle) });
    }
    for (const room of GRID_ROOMS) {
      for (const angle of [0, 90, 45]) {
        cases.push({ room, finish: finishOf("mosaic", 0.025, angle) });
        for (const size of [0.2, 0.3]) for (const motif of ["squareTiles", "planks", "widePlanks"] as const) cases.push({ room, finish: finishOf(motif, size, angle) });
      }
    }
    const failures = sweep(cases);
    expect(failures.slice(0, 3)).toEqual([]); // the counterexamples, seeds and rings included
  });

  it("draws lines on the grid rooms and the studio (the sweep isn't vacuous)", () => {
    for (const room of [...GRID_ROOMS, ...STUDIO]) {
      expect(finishGeometry(room.outer, room.holes, finishOf("squareTiles", 0.2, 0)).lines.length, room.name).toBeGreaterThan(0);
    }
    // A 45° joint through the origin corner and its opposite corner: the room's diagonal, kept as one piece.
    const diagonal = finishGeometry(rect(0, 0, 1, 1), [], finishOf("squareTiles", 0.2, 45)).lines.filter(
      (l) => Math.abs(l.a.x - l.a.y) < 1e-9 && Math.abs(l.b.x - l.b.y) < 1e-9,
    );
    expect(diagonal).toHaveLength(1);
  });

  it("AC-02 lines stay put: moving an edge outward keeps every earlier piece on its line key", () => {
    const column = rect(1.1, 0.7, 1.4, 1.0);
    for (const motif of LINE_MOTIFS) {
      for (const angle of [0, 30, 45]) {
        const finish = { ...motifDefaults(motif), angle };
        const before = finishGeometry(rect(0.1, 0.1, 2.3, 1.9), [column], finish);
        const after = finishGeometry(rect(0.1, 0.1, 2.95, 1.9), [column], finish);
        expect(before.lines.length).toBeGreaterThan(0);
        for (const l of before.lines) {
          const kept = after.lines.some((n) => n.key === l.key && n.color === l.color && within(l.a, n) && within(l.b, n));
          expect(kept, `${motif} at ${angle}°: ${JSON.stringify(l)}`).toBe(true);
        }
      }
    }
  });

  it("AC-02 two adjacent rooms with the same finish draw lines on the same line keys", () => {
    const [main, bath] = STUDIO;
    for (const motif of LINE_MOTIFS) {
      for (const angle of [0, 30]) {
        const finish = { ...motifDefaults(motif), angle };
        const whole = finishGeometry(main?.outer ?? [], [], finish);
        if (motif === "mosaic") {
          expect(whole.tooFine).toBe(true); // 5.3 × 2.3 m at 0.025: over 20,000 cells, so a smaller main room
        }
        const a = motif === "mosaic" ? finishGeometry(rect(1.6, 0.1, 3.1, 2.4), [], finish).lines : whole.lines;
        const b = finishGeometry(bath?.outer ?? [], [], finish).lines;
        const shared = a.filter((l) => b.some((n) => n.key === l.key));
        expect(shared.length, `${motif} at ${angle}°`).toBeGreaterThan(0);
        for (const l of shared) for (const n of b.filter((m) => m.key === l.key)) expect(collinear(l, n), `${motif} ${l.key}`).toBe(true);
      }
    }
  });

  it("AC-05 colours: strength 0 gives the base colour, 100 the shade; all solid #rrggbb", () => {
    const ring = rect(0.1, 0.1, 2.3, 1.9);
    for (const motif of LINE_MOTIFS) {
      const base = MOTIFS[motif].colour;
      const none = finishGeometry(ring, [], { ...motifDefaults(motif), strength: 0 });
      const full = finishGeometry(ring, [], { ...motifDefaults(motif), strength: 100 });
      expect(none.fill.color).toBe(base);
      expect(none.lines.every((l) => l.color === base), motif).toBe(true);
      expect(full.lines.every((l) => l.color === shadeOf(base, 0.6)), motif).toBe(true);
      for (const l of [...none.lines, ...full.lines]) expect(l.color).toMatch(HEX);
    }
    expect(mixColour("#c8a27a", 0.6, 100)).toBe("#786149");
    expect(mixColour("#c8a27a", 0.6, 50)).toBe("#a08262");
    expect(mixColour("#c8a27a", 0.6, 0)).toBe("#c8a27a");
    expect(mixColour("#ffffff", 0.6, 45)).toMatch(HEX);
  });

  it("returns the floor and its holes as the fill, and plain draws no lines", () => {
    const ring = rect(0, 0, 3, 2);
    const holes = [rect(1, 1, 1.3, 1.3)];
    const g = finishGeometry(ring, holes, motifDefaults("plain"));
    expect(g.fill).toEqual({ points: ring, holes, color: MOTIFS.plain.colour });
    expect(g.lines).toEqual([]);
    expect(g.shapes).toEqual([]);
    expect(g.tooFine).toBe(false);
  });

  it("tooFine above 20,000 cells: a 10 × 10 m room in 0.02 mosaic returns no lines", () => {
    const huge = finishGeometry(rect(0, 0, 10, 10), [], finishOf("mosaic", 0.02, 0)); // 250,000 cells
    const studio = finishGeometry(rect(0, 0, 5, 4), [], finishOf("mosaic", 0.025, 0)); // 32,000 cells
    expect(huge.lines).toEqual([]);
    expect(huge.tooFine).toBe(true);
    expect(studio.tooFine).toBe(true);
    expect(huge.spacing).toBeCloseTo(0.02, 12);
    // Under the cap: 3 m² of mosaic, about 4,800 cells.
    expect(finishGeometry(rect(0, 0, 2, 1.5), [], finishOf("mosaic", 0.025, 0)).tooFine).toBe(false);
  });

  it("builds 3 m² of mosaic at every angle", () => {
    for (const angle of [0, 30, 45]) expect(finishGeometry(rect(0.1, 0.1, 2.1, 1.6), [], finishOf("mosaic", 0.025, angle)).lines.length).toBeGreaterThan(100);
  });
});

describe.skipIf(!PERF)("finishGeometry's speed, with FM_PERF=1", () => {
  it("returns tooFine above 20,000 cells quickly", () => {
    const start = performance.now();
    finishGeometry(rect(0, 0, 10, 10), [], finishOf("mosaic", 0.02, 0)); // 250,000 cells
    finishGeometry(rect(0, 0, 5, 4), [], finishOf("mosaic", 0.025, 0)); // 32,000 cells
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("builds 3 m² of mosaic well under 50 ms", () => {
    const ring = rect(0.1, 0.1, 2.1, 1.6);
    finishGeometry(ring, [], finishOf("mosaic", 0.025, 30)); // warm up
    const runs = [0, 30, 45].map((angle) => {
      const start = performance.now();
      finishGeometry(ring, [], finishOf("mosaic", 0.025, angle));
      return performance.now() - start;
    });
    expect(Math.max(...runs)).toBeLessThan(50);
  });
});

describe("finishGeometry's shapes (step 10)", () => {
  /**
   * Cement tiles written out independently: which diamond p lies in ("mid", "corner" or ""), how near its edge, and the
   * diamond in drawing coordinates.
   */
  function cementOracle(p: Point, finish: Finish): { in: string; edge: number; diamond: Point[] } {
    const u = rotateAbout(p, { x: 0, y: 0 }, -finish.angle);
    const [x, y] = [u.x / finish.size, u.y / finish.size];
    const mid = Math.abs(x - Math.floor(x) - 0.5) + Math.abs(y - Math.floor(y) - 0.5);
    const corner = Math.abs(x - Math.round(x)) + Math.abs(y - Math.round(y));
    const edge = Math.min(Math.abs(mid - 0.35), Math.abs(corner - 0.25)) * finish.size;
    const [cx, cy, r] = mid < 0.35 ? [Math.floor(x) + 0.5, Math.floor(y) + 0.5, 0.35] : [Math.round(x), Math.round(y), 0.25];
    const diamond = [[0, -r], [r, 0], [0, r], [-r, 0]].map(([dx = 0, dy = 0]) =>
      rotateAbout({ x: (cx + dx) * finish.size, y: (cy + dy) * finish.size }, { x: 0, y: 0 }, finish.angle));
    return { in: mid < 0.35 ? "mid" : corner < 0.25 ? "corner" : "", edge, diamond };
  }

  const covers = (s: FinishShape, p: Point): boolean => [s.points, ...s.holes].filter((r) => pointInPolygon(p, r)).length % 2 === 1;

  /** What's wrong with one case's shapes, or null. */
  function shapeProblem({ room, finish }: Case, samples: number, seed: number): string | null {
    const g = finishGeometry(room.outer, room.holes, finish);
    const mid = mixColour(finish.colour, MOTIF_DRAWINGS.cementTiles.shapes[0]?.shade ?? NaN, finish.strength);
    for (const s of g.shapes) {
      if (![...s.points, ...s.holes.flat()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return `NaN in ${JSON.stringify(s)}`;
      if (!HEX.test(s.color)) return `colour ${s.color}`;
      // Every vertex on the floor (on an edge within 1 µm); no shape keeps a hole (shapes meeting one are dropped).
      for (const p of s.points) if (!onFloor(p, room.outer, room.holes, 1e-6)) return `vertex off the floor: ${JSON.stringify(p)}`;
      if (s.holes.length > 0) return `a shape with holes: ${JSON.stringify(s)}`;
    }
    const boxes = g.shapes.map((s) => {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const;
    });
    // Point by point against the oracle: covered (by exactly one shape, in its shade) when on the floor and in a diamond
    // that meets no hole (the test rooms' holes are rectangles, so the overlap test is exact).
    const r = rng(seed);
    const inHoles = room.holes.length > 0 ? Math.floor(samples / 4) : 0;
    for (let i = 0; i < samples; i++) {
      const hole = room.holes[i % Math.max(1, room.holes.length)];
      const ring = i < inHoles && hole ? hole : room.outer; // a quarter of the samples inside the holes
      const [x0, x1, y0, y1] = [Math.min(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.y)), Math.max(...ring.map((p) => p.y))];
      const p = { x: x0 + r() * (x1 - x0), y: y0 + r() * (y1 - y0) };
      const want = cementOracle(p, finish);
      if (want.edge < 1e-6 || [room.outer, ...room.holes].some((h) => ringDistance(p, h) < 1e-6)) continue;
      const onTheFloor = pointInPolygon(p, room.outer) && !room.holes.some((h) => pointInPolygon(p, h));
      const by = g.shapes.filter((s, k) => {
        const b = boxes[k];
        return b !== undefined && p.x >= b[0] && p.x <= b[1] && p.y >= b[2] && p.y <= b[3] && covers(s, p);
      });
      const kept = want.in !== "" && !room.holes.some((h) => convexOverlap(want.diamond, h, 1e-9));
      const expected = onTheFloor && kept ? 1 : 0;
      if (by.length !== expected) return `${JSON.stringify(p)} covered by ${by.length} shapes, want ${expected} (${want.in}, on the floor ${onTheFloor})`;
      if (want.in === "mid" && by[0] && by[0].color !== mid) return `${JSON.stringify(p)} in a centre diamond coloured ${by[0].color}`;
    }
    return null;
  }

  it("AC-04 shapes: cement tiles over random rooms, grid rooms and the studio cover exactly the floor's part of each diamond", () => {
    const failures: string[] = [];
    const rooms = [...Array.from({ length: 12 }, (_, i) => randomRoom(100 + i)), ...GRID_ROOMS, ...STUDIO];
    let shapes = 0;
    rooms.forEach((room, n) => {
      for (const size of sizesOf("cementTiles")) {
        for (const angle of [0, 30, 45, 90]) {
          const c = { room, finish: finishOf("cementTiles", size, angle) };
          shapes += finishGeometry(room.outer, room.holes, c.finish).shapes.length;
          const p = shapeProblem(c, 400, n * 1000 + angle + size * 100);
          if (p) failures.push(`${room.name} ${JSON.stringify(c.finish)}: ${p} | ${JSON.stringify(room)}`);
        }
      }
    });
    expect(failures.slice(0, 3)).toEqual([]);
    expect(shapes).toBeGreaterThan(1000); // not vacuous
  });

  it("shapes meeting a column are dropped, and the shapes' area is the oracle's", () => {
    const room: Room = { name: "column", outer: rect(0.1, 0.1, 3.1, 2.1), holes: [rect(1.02, 0.95, 1.33, 1.26)] };
    for (const angle of [0, 30, 45]) {
      const finish = finishOf("cementTiles", 0.4, angle);
      const g = finishGeometry(room.outer, room.holes, finish);
      expect(shapeProblem({ room, finish }, 4000, angle)).toBeNull();
      // The area by shoelace (rings less holes) against a dense sample of the oracle over the floor.
      const area = g.shapes.reduce((sum, s) => sum + Math.abs(signed(s.points)) - s.holes.reduce((h, ring) => h + Math.abs(signed(ring)), 0), 0);
      const r = rng(9 + angle);
      let hits = 0;
      const n = 200_000;
      for (let i = 0; i < n; i++) {
        const p = { x: 0.1 + r() * 3, y: 0.1 + r() * 2 };
        const want = cementOracle(p, finish);
        if (want.in !== "" && !room.holes.some((h) => convexOverlap(want.diamond, h, 1e-9))) hits++;
      }
      expect(Math.abs(area - (hits / n) * 6) / area, `${angle}°`).toBeLessThan(0.01);
    }
  });

  it("cement tiles at strength 0 draw shapes in the base colour; at 100 in their shade", () => {
    const ring = rect(0.1, 0.1, 2.3, 1.9);
    const base = MOTIFS.cementTiles.colour;
    const none = finishGeometry(ring, [], { ...motifDefaults("cementTiles"), strength: 0 });
    const full = finishGeometry(ring, [], { ...motifDefaults("cementTiles"), strength: 100 });
    expect(none.shapes.length).toBeGreaterThan(0);
    expect(none.shapes.every((s) => s.color === base)).toBe(true);
    const shades = MOTIF_DRAWINGS.cementTiles.shapes.map((s) => shadeOf(base, s.shade)).sort();
    expect([...new Set(full.shapes.map((s) => s.color))].sort()).toEqual(shades);
    expect(new Set(shades).size).toBe(2); // the two diamonds differ
  });
});

/** Shoelace, positive counter-clockwise. */
function signed(ring: readonly Point[]): number {
  return ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    return sum + (p.x * q.y - q.x * p.y) / 2;
  }, 0);
}

describe("patternShows (finishes.06, .16)", () => {
  const g = (spacing: number, tooFine = false): FinishGeometry => ({ fill: { points: [], holes: [], color: "#000000" }, lines: [], shapes: [], spacing, tooFine });

  it("shows from the least spacing, within 1e-9; never when too fine", () => {
    expect(patternShows(g(0.1), 0.1)).toBe(true);
    expect(patternShows(g(0.1 - 5e-10), 0.1)).toBe(true); // float noise at the threshold
    expect(patternShows(g(0.1 - 2e-9), 0.1)).toBe(false);
    expect(patternShows(g(0.2), 0.1)).toBe(true);
    expect(patternShows(g(0.2, true), 0.1)).toBe(false);
  });

  it("a canvas threshold in pixels becomes metres over the zoom: 4 px at 20 px/m is 0.20 m", () => {
    const planks = finishGeometry(rect(0, 0, 2, 2), [], motifDefaults("planks"));
    expect(planks.spacing).toBeCloseTo(0.2, 12);
    expect(patternShows(planks, 4 / 20)).toBe(true);
    expect(patternShows(planks, 4 / 19.9)).toBe(false);
  });
});

describe("the finish cache", () => {
  const finish = motifDefaults("planks");
  const A = rect(0.1, 0.1, 1.4, 2.4);
  const B = rect(1.6, 0.1, 6.9, 2.4);
  const copy = (ring: Point[]): Point[] => ring.map((p) => ({ ...p }));

  it("reuses a room's geometry for equal rings in a new array (same returned object)", () => {
    const cache = createFinishCache();
    const [a1, b1] = cache.build([{ ring: A, holes: [], finish }, { ring: B, holes: [], finish }]);
    const [a2, b2] = cache.build([{ ring: copy(A), holes: [], finish: { ...finish } }, { ring: copy(B), holes: [], finish: { ...finish } }]);
    expect(a2).toBe(a1);
    expect(b2).toBe(b1);
    expect(a1?.lines.length).toBeGreaterThan(0);
    const [a3] = cache.build([{ ring: A, holes: [], finish: { ...finish, angle: 1 } }]);
    expect(a3).not.toBe(a1); // a changed finish builds again
    const [a4] = cache.build([{ ring: A, holes: [rect(0.5, 0.5, 0.8, 0.8)], finish }]);
    expect(a4).not.toBe(a1); // so does a hole
  });

  it("drops rooms not in the last build", () => {
    const cache = createFinishCache();
    const [a1, b1] = cache.build([{ ring: A, holes: [], finish }, { ring: B, holes: [], finish }]);
    const [a2] = cache.build([{ ring: A, holes: [], finish }]);
    expect(a2).toBe(a1);
    const [a3, b3] = cache.build([{ ring: A, holes: [], finish }, { ring: B, holes: [], finish }]);
    expect(a3).toBe(a1);
    expect(b3).not.toBe(b1);
    expect(b3).toEqual(b1);
  });
});

/** p lies on segment n, within 1e-9. */
function within(p: Point, n: FinishLine): boolean {
  const dx = n.b.x - n.a.x;
  const dy = n.b.y - n.a.y;
  const len2 = dx * dx + dy * dy;
  const t = ((p.x - n.a.x) * dx + (p.y - n.a.y) * dy) / len2;
  const q = { x: n.a.x + t * dx, y: n.a.y + t * dy };
  return t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
}

function collinear(l: FinishLine, n: FinishLine): boolean {
  const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
  const off = (p: Point): number => Math.abs((l.b.x - l.a.x) * (p.y - l.a.y) - (l.b.y - l.a.y) * (p.x - l.a.x)) / len;
  return off(n.a) < 1e-9 && off(n.b) < 1e-9;
}

/** The base colour with each channel times the factor, as #rrggbb: the shade at strength 100, worked out independently. */
function shadeOf(base: string, factor: number): string {
  const channel = (i: number): string => Math.round(parseInt(base.slice(i, i + 2), 16) * factor).toString(16).padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
