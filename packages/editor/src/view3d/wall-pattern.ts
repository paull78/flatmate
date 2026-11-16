import type { Finish, Plane } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { finishGeometry, mixColour, patternShows } from "../view/finish/geometry";
import { clipRing, heightOn, mix2 } from "./ceiling-clip";
import { MIN_SPACING_3D } from "./pattern-faces";
import { orient } from "./prism";
import type { Face3d, Line3d, Point3 } from "./types";

// A wall side's pattern in 3D (surfaces step 07): the face's region in its own (s, z) frame, laid up from the floor's
// 0.00 and along from the side's left end as you face it, tiled by the floor's one tiler (finishes.13) and lifted 1 mm
// off the face, so the face never ties it (shown.06). Under a sloped ceiling the region is clipped before tiling, since
// lines aren't clipped with the faces (ceiling-clip.ts).
//
//        you, facing the side
//   left end ┌───────────────┐   u from the left end, v = z from 0.00
//            │ ▭▭▭▭▭▭▭▭▭▭▭▭▭ │
//            └───────────────┘

/** A long side in the world: `origin` + `along`·s on the face, `n` its outward normal (horizontal, unit). */
export type SideFrame = { origin: Point; along: Point; n: Point };
/** A region of the face in (s, z): an outer ring and holes (openings). */
export type SideRegion = { ring: readonly (readonly [number, number])[]; holes: readonly (readonly (readonly [number, number])[])[] };

/** The shaded side's ratio, as finishShades' (surfaces.19). */
const SHADED = 0.87;

/**
 * The pattern of `finish` on `region` of a side: its lines (for the face's `lines`) and its filled shapes as faces of
 * their own without outlines, in the finish's colours, shaded like the face when `shaded`. None when the pattern is finer
 * than the 3D limit (one for every surface, surfaces.12), too fine, or plain.
 */
export function sidePattern(owner: string, frame: SideFrame, region: SideRegion, finish: Finish, planes: readonly Plane[] | null, shaded: boolean, lift: number): { lines: Line3d[]; shapes: Face3d[] } {
  if (region.ring.length < 3) return { lines: [], shapes: [] };
  // u runs from the side's left end as you face it, toward your right: right = (−n.y, n.x).
  const sign = frame.along.x * -frame.n.y + frame.along.y * frame.n.x >= 0 ? 1 : -1;
  const ss = region.ring.map(([s]) => s);
  const s0 = sign > 0 ? Math.min(...ss) : Math.max(...ss);
  const toUV = ([s, z]: readonly [number, number]): Point => ({ x: sign * (s - s0), y: z });
  const sOf = (u: number): number => s0 + sign * u;
  const xyOf = (u: number): Point => ({ x: frame.origin.x + frame.along.x * sOf(u), y: frame.origin.y + frame.along.y * sOf(u) });
  let ring: Point[] = region.ring.map(toUV);
  for (const q of planes ?? []) ring = clipRing(ring, (p) => p.y - heightOn(q, xyOf(p.x)), mix2); // under the ceiling
  if (ring.length < 3) return { lines: [], shapes: [] };
  const g = finishGeometry(ring, region.holes.map((h) => h.map(toUV)), finish);
  if (g.tooFine || !patternShows(g, MIN_SPACING_3D)) return { lines: [], shapes: [] };
  const world = (p: Point): Point3 => {
    const xy = xyOf(p.x);
    return { x: xy.x + frame.n.x * lift, y: xy.y + frame.n.y * lift, z: p.y };
  };
  const tone = (c: string): string => (shaded ? mixColour(c, SHADED, 100) : c);
  const lines = g.lines.map((l): Line3d => ({ a: world(l.a), b: world(l.b), color: tone(l.color) }));
  const n3 = { x: frame.n.x, y: frame.n.y, z: 0 };
  const shapes = g.shapes.map((s): Face3d => ({ points: orient(s.points.map(world), n3), holes: s.holes.map((h) => h.map(world)), color: tone(s.color), owner, outline: false }));
  return { lines, shapes };
}
