import type { Handrail, RailKnot, StairGeometry } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { PANE_THICK, POST_SIDE, RAIL_THICK } from "./guard-faces";
import { slab, type Local } from "./slab";
import type { Shades } from "./style";
import { stepsFrom, type Face3d, type PieceItem } from "./types";

// A flight's handrail in 3D (AC-11): a rail sloped with the pitch line, on a post at each end, a guard's sizes in the stair's
// own colours. A Glass one (guards.28) has no posts: an opaque pane in the windows' glass fills from the pitch line up to
// under the rail, as a deck's Glass guard does. Part of the stair's faces, so it's in a section by itself. The domain says
// where and which (`flightHandrails`).

/** A rail's top at `a` along it, between its knots. */
export function topAt(knots: readonly RailKnot[], a: number): number {
  const after = knots.findIndex((k) => k.a >= a);
  const [p, q] = [knots[after - 1], knots[after]];
  if (!p || !q) return q?.top ?? 0; // at the first knot
  return p.top + ((q.top - p.top) * (a - p.a)) / (q.a - p.a);
}

/** The top of the tread `a` metres up the run: what a post stands on, the pitch line running above it between nosings. */
const treadTop = (item: PieceItem, g: StairGeometry, a: number): number => {
  let k = 1; // the last tread whose nosing lies at or before `a`, by the geometry (steps.09)
  while (k < g.treads && g.nosingAt(k + 1) <= a + 1e-9) k++;
  return stepsFrom(item) + k * g.riser;
};

/** The profile of a post from `a0` to `a1`, from the lower tread up into the rail, its top sloped with it. */
function postProfile(item: PieceItem, g: StairGeometry, knots: readonly RailKnot[], a0: number, a1: number): Local[] {
  const foot = treadTop(item, g, a0);
  return [{ a: a0, z: foot }, { a: a1, z: foot }, { a: a1, z: topAt(knots, a1) - RAIL_THICK / 2 }, { a: a0, z: topAt(knots, a0) - RAIL_THICK / 2 }];
}

/** Each stretch between knots: from `bottom` to `top` at each end, as a profile, dropping one with no height. */
function between(knots: readonly RailKnot[], bottom: (k: RailKnot) => number, top: (k: RailKnot) => number): Local[][] {
  return knots.slice(1).flatMap((q, i): Local[][] => {
    const p = knots[i] ?? q;
    return top(p) > bottom(p) || top(q) > bottom(q) ? [[{ a: p.a, z: bottom(p) }, { a: q.a, z: bottom(q) }, { a: q.a, z: top(q) }, { a: p.a, z: top(p) }]] : [];
  });
}

/** One stretch's rail, bending at its knots, on its two posts kept within the stretch, or a Glass one's over its pane. */
function railFaces(owner: string, item: PieceItem, shades: Shades, g: StairGeometry, at: (x: number, y: number) => Point, rail: Handrail, glass: Shades): Face3d[] {
  const [x0, x1] = [rail.x - RAIL_THICK / 2, rail.x + RAIL_THICK / 2];
  const { knots } = rail;
  const [first, last] = [knots[0]?.a ?? 0, knots.at(-1)?.a ?? 0];
  const bars = between(knots, (k) => k.top - RAIL_THICK, (k) => k.top).flatMap((profile) => slab(owner, item, shades, at, profile, x0, x1));
  if (rail.kind === "glass") {
    const panes = between(knots, (k) => k.foot, (k) => Math.max(k.foot, k.top - RAIL_THICK)); // none under a rail the ceiling pressed down
    return [...bars, ...panes.flatMap((profile) => slab(owner, item, glass, at, profile, rail.x - PANE_THICK / 2, rail.x + PANE_THICK / 2))];
  }
  const posts = [postProfile(item, g, knots, first, Math.min(last, first + POST_SIDE)), postProfile(item, g, knots, Math.max(first, last - POST_SIDE), last)];
  return [...bars, ...posts.flatMap((profile) => slab(owner, item, shades, at, profile, x0, x1))];
}

/** The handrails' faces of a stair `item` with geometry `g`, if it has any; `at` places a local point, `glass` colours a Glass one's panes. */
export function handrailFaces(owner: string, item: PieceItem, shades: Shades, g: StairGeometry, at: (x: number, y: number) => Point, glass: string): Face3d[] {
  const panes: Shades = { top: glass, lit: glass, shaded: glass };
  return (item.handrails ?? []).flatMap((rail) => railFaces(owner, item, shades, g, at, rail, panes));
}
