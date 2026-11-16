import type { Point } from "@fm/protocol";
import { clipHalfPlane, cross, dot, sub } from "../geometry";
import { MIN_PASSAGE } from "../stairs";
import { isBeam, kindOf } from "../kinds";
import { memo } from "../memo";
import { EPS, type Document } from "../model";
import { placementRug, sizeOf } from "./footprints";
import { stairBase, stairGeometry } from "./stairs";
import { placementTuck, type TuckRole } from "./tucks";
import { placementWellPart } from "./wells";
import { placementRange, solids, type Range, type Solid } from "./vertical";

// The space under an open flight (stairs.03, .11): a stair whose rule has `underside` is solid only above its pitch line
// less the side boards' depth. A piece overlapping it on the plan clears it when its top is at or below that underside
// at the piece's lowest point over the flight (its end nearest the bottom step); every other stair stays its box.

/** How far the underside runs below the pitch line: the side boards' depth (stairs.03). */
export const UNDERSIDE_DEPTH = 0.23;
/** The side boards' thickness, drawn on the plan and in 3D; the fit keeps the flight's width. */
export const SIDE_BOARD = 0.04;

/**
 * A flight's underside: `foot` the middle of its front edge (the bottom step), `along` the unit direction up the run,
 * `half` its half width, `run` its length, `label` its kind's name in lower case for refusals, and `at(a)` the
 * underside's height `a` metres up the run.
 */
export type Underside = { foot: Point; along: Point; half: number; run: number; label: string; at: (a: number) => number };

/** A stair pose: its kind, back edge's middle `at`, rotation and size, as a placement or a candidate has them. */
export type StairPose = { kind: string; at: Point; rotation: number; w: number; d: number; riser: number | null };

/** The underside of a stair of `pose` whose steps begin at `base` and whose top is `top`, when its rule has one; else null. */
export function undersideAt(pose: StairPose, base: number, top: number): Underside | null {
  const kind = kindOf(pose.kind);
  if (!kind?.stair?.underside) return null;
  const g = stairGeometry(kind.stair, pose.w, pose.d, top - base, pose.riser); // the rise from where its steps begin (stairs.49)
  const r = (pose.rotation * Math.PI) / 180;
  const along = { x: -Math.sin(r), y: Math.cos(r) }; // the footprint's +y, front edge to back edge
  const foot = { x: pose.at.x - pose.d * along.x, y: pose.at.y - pose.d * along.y };
  return { foot, along, half: pose.w / 2, run: g.run, label: kind.label.toLowerCase(), at: (a) => base + g.pitch(a) - UNDERSIDE_DEPTH };
}

/** A placement's underside when its kind's stair rule has one (open stair, ship's ladder, alternating tread); else null. */
export function undersideOf(doc: Document, placementId: string): Underside | null {
  const p = doc.placements[placementId];
  const kind = p ? doc.objects[p.object]?.kind : undefined;
  const size = p ? sizeOf(doc, p) : null;
  const range = placementRange(doc, placementId);
  if (!p || kind === undefined || !size || !range) return null;
  return undersideAt({ kind, at: p.at, rotation: p.rotation, w: size.w, d: size.d, riser: p ? (doc.objects[p.object]?.riser ?? null) : null }, stairBase(doc, placementId) ?? range.bottom, range.top);
}

/**
 * The underside over a convex `ring` at the ring's lowest point within the flight's width, its run position kept within
 * the flight; Infinity when the ring lies wholly beside the flight.
 */
export function undersideOver(u: Underside, ring: readonly Point[]): number {
  // In the flight's frame: x up the run, y across it.
  const local = ring.map((q): Point => {
    const v = sub(q, u.foot);
    return { x: dot(v, u.along), y: cross(u.along, v) };
  });
  const below = clipHalfPlane(local, { x: 1, y: u.half }, { x: 0, y: u.half }); // y ≤ half
  const within = clipHalfPlane(below, { x: 0, y: -u.half }, { x: 1, y: -u.half }); // y ≥ −half
  if (within.length === 0) return Infinity;
  return u.at(Math.min(u.run, Math.max(0, Math.min(...within.map((q) => q.x)))));
}

/**
 * A flight's pitch line (riser.08): a flight kind is solid only under it, so whatever leaves room to get past above it
 * clears the flight, whatever it is. `at(a)` is the line's height `a` metres up the run: level before `risesFrom` (a
 * winder's front square, steps.09) and past the last nosing, `levelFrom` metres up; the geometry's knots say both. A rung ladder and a spiral have none: they stay their box (riser.04).
 */
export type PitchLine = { foot: Point; along: Point; half: number; run: number; risesFrom: number; levelFrom: number; at: (a: number) => number };

/** The pitch line of a stair of `pose` whose steps begin at `base` and whose top is `top`, for a flight kind; else null. */
export function pitchLineAt(pose: StairPose, base: number, top: number): PitchLine | null {
  const rule = kindOf(pose.kind)?.stair;
  if (rule?.shape !== "flight" && rule?.shape !== "winder") return null;
  const g = stairGeometry(rule, pose.w, pose.d, top - base, pose.riser);
  const r = (pose.rotation * Math.PI) / 180;
  const along = { x: -Math.sin(r), y: Math.cos(r) };
  const foot = { x: pose.at.x - pose.d * along.x, y: pose.at.y - pose.d * along.y };
  const first = g.knots[0]?.a ?? 0;
  const last = Math.max(first, g.knots[g.knots.length - 1]?.a ?? 0);
  return { foot, along, half: pose.w / 2, run: g.run, risesFrom: first, levelFrom: last, at: (a) => base + g.pitch(Math.min(last, Math.max(first, a))) };
}

/** A placement's pitch line, when its kind has one; else null. */
export function pitchLineOf(doc: Document, placementId: string): PitchLine | null {
  const p = doc.placements[placementId];
  const object = p ? doc.objects[p.object] : undefined;
  const size = p ? sizeOf(doc, p) : null;
  const range = placementRange(doc, placementId);
  if (!p || !object || !size || !range) return null;
  return pitchLineAt({ kind: object.kind, at: p.at, rotation: p.rotation, w: size.w, d: size.d, riser: object.riser ?? null }, stairBase(doc, placementId) ?? range.bottom, range.top);
}

/** The pitch line under a convex `ring` at the ring's highest point within the flight's width; −Infinity when it lies wholly beside the flight. */
function pitchUnder(line: PitchLine, ring: readonly Point[]): number {
  const local = ring.map((q): Point => {
    const v = sub(q, line.foot);
    return { x: dot(v, line.along), y: cross(line.along, v) };
  });
  const below = clipHalfPlane(local, { x: 1, y: line.half }, { x: 0, y: line.half });
  const within = clipHalfPlane(below, { x: 0, y: -line.half }, { x: 1, y: -line.half });
  if (within.length === 0) return -Infinity;
  return line.at(Math.max(...within.map((q) => q.x)));
}

/** Whether `other` leaves room to get past over `s`'s pitch line (riser.15), so the two don't collide wherever they overlap on the plan. */
export function clearsPitchLine(s: { pitch?: PitchLine | null }, other: { ring: readonly Point[]; range: Range }): boolean {
  return s.pitch !== undefined && s.pitch !== null && other.range.bottom >= pitchUnder(s.pitch, other.ring) + MIN_PASSAGE - EPS;
}

/** Something tested for a collision in height: its plan ring and range, and its underside if it is an open flight. */
export type UndersideSolid = { ring: readonly Point[]; range: Range; underside?: Underside | null };

/** Whether `other` lies wholly under `s`'s underside, so the two don't collide wherever they overlap on the plan. */
export function clearsUnderside(s: UndersideSolid, other: UndersideSolid): boolean {
  return s.underside !== undefined && s.underside !== null && other.range.top <= undersideOver(s.underside, other.ring) + EPS;
}

/** A solid as fit tests it: a placement's underside (null for any piece that isn't an open flight), tuck role, surface and whether it is a rug. */
export type FitSolid = Solid & { underside: Underside | null; pitch: PitchLine | null; tuck: TuckRole; surface?: string | null; rug?: boolean; well?: readonly Point[] | null; beam?: boolean };

/** The solids the fit tests, each placement with its underside, its role in the tuck rule, what it stands on and whether it is a rug. */
export const fitSolids = memo((doc: Document): readonly FitSolid[] =>
  solids(doc).map((s): FitSolid => {
    if (s.key.table !== "placements") return { ...s, underside: null, pitch: null, tuck: null };
    const id = s.key.id;
    return { ...s, underside: undersideOf(doc, id), pitch: pitchLineOf(doc, id), tuck: placementTuck(doc, id), surface: doc.placements[id]?.deck ?? null, rug: placementRug(doc, id), well: placementWellPart(doc, id), beam: isBeam(doc.objects[doc.placements[id]?.object ?? ""]?.kind ?? "") };
  }),
);
