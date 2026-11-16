import { add, distance, dot, normalize, perpLeft, pointInPolygon, scale, stairRuleOf, sub, type Section } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { PlanStyle } from "../view/plan-style";
import type { Primitive } from "../view/scene-types";
import { partSolids } from "./parts/solids";
import { STYLE_3D } from "./style";
import type { Item3d, PieceItem, Ring, WallItem } from "./types";
import { solidAt, traceCells, uniqueSorted, type Pair, type Span } from "./wall-faces";
import { roofBands, underCeilingLine, type SectionPlane } from "./section-roof";

// What the plane of a section passes through, as a picture in metres: x along the line, y up.
//
//   on the plan                     in the picture
//        seen ▲                       y ▲   ┌──┐
//             │                         │   │  │
//     origin ●━━━━━▶ dir                └───┴──┴──▶ x
//
// The viewer stands at the line and looks along `seen`, so x grows to their right and a flip mirrors the picture. A
// solid is a ring on the plan raised to a height range, so what the line keeps of its ring times that range is its cut.

const EPS = 1e-9;
/** m: how far off the line a point is tested: well above float noise, far below the stored millimetre. */
const HAIR = 1e-7;
/** m: the floor's and the ceiling's band, outside the real heights and graphics only (section.05). */
export const SECTION_BAND = 0.1;

/** The line from the viewer's point of view: `origin` is the end on their left. `side: 1` looks to the left of a → b. */
export type SectionFrame = { origin: Point; dir: Point; seen: Point; length: number };
type Side = 1 | -1;
/** A stretch of the line, from x `[0]` to x `[1]`. */
export type Interval = [number, number];
/** A rectangle in the picture. */
export type Rect = { lo: number; hi: number; bottom: number; top: number };
/** A solid's rectangle in the picture, less what its doors and windows take from it. */
type Body = Rect & { gaps: readonly Span[] };

export function sectionFrame(section: Section): SectionFrame {
  const [origin, end] = section.side === 1 ? [section.a, section.b] : [section.b, section.a];
  const dir = normalize(sub(end, origin)) ?? { x: 1, y: 0 }; // never used: a line has a length (I25)
  return { origin, dir, seen: perpLeft(dir), length: distance(origin, end) };
}

export const alongOf = (frame: SectionFrame, p: Point): number => dot(sub(p, frame.origin), frame.dir);
export const acrossOf = (frame: SectionFrame, p: Point): number => dot(sub(p, frame.origin), frame.seen);

/** The x of everywhere a ring's boundary meets the line: edges that cross it, and vertices on it. */
function meetings(frame: SectionFrame, ring: Ring): number[] {
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    const [dp, dq] = [acrossOf(frame, p), acrossOf(frame, q)];
    if (dp === 0) return [alongOf(frame, p)];
    if (dq === 0 || dp > 0 === dq > 0) return [];
    return [alongOf(frame, add(p, scale(sub(q, p), dp / (dp - dq))))];
  });
}

const inRings = (p: Point, [outer, ...holes]: readonly Ring[]): boolean =>
  outer !== undefined && pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));

/** The point at `x` on the line, a hair to one side of it: 1 toward what the section sees, −1 away. */
const beside = (frame: SectionFrame, x: number, side: Side): Point =>
  add(frame.origin, add(scale(frame.dir, x), scale(frame.seen, side * HAIR)));

/**
 * The stretches of the line `keep` holds, within its ends. The line is broken wherever a boundary meets it, and each piece
 * is in or out as a whole, so its middle decides. Touching pieces join, so a line through an inner corner stays one.
 */
function stretches(frame: SectionFrame, rings: readonly Ring[], keep: (x: number) => boolean): Interval[] {
  return runs(uniqueSorted([0, frame.length, ...rings.flatMap((r) => meetings(frame, r)).filter((x) => x > 0 && x < frame.length)]), keep);
}

/** The stretches between `stops`, in order, that `keep` holds at their middle. Those that touch join. */
export function runs(stops: readonly number[], keep: (x: number) => boolean): Interval[] {
  const out: Interval[] = [];
  stops.slice(1).forEach((hi, i) => {
    const lo = stops[i] ?? hi;
    if (!keep((lo + hi) / 2)) return;
    const last = out.at(-1);
    if (last !== undefined && last[1] === lo) last[1] = hi;
    else out.push([lo, hi]);
  });
  return out;
}

/** Where a hair to one `side` of the line lies in a ring with holes. */
const lineOn = (frame: SectionFrame, rings: readonly Ring[], side: Side): Interval[] => stretches(frame, rings, (x) => inRings(beside(frame, x, side), rings));

/**
 * Where the plane passes through a ring with holes: where it has material on both sides. A plane lying on a face doesn't,
 * whichever way float noise puts it.
 */
export const lineInside = (frame: SectionFrame, rings: readonly Ring[]): Interval[] =>
  stretches(frame, rings, (x) => inRings(beside(frame, x, 1), rings) && inRings(beside(frame, x, -1), rings));

/** The ring's part where `keep` is at least 0, a half plane (Sutherland–Hodgman), with `at` giving a point along an edge. */
export function clipBy<T>(ring: readonly T[], keep: (p: T) => number, at: (p: T, q: T, t: number) => T): T[] {
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    const [kp, kq] = [keep(p), keep(q)];
    return [...(kp >= 0 ? [p] : []), ...(kp >= 0 !== kq >= 0 ? [at(p, q, kp / (kp - kq))] : [])];
  });
}

/** A plan ring's part where `keep` is at least 0: the side of a far line or an end. */
export const clipRing = (ring: Ring, keep: (p: Point) => number): Point[] => clipBy(ring, keep, (p, q, t) => add(p, scale(sub(q, p), t)));

/** The strip the section sees, from the plane to its depth, between its ends, as half planes to clip by. */
export function stripSides(frame: SectionFrame, depth: number | null): ((p: Point) => number)[] {
  return [
    (p) => alongOf(frame, p),
    (p) => frame.length - alongOf(frame, p),
    (p) => acrossOf(frame, p),
    ...(depth === null ? [] : [(p: Point) => depth - acrossOf(frame, p)]),
  ];
}

/** Each door and window as the stretch of the line within its ends. */
function gapsOf(frame: SectionFrame, item: WallItem): Span[] {
  return item.openings.flatMap((o) => {
    const e = normalize(sub(o.end, o.start));
    if (e === null) return [];
    const [from, rate, length] = [dot(sub(frame.origin, o.start), e), dot(frame.dir, e), distance(o.start, o.end)];
    // Square across the wall, the line stays at one place along it: inside the opening or not, all the way.
    if (Math.abs(rate) <= EPS && (from <= 0 || from >= length)) return [];
    const [x0, x1] = Math.abs(rate) <= EPS ? [0, frame.length] : [-from / rate, (length - from) / rate];
    return [{ lo: Math.min(x0, x1), hi: Math.max(x0, x1), bottom: o.bottom, top: o.top, glass: o.glass, floor: o.floor }];
  });
}

/** A window's pane in the picture, where the plane passes through its wall. */
function panesOf(frame: SectionFrame, item: WallItem): Rect[] {
  const inWall = lineInside(frame, [item.outline]);
  return gapsOf(frame, item).filter((g) => g.glass).flatMap((g) => inWall.flatMap(([lo, hi]): Rect[] => {
    const [from, to] = [Math.max(lo, g.lo), Math.min(hi, g.hi)];
    return to - from > EPS ? [{ lo: from, hi: to, bottom: g.bottom, top: g.top }] : [];
  }));
}

/** The dark bodies an item has a hair to one side of the plane: a wall with the joint caps it carries, or a deck's slab. */
function bodiesOn(frame: SectionFrame, item: Item3d, side: Side): Body[] {
  const body = (bottom: number, top: number, gaps: readonly Span[]) => ([lo, hi]: Interval): Body => ({ lo, hi, bottom, top, gaps });
  switch (item.item) {
    case "wall":
      return [
        ...lineOn(frame, [item.outline], side).map(body(item.bottom, item.top, gapsOf(frame, item))),
        ...item.caps.flatMap((cap) => lineOn(frame, [cap.ring], side).map(body(cap.bottom, item.top, []))),
      ];
    case "deck":
      return item.fills.flatMap((f) => lineOn(frame, [f.ring, ...f.holes], side).map(body(item.bottom, item.top, [])));
    case "floor": // no thickness: its band is graphics
    case "piece": // light grey, on its own: pieceCut
    case "guard": // too thin to read as cut (guards.09)
      return [];
    default:
      return assertNever(item);
  }
}

/** A piece's parts the plane passes through. A stair isn't a block, and stays outlined. */
function pieceCut(frame: SectionFrame, item: PieceItem): Rect[] {
  if (stairRuleOf(item.objectKind)) return [];
  return partSolids(item.placement, item, STYLE_3D).flatMap((part) => lineInside(frame, [part.ring]).map(([lo, hi]): Rect => ({ lo, hi, bottom: part.bottom, top: part.top })));
}

const toPoint = ([x, y]: Pair): Point => ({ x, y });

/**
 * Dark bodies as one set of shapes: their edges make a grid, and a cell fills where bodies cover it on both sides of the
 * plane. Traced, bodies that touch become one polygon with no seam for antialiasing to show (heights.71). Both sides, not
 * each body alone, so a plane on the line where two walls meet cuts them, and a plane on a free face cuts nothing.
 *
 *     wall │ wall         a hair ahead: the right-hand wall
 *   ═══════╪═══════ plane
 *     wall │ wall         a hair behind: the left-hand wall     both sides have wall: it's cut
 */
function traced(ahead: readonly Body[], behind: readonly Body[], color: string): Primitive[] {
  const bodies = [...ahead, ...behind];
  const xs = uniqueSorted(bodies.flatMap((b) => [b.lo, b.hi, ...b.gaps.flatMap((g) => [g.lo, g.hi])]));
  const zs = uniqueSorted(bodies.flatMap((b) => [b.bottom, b.top, ...b.gaps.flatMap((g) => [g.bottom, g.top])]));
  const middle = (vs: readonly number[], i: number): number => ((vs[i] ?? 0) + (vs[i + 1] ?? 0)) / 2;
  const covers = (list: readonly Body[], x: number, z: number): boolean => list.some((b) => x > b.lo && x < b.hi && z > b.bottom && z < b.top && solidAt(b.gaps, x, z));
  const fills = (i: number, j: number): boolean => {
    const [x, z] = [middle(xs, i), middle(zs, j)];
    return covers(ahead, x, z) && covers(behind, x, z);
  };
  return traceCells(xs, zs, fills).map(({ ring, holes }): Primitive => ({ kind: "polygon", points: ring.map(toPoint), holes: holes.map((h) => h.map(toPoint)), color }));
}

/** A filled shape and its outline, which polygons don't have. */
export function outlinedShape(points: readonly Point[], fill: string, line: string, px: number): Primitive[] {
  return [
    { kind: "polygon", points, holes: [], color: fill },
    ...points.map((a, i): Primitive => ({ kind: "segment", a, b: points[(i + 1) % points.length] ?? a, width: { px }, color: line, cap: "round" })),
  ];
}

export const outlined = (r: Rect, fill: string, line: string, px: number): Primitive[] =>
  outlinedShape([{ x: r.lo, y: r.bottom }, { x: r.hi, y: r.bottom }, { x: r.hi, y: r.top }, { x: r.lo, y: r.top }], fill, line, px);

/** The cut, nearest of all: furniture, then panes, then walls, decks, columns and the two bands in one colour. */
export function sectionCut(frame: SectionFrame, items: readonly Item3d[], ceiling: number, style: PlanStyle, roof: SectionRoof | null = null): Primitive[] {
  const { cut, furniture, furnitureLine, furnitureWidth, pane, paneLine, paneWidth } = style.section;
  const across = (bottom: number, top: number): Body => ({ lo: 0, hi: frame.length, bottom, top, gaps: [] });
  // Under a slope the ceiling's band is the roof's, drawn apart, and the cut is clipped under the ceiling (roofs.14).
  const band = roof ? [] : [across(ceiling, ceiling + SECTION_BAND)];
  const bodies = (side: Side): Body[] => [across(-SECTION_BAND, 0), ...band, ...items.flatMap((item) => bodiesOn(frame, item, side))];
  const dark = traced(bodies(1), bodies(-1), cut);
  return [
    ...items.flatMap((item) => (item.item === "piece" ? pieceCut(frame, item) : [])).flatMap((r) => outlined(r, furniture, furnitureLine, furnitureWidth)),
    ...items.flatMap((item) => (item.item === "wall" ? panesOf(frame, item) : [])).flatMap((r) => outlined(r, pane, paneLine, paneWidth)),
    ...(roof ? [...dark.flatMap((d) => sloped(d, roof)), ...roofBands(roof.planes, roof.stretches, SECTION_BAND).map((points): Primitive => ({ kind: "polygon", points, holes: [], color: cut }))] : dark),
  ];
}

/** The ceiling's planes in the section's frame and the stretches of the line the roof covers (roofs.14). */
export type SectionRoof = { planes: readonly SectionPlane[]; stretches: readonly Interval[] };

/** A dark shape clipped under the sloped ceiling; its holes (openings) lie under it and stay. */
function sloped(p: Primitive, roof: SectionRoof): Primitive[] {
  if (p.kind !== "polygon") return [p];
  const points = underCeilingLine(p.points, roof.planes);
  return points.length >= 3 ? [{ ...p, points }] : [];
}
