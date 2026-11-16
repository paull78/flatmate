import { orient, prism, sideShade } from "./prism";
import type { Finish } from "@fm/domain";
import { finishShades, type Shades, type Style3d } from "./style";
import { sidePattern, type SideFrame, type SideRegion } from "./wall-pattern";
import { withPattern } from "./pattern-faces";
import type { Face3d, Opening3d, Point3, WallItem } from "./types";
import { keptSpan, wallAxes } from "./wall-spans";

// A wall with doors and windows in the 3D view (heights.69, .71), one solid wound from outside (real3d.09).
//
// Along the wall (s) and up (z) the wall is a grid: columns cut at every opening's ends, bands cut at every sill,
// head and the wall's bottom and top. A cell is wall where no opening covers it, so touching openings, a door at a
// free end and a sill between two doors all fall out of one rule:
//
//    top  ┌────┬────┬─────┬────┐
//         │ ■  │ ■  │  ■  │ ■  │
//   head  ├────┼────┼─────┼────┤
//         │ ■  │door│ win │ ■  │
//   sill  ├────┼────┼─────┼────┤
//         │ ■  │    │  ■  │ ■  │
//  floor  └────┴────┴─────┴────┘
//
// The long sides are the traced boundaries of their wall cells (outer rings and holes); where two neighbouring columns
// differ, the difference is a jamb or an end; where wall lies under a gap, a sill; under a door, a floor-coloured
// threshold. Openings are kept to the wall's clear span (where both long sides run), so none reaches into a corner.

const EPS = 1e-9;

export type Span = { lo: number; hi: number; bottom: number; top: number; glass: boolean; floor: Opening3d["floor"] };
/** A cell coordinate pair (column index, band index), or a point in the (s, z) frame. */
export type Pair = [number, number];

export const uniqueSorted = (vs: readonly number[]): number[] =>
  [...vs].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - (all[i - 1] ?? v) > EPS);

/** Whether wall material fills (s, z): inside the face and outside every opening's span there. */
export function solidAt(spans: readonly Span[], s: number, z: number): boolean {
  return !spans.some((o) => s > o.lo && s < o.hi && z > o.bottom && z < o.top);
}

/** Even-odd containment in the (s, z) frame. */
function inside(ring: readonly Pair[], p: Pair): boolean {
  let hit = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) hit = !hit;
  });
  return hit;
}

const area = (ring: readonly Pair[]): number => ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length] ?? a;
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;

/**
 * The wall cells of the grid `xs` × `zs` as polygons with holes, in the (s, z) frame: boundary edges are taken with
 * the wall on their left and chained into loops (outer rings counter-clockwise, holes clockwise), each hole then
 * given to the outer ring around it. Collinear points are dropped.
 */
export function traceCells(xs: readonly number[], zs: readonly number[], solid: (i: number, j: number) => boolean): { ring: Pair[]; holes: Pair[][] }[] {
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  const cell = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < nz && solid(i, j);
  const next = new Map<string, Pair[]>();
  const add = (from: Pair, to: Pair): void => {
    const key = `${from[0]},${from[1]}`;
    next.set(key, [...(next.get(key) ?? []), to]);
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!cell(i, j)) continue;
      if (!cell(i, j - 1)) add([i, j], [i + 1, j]);
      if (!cell(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!cell(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!cell(i - 1, j)) add([i, j + 1], [i, j]);
    }
  }
  const loops: Pair[][] = [];
  for (const [startKey] of next) {
    while ((next.get(startKey) ?? []).length > 0) {
      const [sx, sz] = startKey.split(",").map(Number);
      const loop: Pair[] = [[sx ?? 0, sz ?? 0]];
      let at: Pair = [sx ?? 0, sz ?? 0];
      let dir: Pair = [0, 0];
      for (;;) {
        const key = `${at[0]},${at[1]}`;
        const outs = next.get(key) ?? [];
        if (outs.length === 0) break;
        // Where two loops pinch at a corner, turn left first, so each loop keeps its own cells.
        const turn = (to: Pair): number => {
          const d: Pair = [to[0] - at[0], to[1] - at[1]];
          const cross = dir[0] * d[1] - dir[1] * d[0];
          const dot = dir[0] * d[0] + dir[1] * d[1];
          return cross > 0 ? 0 : dot > 0 ? 1 : 2;
        };
        const to = [...outs].sort((a, b) => turn(a) - turn(b))[0] ?? outs[0];
        if (to === undefined) break;
        next.set(key, outs.filter((o) => o !== to));
        dir = [to[0] - at[0], to[1] - at[1]];
        at = to;
        if (at[0] === loop[0]?.[0] && at[1] === loop[0]?.[1]) break;
        loop.push(at);
      }
      const real = loop.map(([i, j]): Pair => [xs[i] ?? 0, zs[j] ?? 0]);
      const kept = real.filter((p, k) => {
        const a = real[(k + real.length - 1) % real.length] ?? p;
        const b = real[(k + 1) % real.length] ?? p;
        return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > EPS;
      });
      if (kept.length >= 3) loops.push(kept);
    }
  }
  const outers = loops.filter((l) => area(l) > 0).map((ring): { ring: Pair[]; holes: Pair[][] } => ({ ring, holes: [] }));
  for (const hole of loops.filter((l) => area(l) < 0)) {
    const [a, b] = [hole[0], hole[1]];
    if (!a || !b) continue;
    // A point just inside the hole: right of its first edge (holes run clockwise, the void on their right).
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const probe: Pair = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * 1e-6, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * 1e-6];
    outers.find((o) => inside(o.ring, probe))?.holes.push(hole);
  }
  return outers;
}

/** A band of a long side, from `lo` to `hi`, in one finish (null: the wall's grey). */
type Band = { lo: number; hi: number; finish: Finish | null };

/**
 * The bands of the long side whose outward normal is `n` (surfaces steps 03, 07): by which side of the wall it is on
 * (`item.left`), its lower band up to its height above the side's bottom and its finish above; one band without a lower
 * band, or when the side is no taller than the height (the lower finish covers it all).
 */
export function sideBands(item: WallItem, n: { x: number; y: number }): Band[] {
  const side = item.sides?.[n.x * item.left.x + n.y * item.left.y > 0 ? "left" : "right"] ?? null;
  const [bottom, top] = [item.bottom, item.top];
  if (!side?.lower) return [{ lo: bottom, hi: top, finish: side?.finish ?? null }];
  const cut = bottom + side.lower.height;
  if (cut >= top - EPS) return [{ lo: bottom, hi: top, finish: side.lower.finish }];
  return [{ lo: bottom, hi: cut, finish: side.lower.finish }, { lo: cut, hi: top, finish: side.finish }];
}

const bandShades = (band: Band, style: Style3d): Shades => (band.finish ? finishShades(band.finish.colour) : style.wall);
const isShaded = (n: { x: number; y: number }): boolean => sideShade(n, { top: "", lit: "lit", shaded: "shaded" }) === "shaded";

/** Whether `n` is a long side's normal: across the wall, parallel to its left normal. */
const isLongSide = (item: WallItem, n: { x: number; y: number }): boolean => Math.abs(n.x * item.left.x + n.y * item.left.y) > 1 - 1e-6;

/** One band of a side as its face (`points` in the world, wound from outside) with its pattern's lines and shapes. */
function bandFaces(owner: string, item: WallItem, face: Face3d, band: Band, frame: SideFrame, region: SideRegion, style: Style3d): Face3d[] {
  if (!band.finish) return [face];
  const { lines, shapes } = sidePattern(owner, frame, region, band.finish, item.planes, isShaded(frame.n), style.patternLift);
  return [lines.length > 0 ? { ...face, lines } : face, ...shapes];
}

/** A plain wall's prism with its long sides in their bands and finishes; the ends and the top keep the grey. */
function finishedPrism(owner: string, item: WallItem, style: Style3d): Face3d[] {
  return prism(owner, item.outline, item.bottom, item.top, style.wall).flatMap((f): Face3d[] => {
    const [p, q] = [f.points[0], f.points[1]];
    if (!item.sides || !p || !q || f.points.length !== 4 || p.z !== q.z) return [f]; // the top, or no finishes
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < EPS) return [f];
    const n = { x: (q.y - p.y) / len, y: -(q.x - p.x) / len }; // prism winds its sides counter-clockwise from outside
    if (!isLongSide(item, n)) return [f];
    const frame: SideFrame = { origin: p, along: { x: (q.x - p.x) / len, y: (q.y - p.y) / len }, n };
    return sideBands(item, n).flatMap((band) => {
      const quad = { ...f, points: [{ ...p, z: band.lo }, { ...q, z: band.lo }, { ...q, z: band.hi }, { ...p, z: band.hi }], color: sideShade(n, bandShades(band, style)) };
      return bandFaces(owner, item, quad, band, frame, { ring: [[0, band.lo], [len, band.lo], [len, band.hi], [0, band.hi]], holes: [] }, style);
    });
  });
}

/**
 * The faces of the wall `item` as a holed solid: inside it the sills and thresholds and the jambs; then the long sides,
 * in their finishes' bands with their patterns, the ends and the top. What stands in its openings is `opening-faces.ts`.
 * Every face wound from outside, in any order: the depth buffer hides what is behind (real3d.09).
 */
export function wallFaces(owner: string, item: WallItem, style: Style3d): Face3d[] {
  const axes = wallAxes(item);
  if (axes === null) return finishedPrism(owner, item, style);
  const { along, half, outline: r, sOf, dOf, at, c0, c1, solidBefore, solidAfter } = axes;
  const face = (points: Point3[], color: string, holes: Point3[][] = []): Face3d => ({ points, holes, color, owner });
  const [bottom, top] = [item.bottom, item.top];

  const spans: Span[] = item.openings
    .map((o) => ({ ...keptSpan(axes, o), bottom: o.bottom, top: o.top, glass: o.glass, floor: o.floor }))
    .filter((o) => o.hi - o.lo > EPS);
  const zs = uniqueSorted([bottom, top, ...spans.flatMap((o) => [o.bottom, o.top])].filter((z) => z >= bottom - EPS && z <= top + EPS));
  const xs = uniqueSorted([c0, c1, ...spans.flatMap((o) => [o.lo, o.hi])]);
  const bandMid = (j: number): number => ((zs[j] ?? 0) + (zs[j + 1] ?? 0)) / 2;
  const columnMid = (i: number): number => ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) / 2;
  /** The span open from the wall's bottom at `s`, whose floor a threshold shows: a window stacked above it never is (sills.09). */
  const spanAt = (s: number): Span | undefined => spans.find((o) => s > o.lo && s < o.hi && o.bottom <= bottom + EPS);
  /** Wall in column `i` (−1 before the clear span, xs.length − 1 after it) and band `j`. */
  const solid = (i: number, j: number): boolean => {
    if (i < 0) return solidBefore;
    if (i >= xs.length - 1) return solidAfter;
    return solidAt(spans, columnMid(i), bandMid(j));
  };

  const flats: Face3d[] = [];
  const backs: Face3d[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const [lo, hi] = [xs[i] ?? 0, xs[i + 1] ?? 0];
    if (!solid(i, 0)) {
      // A door's threshold: its span's floor (thresholds.01), its pattern lifted as on floors; else the plain floor, or
      // on a wall standing on a deck (the only walls with a bottom above 0) the deck's top (sills.03).
      const floor = spanAt(columnMid(i))?.floor ?? null;
      const plain = bottom > EPS ? style.deck.top : style.floor;
      const threshold = face([at(lo, -half, bottom), at(hi, -half, bottom), at(hi, half, bottom), at(lo, half, bottom)], floor?.color ?? plain);
      flats.push(...(floor ? withPattern(threshold, floor, bottom + style.patternLift) : [threshold]));
    }
    for (let j = 1; j < zs.length - 1; j++) {
      const z = zs[j] ?? 0;
      if (solid(i, j - 1) && !solid(i, j)) flats.push(face([at(lo, -half, z), at(hi, -half, z), at(hi, half, z), at(lo, half, z)], style.wall.lit));
    }
  }
  // Jambs and ends: at each column edge, the wall on one side facing the gap on the other, merged over bands.
  for (let i = 0; i < xs.length; i++) {
    const s = xs[i] ?? 0;
    for (const [n, wallSide, gapSide] of [[along, i - 1, i], [{ x: -along.x, y: -along.y }, i, i - 1]] as const) {
      for (let j = 0; j < zs.length - 1; j++) {
        if (!solid(wallSide, j) || solid(gapSide, j) || (j > 0 && solid(wallSide, j - 1) && !solid(gapSide, j - 1))) continue;
        let k = j;
        while (k + 1 < zs.length - 1 && solid(wallSide, k + 1) && !solid(gapSide, k + 1)) k++;
        const [z0, z1] = [zs[j] ?? 0, zs[k + 1] ?? 0];
        const quad = (d0: number, d1: number): Point3[] => orient([at(s, d0, z0), at(s, d1, z0), at(s, d1, z1), at(s, d0, z1)], { ...n, z: 0 });
        backs.push(face(quad(-half, half), sideShade(n, style.wall)));
      }
    }
  }

  // The sides: along the wall, the traced wall cells; across it, the outline's own ends, except a free end at the
  // clear span, which the jambs above already drew from its column.
  const sides: Face3d[] = [];
  r.forEach((a, i) => {
    const b = r[(i + 1) % r.length] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < EPS) return;
    const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }; // outward for a counter-clockwise ring
    const parallel = Math.abs((b.x - a.x) * along.y - (b.y - a.y) * along.x) < EPS * len;
    if (!parallel) {
      const atEnd = (c: number, open: boolean) => open && Math.abs(sOf(a) - c) < 1e-6 && Math.abs(sOf(b) - c) < 1e-6;
      if (atEnd(c0, !solidBefore) || atEnd(c1, !solidAfter)) return;
      sides.push(face([{ ...a, z: bottom }, { ...b, z: bottom }, { ...b, z: top }, { ...a, z: top }], sideShade(n, style.wall)));
      return;
    }
    const d = dOf(a);
    const [lo, hi] = [Math.min(sOf(a), sOf(b)), Math.max(sOf(a), sOf(b))];
    const fx = uniqueSorted([lo, hi, ...spans.flatMap((o) => [o.lo, o.hi]).filter((s) => s > lo + EPS && s < hi - EPS)]);
    const mid = (k: number) => ((fx[k] ?? 0) + (fx[k + 1] ?? 0)) / 2;
    // traceCells winds its rings counter-clockwise in (s, z), which faces −left: the side on the left is reversed.
    const toWorld = (ring: readonly Pair[]): Point3[] => (d > 0 ? [...ring].reverse() : ring).map(([s, z]) => at(s, d, z));
    const origin = at(0, d, 0);
    const frame: SideFrame = { origin: { x: origin.x, y: origin.y }, along, n };
    // Each band of the side (surfaces step 07) traced on its own: the grid gains the band's cut.
    const bands = sideBands(item, n);
    const zsSide = uniqueSorted([...zs, ...bands.map((band) => band.hi)].filter((z) => z >= bottom - EPS && z <= top + EPS));
    const midOf = (j: number): number => ((zsSide[j] ?? 0) + (zsSide[j + 1] ?? 0)) / 2;
    for (const band of bands) {
      const color = sideShade(n, bandShades(band, style));
      const inBand = (j: number): boolean => midOf(j) > band.lo && midOf(j) < band.hi;
      for (const poly of traceCells(fx, zsSide, (k, j) => inBand(j) && solidAt(spans, mid(k), midOf(j)))) {
        sides.push(...bandFaces(owner, item, face(toWorld(poly.ring), color, poly.holes.map(toWorld)), band, frame, poly, style));
      }
    }
  });
  return [...flats, ...backs, ...sides, face(r.map((p) => ({ ...p, z: top })), style.wall.top)];
}
