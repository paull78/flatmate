import { assertNever, type Point } from "@fm/protocol";
import type { Primitive } from "../scene-types";
import { arc, ringSegments, seg, TAU, type Parts, type SymbolOf, type SymbolTable } from "./lines";

// The plants (symbols.19): each a solid canopy with dark lines, as in plan drawings of planting, so it reads on any floor
// and at 1:100. A canopy is a lobed line inside the round ring the plant fits by; it isn't convex, so it only draws. Every
// length scales with each radius, so a stretched plant stays inside its ring.

/** A point at `radius` of the radii and angle `a`, about the footprint's centre. */
const polar = (w: number, d: number, radius: number, a: number): Point => ({ x: (w / 2) * radius * Math.cos(a), y: -d / 2 + (d / 2) * radius * Math.sin(a) });

const line = (w: number, d: number, r0: number, a0: number, r1: number, a1: number): Primitive => {
  const [p, q] = [polar(w, d, r0, a0), polar(w, d, r1, a1)];
  return seg(p.x, p.y, q.x, q.y);
};

/** A centred circle at `share` of the smaller radius. */
const circle = (w: number, d: number, share: number): Primitive => arc(0, -d / 2, share * (Math.min(w, d) / 2), 0, TAU);

/** A little unevenness, so a canopy doesn't look stamped: fixed, so a plant always draws the same. */
const uneven = (t: number, amount: number): number => 1 + amount * (Math.sin(3 * t + 1) * 0.6 + Math.sin(5 * t + 2) * 0.4);

/** How far a lobed outline reaches, as a share of the radii: never past the 32-gon's inscribed circle. */
const MAX_REACH = 0.98;

type Lobes = { lobes: number; points: number; trough: number; tip: number; shape: "round" | "pointed" | "petal"; unevenness: number; shorter?: readonly number[]; scale?: number; phase?: number };

/** A lobe's height from its trough (0) to its tip (1), at `u`, the angle's share of a lobe from its tip (0) to its trough (1). */
function lobeHeight(shape: Lobes["shape"], u: number): number {
  const across = Math.abs(Math.sin((u * Math.PI) / 2));
  switch (shape) {
    case "round": // a scallop, its troughs sharp
      return (1 - across * across) ** 0.5;
    case "pointed": // a leaf, its tip sharp and its base wide
      return (1 - across) ** 0.8;
    case "petal": // a soft bump
      return (1 - across * across) ** 1.5;
    default:
      return assertNever(shape);
  }
}

/**
 * A closed lobed ring: `lobes` bumps from `trough` to `tip`, each tip shortened by its turn in `shorter`, so a leafy edge
 * isn't a cog. A tip is a point of the ring, as `points` divides a lobe evenly.
 */
function lobedRing(w: number, d: number, s: Lobes): Point[] {
  const n = s.lobes * s.points;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * TAU;
    const lobe = Math.round(i / s.points); // the tip this point belongs to
    const u = Math.min(1, Math.abs(i - lobe * s.points) / (s.points / 2));
    const tip = s.tip * (s.shorter?.[lobe % s.shorter.length] ?? 1);
    const r = Math.min(MAX_REACH, (s.trough + (tip - s.trough) * lobeHeight(s.shape, u)) * uneven(t, s.unevenness));
    return polar(w, d, (s.scale ?? 1) * r, t + (s.phase ?? 0));
  });
}

const PLANT: Lobes = { lobes: 13, points: 6, trough: 0.8, tip: 0.97, shape: "round", unevenness: 0.02 };
const PLANT_BRANCHES = 7;

/** A broadleaf plant: a scalloped canopy with branching veins from its centre. */
function plant(w: number, d: number): Parts {
  const branches = Array.from({ length: PLANT_BRANCHES }, (_, k) => ((k + 0.3) / PLANT_BRANCHES) * TAU);
  return {
    line: [...ringSegments(lobedRing(w, d, PLANT)), ...branches.map((a) => line(w, d, 0.04, a, 0.42, a + 0.08))],
    detail: branches.flatMap((a) => [line(w, d, 0.42, a + 0.08, 0.74, a - 0.26), line(w, d, 0.42, a + 0.08, 0.76, a + 0.4), line(w, d, 0.56, a - 0.06, 0.74, a + 0.08)]),
  };
}

const PALM_FRONDS = 9;
const PALM: Lobes = { lobes: PALM_FRONDS, points: 10, trough: 0.3, tip: 0.97, shape: "pointed", unevenness: 0 };

/** A palm: a star of pointed fronds, each with a midrib and short barbs, round a pot. */
function palm(w: number, d: number): Parts {
  const fronds = Array.from({ length: PALM_FRONDS }, (_, k) => (k / PALM_FRONDS) * TAU);
  return {
    line: [...ringSegments(lobedRing(w, d, PALM)), ...fronds.map((a) => line(w, d, 0.16, a, 0.9, a)), circle(w, d, 0.16)],
    detail: [
      ...fronds.flatMap((a) => [0.34, 0.5, 0.66].flatMap((t) => [-1, 1].map((side) => line(w, d, t, a, t + 0.11, a + side * (0.17 - 0.16 * t))))),
      circle(w, d, 0.05),
    ],
  };
}

const FERN_FRONDS = 22;
const FERN: Lobes = { lobes: FERN_FRONDS, points: 6, trough: 0.6, tip: 0.97, shape: "pointed", unevenness: 0.01, shorter: [1, 0.84, 0.94, 0.8, 0.9] };

/** A fern: a dense frilly edge, a fine line out to each frill and a small dark heart. */
function fern(w: number, d: number): Parts {
  const lines = Array.from({ length: FERN_FRONDS }, (_, k) => {
    const a = (k / FERN_FRONDS) * TAU;
    return line(w, d, k % 2 ? 0.12 : 0.26, a, k % 2 ? 0.56 : 0.72, a);
  });
  return { line: [...ringSegments(lobedRing(w, d, FERN)), circle(w, d, 0.07)], detail: lines };
}

const ROSETTE: Lobes = { lobes: 8, points: 6, trough: 0.62, tip: 0.97, shape: "petal", unevenness: 0 };
const ROSETTE_MIDDLE: Lobes = { lobes: 6, points: 6, trough: 0.6, tip: 0.97, shape: "petal", unevenness: 0, scale: 0.62, phase: 0.3 };
const ROSETTE_HEART: Lobes = { lobes: 5, points: 6, trough: 0.6, tip: 0.97, shape: "petal", unevenness: 0, scale: 0.3 };

/** A rosette: three layers of petals, one inside the other. */
function rosette(w: number, d: number): Parts {
  return {
    line: [...ringSegments(lobedRing(w, d, ROSETTE)), ...ringSegments(lobedRing(w, d, ROSETTE_HEART))],
    detail: ringSegments(lobedRing(w, d, ROSETTE_MIDDLE)),
  };
}

export const PLANTS: SymbolTable = new Map<string, SymbolOf>([
  ["plant.standard", (w, d) => plant(w, d)],
  ["palm.standard", (w, d) => palm(w, d)],
  ["fern.standard", (w, d) => fern(w, d)],
  ["rosette.standard", (w, d) => rosette(w, d)],
]);

/**
 * What a plant fills at rest, in place of its round shape, with no outline of that shape: its canopy, so its lines read on
 * any floor. Selected, ghosted or refused it fills its round ring, which is also what it fits by. A fact of the drawing, so
 * it lives with the symbols and not in the domain's kinds.
 */
export const CANOPIES: ReadonlyMap<string, (w: number, d: number) => Point[]> = new Map<string, (w: number, d: number) => Point[]>([
  ["plant", (w, d) => lobedRing(w, d, PLANT)],
  ["palm", (w, d) => lobedRing(w, d, PALM)],
  ["fern", (w, d) => lobedRing(w, d, FERN)],
  ["rosette", (w, d) => lobedRing(w, d, ROSETTE)],
]);
