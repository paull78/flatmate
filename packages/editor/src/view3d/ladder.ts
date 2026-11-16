import type { StairGeometry } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { RAIL_INSET } from "../view/stair-lines";
import { prism } from "./prism";
import { slab, type Local } from "./slab";
import type { Shades } from "./style";
import { stepsFrom, type Face3d, type PieceItem } from "./types";

// A rung ladder in the 3D view (stairs step 12): two rails, thin sloped slabs centred on the plan's rail lines, from the
// floor (or the deck it starts at, stairs.49) at the front edge up the pitch line to the back edge, then straight up
// to 0.9 above its top, the deck it reaches, as a handhold (stairs.14): faces only, the fit keeps the ladder's box. The
// handhold rises inside the box's footprint, not along the slope, which would pass through the deck's slab, or a wall
// behind it. Rungs across between the rails, their tops on the pitch line. Faces in any order (real3d.09).

/** How far the rails rise above the ladder's top (stairs.14). */
export const HANDHOLD = 0.9;
/** A hooked ladder's strap (steps.05): over the slab this far past the back edge, this thick, this far proud of the deck. */
const HOOK_REACH = 0.08;
const HOOK_THICK = 0.025;
const HOOK_PROUD = 0.002;
const RAIL_WIDTH = 0.04; // m: across the ladder
const RAIL_DEPTH = 0.06; // m: square to its slope
const RUNG = 0.03; // m: a rung's side

/** The faces of a rung ladder with geometry `g`; `at` places a local point (x across, y along the run from −d/2). */
export function ladderFaces(owner: string, item: PieceItem, shades: Shades, g: StairGeometry, at: (x: number, y: number) => Point, hooks = false): Face3d[] {
  const rail = item.w / 2 - RAIL_INSET;
  const inner = rail - RAIL_WIDTH / 2;
  // A rail in the plane of the run, in two convex parts split at a = d − thick: the flight, from the floor at the front
  // edge up behind the pitch line, then the post, its last stretch and the handhold straight up from the back edge.
  const slope = g.riser / g.going;
  const thick = Math.min(g.run / 2, RAIL_DEPTH * Math.hypot(1, 1 / slope)); // its depth measured along the run
  const split = g.run - thick;
  const base = stepsFrom(item);
  const z = (a: number): number => base + a * slope;
  const flight: Local[] = [{ a: 0, z: base }, { a: thick, z: base }, { a: split, z: z(split - thick) }, { a: split, z: z(split) }];
  // With hooks (steps.05) the rail stops at the deck's top and a strap bends over its edge, a hair proud of the slab;
  // else the post rises as a handhold.
  const postTop = hooks ? item.top + HOOK_PROUD : item.top + HANDHOLD;
  const post: Local[] = [{ a: split, z: z(split - thick) }, { a: g.run, z: z(split) }, { a: g.run, z: postTop }, { a: split, z: postTop }];
  const strap: Local[] = [{ a: split, z: postTop }, { a: g.run + HOOK_REACH, z: postTop }, { a: g.run + HOOK_REACH, z: postTop + HOOK_THICK }, { a: split, z: postTop + HOOK_THICK }];
  const profiles = hooks ? [flight, post, strap] : [flight, post];
  const side = (sign: number): Face3d[] => profiles.flatMap((profile) => slab(owner, item, shades, at, profile, sign * rail - RAIL_WIDTH / 2, sign * rail + RAIL_WIDTH / 2));
  const rungs: Face3d[] = [];
  for (let k = 1; k <= g.treads; k++) {
    const [y0, y1] = [-item.d / 2 + k * g.going, -item.d / 2 + k * g.going + RUNG];
    const top = base + k * g.riser;
    rungs.push(...prism(owner, [at(-inner, y0), at(inner, y0), at(inner, y1), at(-inner, y1)], top - RUNG, top, shades));
  }
  return [...side(-1), ...rungs, ...side(1)];
}
