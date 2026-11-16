import { SPIRAL_COLUMN_RADIUS, spiralLanding, spiralTreads, type StairGeometry, type StairRule } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { guardBoxes, PANE_THICK, POST_SIDE, postRing, RAIL_THICK } from "./guard-faces";
import { topAt } from "./handrail-faces";
import { placer } from "./local-frame";
import { prism } from "./prism";
import { slab } from "./slab";
import type { Shades } from "./style";
import { stepsFrom, type Face3d, type PieceItem } from "./types";

// A spiral in the 3D view (stairs.21, step 14): thin wedge treads round a 12-sided column, the top landing's slab
// (edge-catch.06), its rail on posts and the balustrade (AC-12), one owner, in any order: the depth buffer hides what is
// behind (real3d.09). The domain says where the rails go and which they are (`spiralRails`), and they take a guard's sizes in
// the stair's colours; a Glass one's panes, under the rail with no posts, take `glass` (guards.28).

const TREAD = 0.04; // m: a wedge's thickness
const COLUMN_SIDES = 12;
const ARC_STEP = 7.5; // degrees between a wedge's points along its arcs
const DEG = Math.PI / 180;

/**
 * The faces of a spiral with geometry `g`, centred on the item's centre: tread k's top at k risers above where its
 * steps begin, on a column from its bottom to its top, and the landing one tread thick under its top.
 */
export function spiralFaces(owner: string, item: PieceItem, shades: Shades, rule: StairRule, g: StairGeometry, glass: string): Face3d[] {
  const c = item.centre;
  const r = Math.min(item.w, item.d) / 2; // the box is square (stairs.21); one stored off square keeps it inside
  const rc = Math.min(SPIRAL_COLUMN_RADIUS, r / 2);
  const at = (radius: number, deg: number): Point => ({ x: c.x + radius * Math.cos(deg * DEG), y: c.y + radius * Math.sin(deg * DEG) });
  const wedge = (from: number, to: number, top: number): Face3d[] => {
    const n = Math.max(1, Math.ceil((to - from) / ARC_STEP));
    const outer = Array.from({ length: n + 1 }, (_, i) => at(r, from + ((to - from) * i) / n));
    const inner = Array.from({ length: n + 1 }, (_, i) => at(rc, to - ((to - from) * i) / n));
    return prism(owner, [...outer, ...inner], top - TREAD, top, shades);
  };
  const treads = spiralTreads(rule, g.treads).flatMap((t, i) => wedge(t.from + item.rotation, t.to + item.rotation, stepsFrom(item) + (i + 1) * g.riser)); // footprint angles turned with the piece
  const column = prism(owner, Array.from({ length: COLUMN_SIDES }, (_, i) => at(rc, (360 * i) / COLUMN_SIDES)), item.bottom, item.top, shades);
  const ring = spiralLanding(item.w, item.d).map((q) => placer(item)(q.x, q.y));
  const landing = prism(owner, ring, item.top - TREAD, item.top, shades);
  return [...treads, ...column, ...landing, ...railFaces(owner, item, shades, rule, g, at, { top: glass, lit: glass, shaded: glass })];
}

/** A short straight piece of the balustrade, from `p` to `q`, `thick` across: from `low` to `high` at each end. */
function bar(owner: string, shades: Shades, p: Point, q: Point, low: readonly [number, number], high: readonly [number, number], thick: number): Face3d[] {
  const [dx, dy] = [q.x - p.x, q.y - p.y];
  const rotation = (Math.atan2(-dx, dy) * 180) / Math.PI; // a frame whose y runs from p to q
  const a = Math.hypot(dx, dy);
  const profile = [{ a: 0, z: low[0] }, { a, z: low[1] }, { a, z: high[1] }, { a: 0, z: high[0] }];
  return slab(owner, { rotation, d: 0 }, shades, placer({ centre: p, rotation }), profile, -thick / 2, thick / 2);
}

/**
 * The landing's rails and the balustrade: bars no longer than a wedge's arc steps, and a post on each tread and at each
 * end; a Glass one's landing rail as a deck's Glass guard, and its balustrade's panes from the treads' line, with no posts.
 */
function railFaces(owner: string, item: PieceItem, shades: Shades, rule: StairRule, g: StairGeometry, polar: (radius: number, deg: number) => Point, glass: Shades): Face3d[] {
  const rails = item.spiralRails;
  if (!rails) return [];
  const local = placer(item);
  const landing = rails.landing.flatMap((run) =>
    guardBoxes({ kind: rails.kind, a: local(run.a.x, run.a.y), b: local(run.b.x, run.b.y), bottom: run.bottom, top: run.top }).flatMap((b) => prism(owner, b.ring, b.bottom, b.top, b.pane ? glass : shades)));
  const { radius, start, knots } = rails;
  const on = (a: number): Point => polar(radius, start - a + item.rotation); // `a` is clockwise, from the first tread's low end
  const bars = knots.slice(1).flatMap((end, i) => {
    const begin = knots[i] ?? end;
    const n = Math.max(1, Math.ceil((end.a - begin.a) / ARC_STEP));
    const at = (j: number): number => begin.a + ((end.a - begin.a) * j) / n;
    const top = (j: number): number => begin.top + ((end.top - begin.top) * j) / n;
    const foot = (j: number): number => begin.foot + ((end.foot - begin.foot) * j) / n;
    return Array.from({ length: n }, (_, j) => {
      const [p, q] = [on(at(j)), on(at(j + 1))];
      const rail = bar(owner, shades, p, q, [top(j) - RAIL_THICK, top(j + 1) - RAIL_THICK], [top(j), top(j + 1)], RAIL_THICK);
      const under: readonly [number, number] = [Math.max(foot(j), top(j) - RAIL_THICK), Math.max(foot(j + 1), top(j + 1) - RAIL_THICK)]; // none under a rail the ceiling pressed down
      return rails.kind === "glass" ? [...rail, ...bar(owner, glass, p, q, [foot(j), foot(j + 1)], under, PANE_THICK)] : rail;
    }).flat();
  });
  if (rails.kind === "glass") return [...landing, ...bars];
  const treads = spiralTreads(rule, g.treads);
  const edge = (POST_SIDE / 2 / radius) * (180 / Math.PI); // the end posts' angle in from their tread's end, so they stand on it
  const stands = [
    ...treads.map((t, i) => ({ a: start - (t.from + t.to) / 2, tread: i })),
    { a: edge, tread: 0 },
    { a: (knots.at(-1)?.a ?? 0) - edge, tread: treads.length - 1 },
  ];
  const posts = stands.flatMap(({ a, tread }) => {
    const [foot, top] = [stepsFrom(item) + (tread + 1) * g.riser, topAt(knots, a) - RAIL_THICK / 2];
    return top > foot ? prism(owner, postRing(on(a)), foot, top, shades) : [];
  });
  return [...landing, ...bars, ...posts];
}
