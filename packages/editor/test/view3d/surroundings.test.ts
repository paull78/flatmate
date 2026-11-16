import { describe, expect, it } from "vitest";
import { SURROUNDINGS_VALUES, type Document } from "@fm/domain";
import { COLOR_PATTERN, colorChannels } from "../../src/view/colors";
import { view3dFrame } from "../../src/view3d-state";
import { camera3d, DEFAULT_ANGLES, shellBounds, TILT_MAX, TILT_MIN, type Bounds3 } from "../../src/view3d/camera3d";
import { groundFaces, mixColor } from "../../src/view3d/ground-faces";
import { lookScene3d } from "../../src/view3d/look3d";
import { sceneFaces } from "../../src/view3d/scene-faces";
import { STYLE_3D } from "../../src/view3d/style";
import { framedBounds, SURROUNDINGS, surroundingsRow } from "../../src/view3d/surroundings";
import { trailerFaces } from "../../src/view3d/trailer-faces";
import type { Angles3d, Face3d, Line3d, Point3 } from "../../src/view3d/types";
import { clearRoomDoc, loftRoomDoc, nichesDoc, studioDoc, wallBetween, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";
import { insideRing } from "../object-look-helpers";
import { normal, visible } from "./visible";

// The ground round the house (surroundings.03, .13, .14): a plate fading through opaque rings into the surroundings'
// background, inside the pulled-back frame at every view.

const YAWS = Array.from({ length: 24 }, (_, i) => 15 * i);
const TILTS = Array.from({ length: (TILT_MAX - TILT_MIN) / 5 + 1 }, (_, i) => TILT_MIN + 5 * i);
const studio: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05 };
/** The houses every plate is tried on: the studio, a long, a square and a tall small one (a 1 × 1 m room under a 3 m ceiling). */
const houses: Bounds3[] = [
  studio,
  { min: { x: 0, y: 0 }, max: { x: 12, y: 3 }, top: 2.5 },
  { min: { x: -0.1, y: -0.1 }, max: { x: 5.1, y: 5.1 }, top: 2.6 },
  { min: { x: -0.1, y: -0.1 }, max: { x: 1.1, y: 1.1 }, top: 3 },
];
/** Every surroundings' row, by name. */
const DRAWN = Object.entries(SURROUNDINGS);
/** Every point the ground draws: its faces' corners and its lines' ends. */
const vertices = (faces: ReturnType<typeof groundFaces>): Point3[] =>
  faces.flatMap((f) => [...f.points, ...f.holes.flat(), ...(f.lines ?? []).flatMap((l) => [l.a, l.b])]);
const lines = (faces: ReturnType<typeof groundFaces>): Line3d[] => faces.flatMap((f) => f.lines ?? []);
/** How far a plan point lies outside the shell's box: 0 inside it. */
const outBy = (shell: Bounds3, p: { x: number; y: number }): number =>
  Math.hypot(Math.max(0, shell.min.x - p.x, p.x - shell.max.x), Math.max(0, shell.min.y - p.y, p.y - shell.max.y));
/** Whether a plan point lies on a face's polygon, its edges counted in: the box is sampled on its own edges. */
const covers = (points: readonly Point3[], p: { x: number; y: number }): boolean => insideRing(p, points, 1e-9);

describe("the ground's fade (surroundings.03)", () => {
  it("rings run from the ground's colour to the background, the last exactly the background, none outlined", () => {
    const row = SURROUNDINGS.outside;
    expect([row.ground, row.background]).toEqual(["#b9c9a3", "#eef3f5"]);
    const faces = groundFaces(row, studio);
    expect(faces.every((f) => f.outline === false && f.owner.startsWith("ground/") && COLOR_PATTERN.test(f.color))).toBe(true);
    // Read by radius, out from the shell's plan centre: the solid plate, then the rings outward.
    const c = { x: 3.5, y: 1.25 };
    const reach = (f: (typeof faces)[number]): number => Math.max(...f.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    const byRadius = [...faces].sort((a, b) => reach(a) - reach(b));
    const R = Math.max(...faces.map(reach));
    expect(R).toBeGreaterThan(4.5);
    expect(byRadius.filter((f) => reach(f) <= 0.72 * R + 1e-9).every((f) => f.color === row.ground)).toBe(true);
    expect(byRadius.filter((f) => reach(f) > R - 1e-9).every((f) => f.color === row.background)).toBe(true);
    // Each face is no farther from the background than any inside it, and the fade has 32 steps between the ends.
    const far = byRadius.map((f) => colorChannels(f.color).slice(0, 3).reduce((s, v, k) => s + Math.abs(v - (colorChannels(row.background)[k] ?? 0)), 0));
    expect(far.every((d, i) => i === 0 || d <= (far[i - 1] ?? 0))).toBe(true);
    expect(new Set(faces.map((f) => f.color)).size).toBeGreaterThan(25);
    // Flat, 5 mm under the floor, so it never ties a floor at 0 (surroundings.14).
    expect(vertices(faces).every((p) => p.z === -0.005)).toBe(true);
  });

  it("the ground has no gap: from the centre out, each band starts where the one inside it ends, out to the last ring", () => {
    const faces = groundFaces(SURROUNDINGS.outside, studio);
    const c = { x: 3.5, y: 1.25 };
    // Each face's radial span: a band's quad runs between its two radii; the disc round the centre from 0.
    const spans = new Map<string, { lo: number; hi: number }>();
    for (const f of faces) {
      const radii = f.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
      const [min, hi] = [Math.min(...radii), Math.max(...radii)];
      const lo = hi - min < 1e-9 ? 0 : min;
      spans.set(`${lo.toFixed(9)} ${hi.toFixed(9)}`, { lo, hi });
    }
    const bands = [...spans.values()].sort((a, b) => a.lo - b.lo);
    expect(bands.length).toBeGreaterThan(32);
    expect(bands[0]?.lo).toBe(0);
    for (let i = 1; i < bands.length; i++) expect(bands[i]?.lo, `band ${i} starts where band ${i - 1} ends`).toBeCloseTo(bands[i - 1]?.hi ?? NaN, 9);
    expect(Math.max(...bands.map((b) => b.hi))).toBe(bands.at(-1)?.hi);
  });

  it("mixes colours as #rrggbb, exact at both ends", () => {
    expect([mixColor("#b9c9a3", "#eef3f5", 0), mixColor("#b9c9a3", "#eef3f5", 1), mixColor("#000000", "#ffffff", 0.5)]).toEqual(["#b9c9a3", "#eef3f5", "#808080"]);
  });
});

describe("Interior's plate: the shell's box grown with round corners (step 06)", () => {
  it("the plate covers the shell's bounding box and has rounded corners", () => {
    const row = SURROUNDINGS.interior;
    for (const shell of houses) {
      const label = JSON.stringify(shell);
      const faces = groundFaces(row, shell);
      const points = vertices(faces);
      // The reach past a side, read on the four sides alone.
      const side = Math.max(...points.map((p) => Math.max(shell.min.x - p.x, p.x - shell.max.x, shell.min.y - p.y, p.y - shell.max.y)));
      expect(side, label).toBeGreaterThan(0.3);
      // Round corners: nothing lies farther from the box than the sides reach, as a square corner's tip would (√2 as far).
      expect(Math.max(...points.map((p) => outBy(shell, p))), label).toBeLessThanOrEqual(side + 1e-9);
      // It follows the box: the rim is at the sides' reach all round, on each side and along each corner's arc.
      const rim = points.filter((p) => Math.abs(outBy(shell, p) - side) < 1e-9);
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
        const corner = { x: sx > 0 ? shell.max.x : shell.min.x, y: sy > 0 ? shell.max.y : shell.min.y };
        const arc = rim.filter((p) => sx * (p.x - corner.x) > 1e-9 && sy * (p.y - corner.y) > 1e-9);
        expect(new Set(arc.map((p) => Math.atan2(p.y - corner.y, p.x - corner.x).toFixed(6))).size, `${label}: corner ${sx}, ${sy}`).toBeGreaterThanOrEqual(5);
      }
      for (const onSide of [(p: Point3) => p.x > shell.max.x, (p: Point3) => p.x < shell.min.x, (p: Point3) => p.y > shell.max.y, (p: Point3) => p.y < shell.min.y]) {
        expect(rim.some(onSide), label).toBe(true);
      }
      // Every point of the box, edges and corners included, lies on a face in the plate's own colour: sampled finer
      // than any piece the plate is cut into.
      const ts = [0, ...Array.from({ length: 48 }, (_, i) => (i + 0.5) / 48), 1];
      for (const tx of ts) {
        for (const ty of ts) {
          const p = { x: shell.min.x + (shell.max.x - shell.min.x) * tx, y: shell.min.y + (shell.max.y - shell.min.y) * ty };
          expect(faces.some((f) => f.color === row.ground && covers(f.points, p)), `${label}: ${p.x}, ${p.y} uncovered`).toBe(true);
        }
      }
    }
  });

  it("its rings fade to white, the last exactly the background", () => {
    const row = SURROUNDINGS.interior;
    expect([row.ground, row.background]).toEqual(["#d9d8d3", "#ffffff"]);
    for (const shell of houses) {
      const label = JSON.stringify(shell);
      const faces = groundFaces(row, shell);
      expect(faces.every((f) => f.outline === false && f.owner.startsWith("ground/") && COLOR_PATTERN.test(f.color)), label).toBe(true);
      expect(vertices(faces).every((p) => p.z === -0.005), label).toBe(true); // 5 mm under the floor (surroundings.14)
      const far = (f: (typeof faces)[number]): number => Math.max(...f.points.map((p) => outBy(shell, p)));
      const near = (f: (typeof faces)[number]): number => Math.min(...f.points.map((p) => outBy(shell, p)));
      const reach = Math.max(...faces.map(far));
      // Solid out to 0.35 of the reach, and the fade starts there: its first two rings round to the ground's colour, so
      // the innermost face in another colour starts within 0.05 of the reach past 0.35 (0.39 of it).
      expect(faces.filter((f) => far(f) <= 0.35 * reach + 1e-9).every((f) => f.color === row.ground), label).toBe(true);
      const start = Math.min(...faces.filter((f) => f.color !== row.ground).map(near)) / reach;
      expect(start, label).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(start, label).toBeLessThan(0.4);
      expect(faces.filter((f) => far(f) > reach - 1e-9).every((f) => f.color === row.background), label).toBe(true);
      // Out from the box, each face is no farther from white than any inside it, in more than 20 steps.
      const bg = colorChannels(row.background);
      const off = [...faces].sort((a, b) => far(a) - far(b)).map((f) => colorChannels(f.color).slice(0, 3).reduce((s, v, k) => s + Math.abs(v - (bg[k] ?? 0)), 0));
      expect(off.every((d, i) => i === 0 || d <= (off[i - 1] ?? 0)), label).toBe(true);
      expect(new Set(faces.map((f) => f.color)).size, label).toBeGreaterThan(20);
    }
  });

  it("the plate has no gap: out from the box, every point lies on a face, solid to 0.35 of the reach", () => {
    const row = SURROUNDINGS.interior;
    for (const shell of houses) {
      const faces = groundFaces(row, shell).map((f) => {
        const [xs, ys] = [f.points.map((p) => p.x), f.points.map((p) => p.y)];
        return { f, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      });
      const reach = Math.max(...faces.flatMap(({ f }) => f.points.map((p) => outBy(shell, p))));
      // Faces by grid cell, each in every cell its box touches, so a point is tried on the faces near it alone.
      const cell = reach / 8;
      const grid = new Map<string, typeof faces>();
      for (const b of faces) {
        for (let i = Math.floor((b.x0 - 1e-9) / cell); i <= Math.floor((b.x1 + 1e-9) / cell); i++) {
          for (let j = Math.floor((b.y0 - 1e-9) / cell); j <= Math.floor((b.y1 + 1e-9) / cell); j++) {
            const key = `${i},${j}`;
            const list = grid.get(key) ?? [];
            list.push(b);
            grid.set(key, list);
          }
        }
      }
      const { min, max } = shell;
      // Rays out from the box: square off each side at 64 points end to end, finer than any piece a side is cut into,
      // and fanned from each corner in 32, finer than any chord of its arc, so no piece next to a corner goes unvisited.
      const rays: { from: { x: number; y: number }; a: number }[] = [
        ...Array.from({ length: 64 }, (_, k) => (k + 0.5) / 64).flatMap((t) => {
          const [x, y] = [min.x + (max.x - min.x) * t, min.y + (max.y - min.y) * t];
          return [{ from: { x: max.x, y }, a: 0 }, { from: { x, y: max.y }, a: 90 }, { from: { x: min.x, y }, a: 180 }, { from: { x, y: min.y }, a: 270 }];
        }),
        ...[max, { x: min.x, y: max.y }, min, { x: max.x, y: min.y }].flatMap((from, c) => Array.from({ length: 32 }, (_, k) => ({ from, a: 90 * c + (90 * (k + 0.5)) / 32 }))),
      ];
      for (const { from, a } of rays) {
        for (let t = 0.005; t < 0.99; t += 0.01) {
          const p = { x: from.x + t * reach * Math.cos((a * Math.PI) / 180), y: from.y + t * reach * Math.sin((a * Math.PI) / 180) };
          const near = grid.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? [];
          const on = near.filter(({ f, x0, x1, y0, y1 }) => p.x >= x0 - 1e-9 && p.x <= x1 + 1e-9 && p.y >= y0 - 1e-9 && p.y <= y1 + 1e-9 && covers(f.points, p)).map(({ f }) => f);
          const label = `${JSON.stringify(shell)}: ${t.toFixed(3)} of the reach at ${a}°`;
          expect(on.length, `${label}, on no face`).toBeGreaterThan(0);
          if (t < 0.35 * 0.99) expect(on.some((f) => f.color === row.ground), `${label}, not solid`).toBe(true);
        }
      }
    }
  });
});

describe("Grid's plate: round, with 1 m lines that fade with it and stop at the shell's box (step 07, surroundings.16)", () => {
  const bytes = (hex: string): number[] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const at = (l: Line3d, t: number): { x: number; y: number } => ({ x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t });

  it("lines fall on whole metres, each segment takes its ring's colour, and the outermost is the background", () => {
    const row = SURROUNDINGS.grid;
    const inkColour = row.plate === "round" ? row.lines : undefined;
    expect([row.ground, row.background, inkColour]).toEqual(["#dbeee3", "#ffffff", "#a9c4b4"]);
    for (const shell of houses) {
      const label = JSON.stringify(shell);
      const faces = groundFaces(row, shell);
      const segs = lines(faces);
      expect(segs.length, label).toBeGreaterThan(100);
      const c = { x: (shell.min.x + shell.max.x) / 2, y: (shell.min.y + shell.max.y) / 2 };
      const radius = (p: { x: number; y: number }): number => Math.hypot(p.x - c.x, p.y - c.y);
      const R = Math.max(...faces.flatMap((f) => f.points.map(radius)));
      // On whole metres, along x or y, on the plate's level; every whole metre across the solid part has its line.
      for (const l of segs) {
        expect((l.a.x === l.b.x && Number.isInteger(l.a.x)) || (l.a.y === l.b.y && Number.isInteger(l.a.y)), `${label}: ${JSON.stringify(l)}`).toBe(true);
        expect([l.a.z, l.b.z], label).toEqual([-0.005, -0.005]);
      }
      for (let k = Math.ceil(c.x - 0.6 * R); k <= c.x + 0.6 * R; k++) expect(segs.some((l) => l.a.x === k && l.b.x === k), `${label}: x = ${k}`).toBe(true);
      for (let k = Math.ceil(c.y - 0.6 * R); k <= c.y + 0.6 * R; k++) expect(segs.some((l) => l.a.y === k && l.b.y === k), `${label}: y = ${k}`).toBe(true);
      // Faces by 0.25 m cell, so a point is tried on the faces near it alone.
      const cells = new Map<string, typeof faces>();
      const key = (x: number, y: number): string => `${Math.floor(x / 0.25)},${Math.floor(y / 0.25)}`;
      for (const f of faces) {
        const [xs, ys] = [f.points.map((p) => p.x), f.points.map((p) => p.y)];
        for (let x = Math.floor(Math.min(...xs) / 0.25); x <= Math.floor(Math.max(...xs) / 0.25); x++) {
          for (let y = Math.floor(Math.min(...ys) / 0.25); y <= Math.floor(Math.max(...ys) / 0.25); y++) cells.set(`${x},${y}`, [...(cells.get(`${x},${y}`) ?? []), f]);
        }
      }
      // The colours of the faces under a point, within 2 mm: a ring's polygon lies up to 1.4 mm inside its circle.
      const under = (p: { x: number; y: number }): Set<string> => new Set((cells.get(key(p.x, p.y)) ?? []).filter((f) => insideRing(p, f.points, 2e-3)).map((f) => f.color));
      // A ring's colour is the ground mixed into the background by some share s; its lines are the line colour by that s.
      const [g, bg, ink] = [bytes(row.ground), bytes(row.background), bytes(inkColour ?? "")];
      const k = [0, 1, 2].reduce((best, ch) => (Math.abs((bg[ch] ?? 0) - (g[ch] ?? 0)) > Math.abs((bg[best] ?? 0) - (g[best] ?? 0)) ? ch : best), 0);
      const lineFor = (ring: string): number[] => {
        const s = ((bg[k] ?? 0) - (bytes(ring)[k] ?? 0)) / ((bg[k] ?? 0) - (g[k] ?? 0));
        return [0, 1, 2].map((ch) => (bg[ch] ?? 0) - s * ((bg[ch] ?? 0) - (ink[ch] ?? 0)));
      };
      for (const l of segs) {
        // One ring under the whole segment: the colours under its quarter, middle and three-quarter points share one.
        const [q1, mid, q3] = [under(at(l, 0.25)), under(at(l, 0.5)), under(at(l, 0.75))];
        const rings = [...mid].filter((colour) => q1.has(colour) && q3.has(colour));
        expect(rings.length, `${label}: ${JSON.stringify(l)} lies on no one ring`).toBeGreaterThan(0);
        // On the solid plate, inside the fade (0.72 of R), exactly the line colour: the fade's first rings round to the
        // ground's colour while their lines are a step off.
        if (Math.max(radius(l.a), radius(l.b)) <= 0.72 * R) expect(l.color, label).toBe(inkColour);
        const want = rings.map(lineFor);
        expect(want.some((w) => bytes(l.color).every((v, ch) => Math.abs(v - (w[ch] ?? 0)) <= 2)), `${label}: ${l.color} on ${rings.join(", ")}`).toBe(true);
      }
      // The outermost: the segments reaching the plate's rim are exactly the background, and there are some.
      const outermost = segs.filter((l) => Math.max(radius(l.a), radius(l.b)) > R - 1e-9);
      expect(outermost.length, label).toBeGreaterThanOrEqual(4);
      expect(outermost.every((l) => l.color === row.background), label).toBe(true);
    }
  });

  it.each(DRAWN.filter(([name]) => name !== "grid"))("%s draws no lines: only Grid's row has them", (_, row) => {
    for (const shell of houses) expect(lines(groundFaces(row, shell)), JSON.stringify(shell)).toEqual([]);
  });

  it("no line lies inside the shell's bounding box, and the lines run up to it", () => {
    for (const shell of houses) {
      const label = JSON.stringify(shell);
      const segs = lines(groundFaces(SURROUNDINGS.grid, shell));
      const e = 1e-9; // a line's end on the box's side, as an interpolation lands on it
      const inside = (p: { x: number; y: number }): boolean => p.x > shell.min.x + e && p.x < shell.max.x - e && p.y > shell.min.y + e && p.y < shell.max.y - e;
      for (const l of segs) {
        for (let i = 0; i <= 64; i++) expect(inside(at(l, i / 64)), `${label}: ${JSON.stringify(l)}`).toBe(false);
      }
      // Each whole metre across the box has a line ending on each of the two sides it crosses.
      const ends = (l: Line3d): { x: number; y: number }[] => [l.a, l.b];
      for (let k = Math.floor(shell.min.x) + 1; k < shell.max.x; k++) {
        for (const y of [shell.min.y, shell.max.y]) expect(segs.some((l) => l.a.x === k && l.b.x === k && ends(l).some((p) => Math.abs(p.y - y) < 1e-9)), `${label}: x = ${k} at y ${y}`).toBe(true);
      }
      for (let k = Math.floor(shell.min.y) + 1; k < shell.max.y; k++) {
        for (const x of [shell.min.x, shell.max.x]) expect(segs.some((l) => l.a.y === k && l.b.y === k && ends(l).some((p) => Math.abs(p.x - x) < 1e-9)), `${label}: y = ${k} at x ${x}`).toBe(true);
      }
    }
  });
});

describe("no plate where the frame leaves no room for one (surroundings.13)", () => {
  // No real house gets here: walls 0.20 m thick and a ceiling over the floor always leave a reach. A flat box a few
  // millimetres wide does, its frame (under a millimetre round) not reaching the plate 5 mm under the floor.
  const speck: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 0.001, y: 0.001 }, top: 0 };
  it.each([["Interior", SURROUNDINGS.interior], ["Outside", SURROUNDINGS.outside], ["Grid", SURROUNDINGS.grid]] as const)("%s draws no ground rather than one that leaves the frame", (_, row) => {
    expect(groundFaces(row, speck)).toEqual([]);
  });
});

describe("the ground in the frame (surroundings.13, .14, AC-02)", () => {
  it.each(DRAWN)("%s: every line and ring vertex is within clip radius 1 at yaw steps of 15° and tilt steps of 5°, and reaches it", (_, row) => {
    for (const shell of houses) {
      const points = vertices(groundFaces(row, shell));
      expect(points.length, JSON.stringify(shell)).toBeGreaterThan(1000);
      let reach = 0;
      for (const yaw of YAWS) {
        for (const tilt of TILTS) {
          const cam = camera3d(framedBounds(row, shell), { yaw, tilt });
          const worst = Math.max(...points.map((p) => Math.hypot(cam.project(p).x, cam.project(p).y)));
          expect(worst, `${JSON.stringify(shell)} at yaw ${yaw}, tilt ${tilt}`).toBeLessThanOrEqual(1);
          reach = Math.max(reach, worst);
        }
      }
      expect(reach, `${JSON.stringify(shell)}: the plate reaches the frame at its worst view`).toBeGreaterThan(0.98);
    }
  });

  it("the framed box is the shell's, pulled to 0.88; Outside's ground lies at the floor, so it has no bottom", () => {
    expect(framedBounds(SURROUNDINGS.outside, studio)).toEqual({ ...studio, pull: 0.88 });
  });

  it("every surroundings pulls by the same 0.88 (AC-03)", () => {
    const rows = Object.values(SURROUNDINGS);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(framedBounds(row, studio).pull).toBe(0.88);
  });
});

describe("On wheels' ground: the grass 0.75 m down, the house where it is (step 09, surroundings.12, .14, AC-02, AC-03, AC-08)", () => {
  const set = (doc: Document, value: string): Document => withCommands(doc, { type: "setProjectField", key: "surroundings", value });
  /** The studio, a long narrow house and a small tall one: walls 0.20 m thick round 7 × 0.5 m and 1 × 1 m under 2.50. */
  const wheeled: Bounds3[] = [
    studio,
    { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 0.6 }, top: 2.5 },
    { min: { x: -0.1, y: -0.1 }, max: { x: 1.1, y: 1.1 }, top: 2.5 },
  ];

  it("the ground is at −0.75, and the bounds carry that bottom and the pull", () => {
    const row = SURROUNDINGS.wheels;
    // Outside's grass, sky and round plate (the spec's "the same grass"), 0.75 m down.
    expect(row).toEqual({ ...SURROUNDINGS.outside, below: 0.75 });
    for (const shell of wheeled) {
      const label = JSON.stringify(shell);
      expect(framedBounds(row, shell), label).toEqual({ ...shell, bottom: -0.75, pull: 0.88 });
      const points = vertices(groundFaces(row, shell));
      expect(points.length, label).toBeGreaterThan(1000);
      // The plate lies 5 mm under the ground, as every plate lies under its floor (surroundings.23).
      expect(points.every((p) => p.z === -0.755), label).toBe(true);
    }
    // Look's scene and the panel's carry that box, from the ground up and pulled, with the sky behind.
    const doc = set(studioDoc(), "wheels");
    const look = lookScene3d(doc, "s0", DEFAULT_ANGLES);
    if ("refused" in look) throw new Error(look.refused);
    const shell = shellBounds(doc);
    expect(look.bounds).toEqual({ ...shell, bottom: -0.75, pull: 0.88 });
    expect(look.background).toBe(SURROUNDINGS.outside.background);
    expect(look.caption).toMatch(/the On wheels surroundings, not part of the drawing$/);
    const s = FakeShell.withDocument(doc);
    s.key("3");
    const panel = view3dFrame(s.state)?.scene;
    expect(panel?.bounds).toStrictEqual(look.bounds);
    expect(panel?.ground).toEqual(look.faces.filter((f) => f.owner.startsWith("ground/")));
  });

  it("the plate is inside the frame at every step, on the studio, on 7 × 0.5 m and on 1 × 1 m", () => {
    const row = SURROUNDINGS.wheels;
    for (const shell of wheeled) {
      const label = JSON.stringify(shell);
      const points = vertices(groundFaces(row, shell));
      expect(points.length, `${label}: a plate`).toBeGreaterThan(1000); // the 1 × 1 m room has one too (surroundings.14)
      let reach = 0;
      for (const yaw of YAWS) {
        for (const tilt of TILTS) {
          const cam = camera3d(framedBounds(row, shell), { yaw, tilt });
          const worst = Math.max(...points.map((p) => Math.hypot(cam.project(p).x, cam.project(p).y)));
          expect(worst, `${label} at yaw ${yaw}, tilt ${tilt}`).toBeLessThanOrEqual(1);
          reach = Math.max(reach, worst);
        }
      }
      expect(reach, `${label}: the plate reaches the frame at its worst view`).toBeGreaterThan(0.98);
    }
  });

  it("every face owned by the house equals the same face under None", () => {
    const withDoor = (doc: Document): Document =>
      withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2.6 });
    const docs: [string, Document][] = [["studio", withDoor(studioDoc())], ["loft", loftRoomDoc()], ["niches", nichesDoc()]];
    const views: Angles3d[] = [DEFAULT_ANGLES, { yaw: 315, tilt: 10 }, { yaw: 45, tilt: 60 }, { yaw: 135, tilt: 90 }];
    for (const [name, none] of docs) {
      const doc = set(none, "wheels");
      for (const angles of views) {
        const label = `${name} at ${angles.yaw}°, ${angles.tilt}°`;
        const [a, b] = [lookScene3d(none, "s0", angles), lookScene3d(doc, "s0", angles)];
        if ("refused" in a || "refused" in b) throw new Error(label);
        const ground = b.faces.filter((f) => f.owner.startsWith("ground/"));
        const trailer = b.faces.filter((f) => f.owner.startsWith("trailer/"));
        expect(ground.length, `${label}: the ground draws`).toBeGreaterThan(1000);
        expect(trailer.length, `${label}: the trailer draws`).toBeGreaterThan(0);
        expect(b.faces, label).toEqual([...ground, ...a.faces, ...trailer]);
        // The panel's scene: the same items and the same house's faces, only its box and its ground added.
        const [p, q] = [none, doc].map((d) => {
          const s = FakeShell.withDocument(d);
          s.key("3");
          s.state = { ...s.state, view3d: { ...s.state.view3d, ...angles } };
          const scene = view3dFrame(s.state)?.scene;
          if (!scene) throw new Error(label);
          return scene;
        });
        expect(q?.ground?.length, label).toBeGreaterThan(1000);
        expect(q?.items, label).toEqual(p?.items);
        expect(q && sceneFaces(q), label).toEqual(p && [...sceneFaces(p), ...trailer]);
      }
    }
  });
});

describe("the trailer under a house on wheels (step 10, surroundings.08, .16, AC-08)", () => {
  const set = (doc: Document, value: string): Document => withCommands(doc, { type: "setProjectField", key: "surroundings", value });
  /** The same house turned a quarter: its long side along y. */
  const deep = (b: Bounds3): Bounds3 => ({ min: { x: b.min.y, y: b.min.x }, max: { x: b.max.y, y: b.max.x }, top: b.top });
  const square: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 3.1, y: 3.1 }, top: 2.5 };
  /** Wide, deep, square (x on a tie), long and narrow, and small. */
  const trailered: [string, Bounds3][] = [
    ["wide", studio], ["deep", deep(studio)], ["square", square],
    ["narrow", { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 0.6 }, top: 2.5 }], ["small", { min: { x: -0.1, y: -0.1 }, max: { x: 1.1, y: 1.1 }, top: 2.5 }],
  ];
  /** The trailer's faces by part (owner), in order. */
  const parts = (faces: readonly Face3d[]): Map<string, Face3d[]> => {
    const by = new Map<string, Face3d[]>();
    for (const f of faces) by.set(f.owner, [...(by.get(f.owner) ?? []), f]);
    return by;
  };
  const range = (faces: readonly Face3d[], k: "x" | "y" | "z"): [number, number] => {
    const v = faces.flatMap((f) => f.points.map((p) => p[k]));
    return [Math.min(...v), Math.max(...v)];
  };
  const mid = ([a, b]: [number, number]): number => (a + b) / 2;
  /** The trailer under `shell` on wheels, as aroundShell builds it: from the framed box. */
  const trailerOf = (shell: Bounds3): Face3d[] => trailerFaces(framedBounds(SURROUNDINGS.wheels, shell));
  const centroid = (points: readonly Point3[]): Point3 => ({
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
    z: points.reduce((s, p) => s + p.z, 0) / points.length,
  });

  it("the deck covers the shell's bounding box, its top under every floor, on a wide and a deep house", () => {
    for (const [name, shell] of trailered.slice(0, 2)) {
      const faces = trailerOf(shell);
      expect(faces.every((f) => f.owner.startsWith("trailer/")), name).toBe(true);
      const deck = parts(faces).get("trailer/deck") ?? [];
      expect([range(deck, "x"), range(deck, "y")], name).toEqual([[shell.min.x, shell.max.x], [shell.min.y, shell.max.y]]);
      // Its top: one flat face over the whole box, 2 mm under the floor, the deck 0.25 m thick under it.
      const [bottom, top] = range(deck, "z");
      const tops = deck.filter((f) => f.points.every((p) => p.z === top));
      expect(tops.length, name).toBe(1);
      const corners = [shell.min.x, shell.max.x].flatMap((x) => [shell.min.y, shell.max.y].map((y) => `${x} ${y}`)).sort();
      expect(tops[0]?.points.map((p) => `${p.x} ${p.y}`).sort(), `${name}: the top is the box`).toEqual(corners);
      expect(top, name).toBeCloseTo(-0.002, 9);
      expect(top - bottom, name).toBeCloseTo(0.25, 9);
    }
    // In look and the panel, on a wide and a deep house: under every floor, and the same trailer in both.
    for (const [name, none] of [["wide", studioDoc()], ["deep", clearRoomDoc(2.5, 7, "d")]] as const) {
      const doc = set(none, "wheels");
      const look = lookScene3d(doc, "s0", DEFAULT_ANGLES);
      if ("refused" in look) throw new Error(look.refused);
      const shell = shellBounds(doc);
      if (!shell) throw new Error(name);
      const trailer = look.faces.filter((f) => f.owner.startsWith("trailer/"));
      expect(trailer, name).toEqual(trailerOf(shell));
      const floors = look.faces.filter((f) => f.owner.startsWith("floor/"));
      expect(floors.length, name).toBeGreaterThan(0);
      expect(range(trailer, "z")[1], name).toBeLessThan(range(floors, "z")[0]);
      const s = FakeShell.withDocument(doc);
      s.key("3");
      expect(view3dFrame(s.state)?.scene.trailer, name).toEqual(trailer);
    }
    // No trailer with the ground at the floor, nor with None.
    for (const value of ["outside", "interior", "grid", ""]) {
      const look = lookScene3d(set(studioDoc(), value), "s0", DEFAULT_ANGLES);
      if ("refused" in look) throw new Error(look.refused);
      expect(look.faces.some((f) => f.owner.startsWith("trailer/")), value).toBe(false);
    }
  });

  it("the axles run across the longer side and sit near its middle, for wide and deep alike, x on a tie", () => {
    for (const [name, shell] of trailered.slice(0, 3)) {
      const by = parts(trailerOf(shell));
      const long = shell.max.x - shell.min.x >= shell.max.y - shell.min.y ? "x" : "y"; // x on a tie
      const short = long === "x" ? "y" : "x";
      const axles = [...by.keys()].filter((o) => o.startsWith("trailer/axle")).map((o) => by.get(o) ?? []);
      expect(axles.length, name).toBe(2);
      const along = axles.map((a) => mid(range(a, long))).sort((a, b) => a - b);
      for (const a of axles) {
        // Across the short side, nearly its whole width, thin along the long one.
        const [s0, s1] = range(a, short);
        expect(s1 - s0, name).toBeGreaterThan(0.8 * (shell.max[short] - shell.min[short]));
        expect(mid([s0, s1]), name).toBeCloseTo(mid([shell.min[short], shell.max[short]]), 9);
        expect(range(a, long)[1] - range(a, long)[0], name).toBeLessThan(0.1);
      }
      // 0.42 m either side of their middle, 0.3 m off the long side's middle toward its higher end, the drawbar's, as
      // the approved mock-up's (c-wheels-pulled).
      const middle = mid([shell.min[long], shell.max[long]]);
      expect((along[1] ?? 0) - (along[0] ?? 0), name).toBeCloseTo(0.84, 9);
      expect(mid([along[0] ?? 0, along[1] ?? 0]), name).toBeCloseTo(middle + 0.3, 9);
      // Two wheels on each, one at each long side (inside the deck both ways: the test below).
      const wheels = [...by.keys()].filter((o) => o.startsWith("trailer/wheel")).map((o) => by.get(o) ?? []);
      expect(wheels.length, name).toBe(4);
      for (const at of along) {
        const on = wheels.filter((w) => Math.abs(mid(range(w, long)) - at) < 1e-9);
        expect(on.length, `${name}: wheels on the axle at ${at}`).toBe(2);
        const sides = on.map((w) => range(w, short)).sort((a, b) => a[0] - b[0]);
        expect((sides[0]?.[1] ?? 0) - (sides[0]?.[0] ?? 0), `${name}: a wheel's width, its hub in`).toBeCloseTo(0.23, 9);
      }
    }
  });

  /** The trailered houses, then a short, a short deep, and two narrow ones: a lone 3 m wall and a 0.4 m wide box. */
  const anyHouse: [string, Bounds3][] = [
    ...trailered,
    ["short", { min: { x: -0.1, y: -0.1 }, max: { x: 1.7, y: 1.1 }, top: 2.5 }],
    ["short deep", { min: { x: -0.1, y: -0.1 }, max: { x: 1.1, y: 1.7 }, top: 2.5 }],
    ["wall", { min: { x: 0, y: -0.1 }, max: { x: 3, y: 0.1 }, top: 2.5 }],
    ["thin", { min: { x: 0, y: 0 }, max: { x: 3, y: 0.4 }, top: 2.5 }],
    ["e2e room", { min: { x: -0.1, y: -0.1 }, max: { x: 2.1, y: 2.1 }, top: 2.5 }],
  ];

  it("on any house the wheels and axles lie inside the deck both ways and the wheels apart: a short or narrow one gets a smaller gear", () => {
    for (const [name, shell] of anyHouse) {
      const by = parts(trailerOf(shell));
      const gear = [...by.keys()].filter((o) => /^trailer\/(wheel|axle)/.test(o));
      expect(gear.length, name).toBe(6);
      for (const owner of gear) {
        const faces = by.get(owner) ?? [];
        for (const k of ["x", "y"] as const) {
          const [lo, hi] = range(faces, k);
          expect(lo, `${name} ${owner} ${k}`).toBeGreaterThan(shell.min[k]);
          expect(hi, `${name} ${owner} ${k}`).toBeLessThan(shell.max[k]);
        }
      }
      // No two wheels meet: their boxes are apart along x or y.
      const wheels = gear.filter((o) => o.startsWith("trailer/wheel")).map((o) => by.get(o) ?? []);
      for (const [i, a] of wheels.entries()) {
        for (const b of wheels.slice(i + 1)) {
          const apart = (["x", "y"] as const).some((k) => range(a, k)[1] < range(b, k)[0] || range(b, k)[1] < range(a, k)[0]);
          expect(apart, `${name}: two wheels meet`).toBe(true);
        }
      }
    }
    // A house the mock-up's gear fits (2.16 m by 0.56 m) keeps it full size.
    for (const [name, shell] of anyHouse.filter(([n]) => ["wide", "deep", "square", "narrow", "e2e room"].includes(n))) {
      const wheel = parts(trailerOf(shell)).get("trailer/wheel-1") ?? [];
      expect(range(wheel, "z")[1] - range(wheel, "z")[0], `${name}: 0.33 m in radius`).toBeCloseTo(0.66, 9);
    }
  });

  it("on any house every wheel's top reaches 0.4 of its radius into the deck, so a smaller gear never hangs under it", () => {
    for (const [name, shell] of anyHouse) {
      const by = parts(trailerOf(shell));
      const deck = range(by.get("trailer/deck") ?? [], "z");
      expect(deck[1], `${name}: the deck's top`).toBeCloseTo(-0.002, 9);
      const wheels = [...by.keys()].filter((o) => o.startsWith("trailer/wheel"));
      expect(wheels.length, name).toBe(4);
      for (const owner of wheels) {
        const [low, top] = range(by.get(owner) ?? [], "z");
        expect(top - deck[0], `${name} ${owner}: its top into the deck`).toBeGreaterThanOrEqual((0.4 * (top - low)) / 2 - 1e-9);
        expect(top, `${name} ${owner}: under the deck's top`).toBeLessThan(deck[1]);
      }
    }
  });

  it("the trailer takes its steel and hubs from the palette look is given, as the house does", () => {
    const b = { top: "#2f2b28", lit: "#29261f", shaded: "#221f1c" };
    const metal = { top: "#7d848b", lit: "#6f757b", shaded: "#61666b" };
    const style = { ...STYLE_3D, slots: { ...STYLE_3D.slots, dark: b, metal } };
    const look = lookScene3d(set(studioDoc(), "wheels"), "s0", DEFAULT_ANGLES, style);
    if ("refused" in look) throw new Error(look.refused);
    const colors = new Set(look.faces.filter((f) => f.owner.startsWith("trailer/")).map((f) => f.color));
    expect(colors.size).toBeGreaterThan(1);
    expect([...colors].filter((c) => ![b.top, b.lit, b.shaded, metal.top].includes(c))).toEqual([]);
    expect(colors.has(metal.top), "the hubs").toBe(true);
    expect(colors.has(b.lit) || colors.has(b.shaded), "the steel's sides").toBe(true);
  });

  it("no outlined trailer face reaches into another part: lines get no polygon offset, so one would show through it", () => {
    for (const [name, shell] of anyHouse) {
      const by = parts(trailerOf(shell));
      /** Whether `p` lies in the box of `faces`, its sides counted in. */
      const within = (faces: readonly Face3d[], p: Point3): boolean =>
        (["x", "y", "z"] as const).every((k) => p[k] >= range(faces, k)[0] - 1e-9 && p[k] <= range(faces, k)[1] + 1e-9);
      const into = [...by].flatMap(([owner, faces]) => faces.filter((f) => f.outline !== false).flatMap((f) =>
        [...by].filter(([other, of]) => other !== owner && f.points.some((p) => within(of, p))).map(([other]) => `${owner} into ${other}`)));
      expect([...new Set(into)], name).toEqual([]);
    }
    // On a full-size house the wheels' tops do reach into the deck, as the mock-up's: tread, sides and hub alike.
    const wheel = parts(trailerOf(studio)).get("trailer/wheel-1") ?? [];
    expect(range(wheel, "z")[1]).toBeGreaterThan(-0.252);
    const hub = wheel.filter((f) => f.color === STYLE_3D.slots.metal.top);
    expect(range(hub, "z")[1]).toBeGreaterThan(-0.252);
  });

  it("a wheel's hub is 0.55 of its radius on its outer side, and each axle runs through its wheels' centres", () => {
    for (const [name, shell] of anyHouse) {
      const by = parts(trailerOf(shell));
      const long = shell.max.x - shell.min.x >= shell.max.y - shell.min.y ? "x" : "y"; // x on a tie
      const short = long === "x" ? "y" : "x";
      const middle = mid([shell.min[short], shell.max[short]]);
      const axles = [1, 2].map((i) => by.get(`trailer/axle-${i}`) ?? []);
      for (const owner of [...by.keys()].filter((o) => o.startsWith("trailer/wheel"))) {
        const wheel = by.get(owner) ?? [];
        const hub = wheel.filter((f) => f.color === STYLE_3D.slots.metal.top);
        expect(hub.length, `${name} ${owner}`).toBe(1);
        const [z, h] = [range(wheel, "z"), range(hub, "z")];
        expect(h[1] - h[0], `${name} ${owner}: the hub's size`).toBeCloseTo(0.55 * (z[1] - z[0]), 9);
        expect(mid(h), `${name} ${owner}: the hub's centre`).toBeCloseTo(mid(z), 9);
        // Out on the side away from the deck's middle: the wheel's farthest point across.
        const out = (v: number): number => Math.abs(v - middle);
        expect(out(range(hub, short)[0]), `${name} ${owner}: the hub outside`).toBeCloseTo(Math.max(...range(wheel, short).map(out)), 9);
        const axle = axles.find((a) => Math.abs(mid(range(a, long)) - mid(range(wheel, long))) < 1e-9) ?? [];
        expect(axle.length, `${name} ${owner}: its axle`).toBeGreaterThan(0);
        expect(mid(range(axle, "z")), `${name} ${owner}: the axle at the wheel's centre`).toBeCloseTo(mid(z), 9);
      }
    }
  });

  it("the lowest wheel and jack points are at exactly −0.75", () => {
    for (const [name, shell] of trailered) {
      const faces = trailerOf(shell);
      const by = parts(faces);
      const grounded = [...by.keys()].filter((o) => /^trailer\/(wheel|jack)/.test(o));
      expect(grounded.filter((o) => o.startsWith("trailer/wheel")).length, name).toBe(4);
      for (const owner of grounded) {
        const [low, high] = range(by.get(owner) ?? [], "z");
        expect(low, `${name} ${owner}`).toBe(-0.75);
        expect(high, `${name} ${owner}: under the floor`).toBeLessThan(0);
      }
      expect(range(faces, "z")[0], `${name}: nothing goes under the ground`).toBe(-0.75);
    }
  });

  it("every face is wound from outside: visible() keeps it exactly when its outside faces the camera, at each yaw", () => {
    for (const [name, shell] of trailered) {
      const by = parts(trailerOf(shell));
      expect(by.size, name).toBeGreaterThan(6);
      for (const [owner, faces] of by) {
        // A part is convex: its outside is away from its middle.
        const c = centroid(faces.flatMap((f) => f.points));
        const outward = (f: Face3d): Point3 => {
          const n = normal(f.points);
          const m = centroid(f.points);
          return (m.x - c.x) * n.x + (m.y - c.y) * n.y + (m.z - c.z) * n.z >= 0 ? n : { x: -n.x, y: -n.y, z: -n.z };
        };
        for (const yaw of YAWS) {
          for (const tilt of [TILT_MIN, 35, TILT_MAX]) {
            const m = camera3d(studio, { yaw, tilt }).matrix;
            const back = { x: -(m[8] ?? 0), y: -(m[9] ?? 0), z: -(m[10] ?? 0) };
            const facing = (f: Face3d): number => {
              const n = outward(f);
              return (n.x * back.x + n.y * back.y + n.z * back.z) / (Math.hypot(n.x, n.y, n.z) || 1);
            };
            const clear = faces.filter((f) => Math.abs(facing(f)) > 1e-6); // edge-on faces are neither
            const seen = new Set(visible(clear, { yaw, tilt }));
            const wrong = clear.filter((f) => seen.has(f) !== facing(f) > 0);
            expect(wrong.length, `${name} ${owner} at ${yaw}°, ${tilt}°`).toBe(0);
          }
        }
      }
    }
  });

  describe("the drawbar and its jack (step 11, surroundings.16, AC-08)", () => {
    const longThin: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 7, y: 0.5 }, top: 2.5 }; // a 7 × 0.5 m house
    /** The drawbar's length past the deck's end, along the long axis `u`. */
    const barLength = (shell: Bounds3, u: "x" | "y"): number => range(parts(trailerOf(shell)).get("trailer/drawbar") ?? [], u)[1] - shell.max[u];

    it("the studio's bar is 1.30 m and a 7 × 0.5 m house's is about 1.0 m", () => {
      expect(barLength(studio, "x")).toBeCloseTo(1.3, 9);
      const short = barLength(longThin, "x");
      expect(short).toBeGreaterThan(0.9);
      expect(short).toBeLessThan(1.1);
    });

    it("the tip and the jack are inside the frame at every yaw and tilt step", () => {
      const all: [string, Bounds3][] = [...anyHouse, ["7 × 0.5", longThin], ...houses.map((h, i): [string, Bounds3] => [`house ${i}`, h])];
      for (const [name, shell] of all) {
        const by = parts(trailerOf(shell));
        const bar = [...(by.get("trailer/drawbar") ?? []), ...(by.get("trailer/jack") ?? [])].flatMap((f) => f.points);
        expect(bar.length, `${name}: a drawbar and a jack`).toBeGreaterThan(16);
        let reach = 0;
        for (const yaw of YAWS) {
          for (const tilt of TILTS) {
            const cam = camera3d(framedBounds(SURROUNDINGS.wheels, shell), { yaw, tilt });
            const worst = Math.max(...bar.map((p) => Math.hypot(cam.project(p).x, cam.project(p).y)));
            expect(worst, `${name} at yaw ${yaw}, tilt ${tilt}`).toBeLessThanOrEqual(1);
            reach = Math.max(reach, worst);
          }
        }
        // A bar cut short by the frame reaches its edge at the worst view.
        if (barLength(shell, shell.max.x - shell.min.x >= shell.max.y - shell.min.y ? "x" : "y") < 1.3 - 1e-9) expect(reach, name).toBeGreaterThan(0.98);
      }
    });

    it("it goes on the higher end of the long axis, along x on a tie, and along y for a deep house", () => {
      for (const [name, shell, u, v] of [["wide", studio, "x", "y"], ["square", { min: { x: -0.1, y: -0.1 }, max: { x: 3.1, y: 3.1 }, top: 2.5 }, "x", "y"], ["deep", deep(studio), "y", "x"]] as const) {
        const by = parts(trailerOf(shell));
        const bar = by.get("trailer/drawbar") ?? [];
        const jack = by.get("trailer/jack") ?? [];
        // From the deck's end on the higher side, out past it, centred across.
        expect(range(bar, u)[0], name).toBeCloseTo(shell.max[u], 9);
        expect(range(bar, u)[1], name).toBeGreaterThan(shell.max[u] + 1);
        expect(mid(range(bar, v)), name).toBeCloseTo(mid([shell.min[v], shell.max[v]]), 9);
        // Wide at the deck, a 0.08 m tip; 0.08 m tall, its bottom at the deck's underside.
        const tip = bar.flatMap((f) => f.points).filter((p) => Math.abs(p[u] - range(bar, u)[1]) < 1e-9).map((p) => p[v]);
        expect(Math.max(...tip) - Math.min(...tip), `${name}: the tip`).toBeCloseTo(0.08, 9);
        const deckBottom = range(by.get("trailer/deck") ?? [], "z")[0];
        expect(range(bar, "z"), name).toEqual([deckBottom, expect.closeTo(deckBottom + 0.08, 9)]);
        // The jack: a 0.1 m column from the ground to the bar, centred 0.25 m in from the tip.
        expect(range(jack, u)[1] - range(jack, u)[0], name).toBeCloseTo(0.1, 9);
        expect(range(jack, v)[1] - range(jack, v)[0], name).toBeCloseTo(0.1, 9);
        expect(mid(range(jack, u)), name).toBeCloseTo(range(bar, u)[1] - 0.25, 9);
        expect(range(jack, "z"), name).toEqual([-0.75, deckBottom]);
        // Neither has outlines: each touches the deck or the other (lines get no polygon offset).
        expect([...bar, ...jack].every((f) => f.outline === false), name).toBe(true);
      }
    });

    it("no drawbar or jack where the frame leaves under 0.35 m for one", () => {
      const speck: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 0.001, y: 0.001 }, top: 0 };
      const owners = new Set(trailerOf(speck).map((f) => f.owner));
      expect(owners.has("trailer/deck")).toBe(true);
      expect(owners.has("trailer/drawbar") || owners.has("trailer/jack")).toBe(false);
    });
  });
});

describe("every surroundings has its row (surroundings.22)", () => {
  it("each value the menu offers draws with its own row and label, and only None draws without one", () => {
    for (const { value, label } of SURROUNDINGS_VALUES) {
      const doc = withCommands(studioDoc(), { type: "setProjectField", key: "surroundings", value });
      expect(surroundingsRow(doc), value).toEqual({ row: SURROUNDINGS[value], label });
    }
    expect(surroundingsRow(studioDoc())).toBeNull();
  });
});
