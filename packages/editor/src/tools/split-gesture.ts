import { add, distanceToSegment, dot, incidentWalls, isValidId, roundMm, scale, sortedIds, sub, wallFace, wallFrame, type Command, type Document } from "@fm/domain";
import type { EntityKey, Point } from "@fm/protocol";
import { roundTo } from "../snapping/policies";
import type { SnapResult } from "../types";

// The Split gesture (straight step 15, spec M2 "Split"): armed from a selected wall's Properties, a one-shot in Select.
// The pointer's projection on the wall shows a tick, snapped to the face's midpoint, to another joint's line (aligned)
// or to the snap step along the room-side face from its start; the clear distance from each end shows beside it; a
// click splits there, a typed value and Enter at that distance; Esc clears the value, then cancels. Pure: the Select
// tool holds the state and runs the command.

/** The pointer counts as on the wall within this many px of its centreline; farther, the tick hides and a click cancels. */
export const SPLIT_REACH_PX = 30;

export type SplitTick = { offset: number; point: Point; snap: SnapResult };

/** The wall's room-side face: where it starts and ends along a → b, in metres from joint a. */
export function splitFace(doc: Document, wallId: string): { start: number; end: number } | null {
  const face = wallFace(doc, wallId);
  return face ? { start: face.faceStart, end: face.faceEnd } : null;
}

/**
 * Where a split at `world` would land: the pointer projected on the wall, as an offset along the room face from its
 * start, snapped to the face's midpoint, to another joint's x or y (aligned), or to `step`; null when the pointer is
 * farther than SPLIT_REACH_PX from the wall or the wall is gone. `tolerance` and `reach` are in metres.
 */
export function splitTickAt(doc: Document, wallId: string, world: Point, step: number, tolerance: number, reach: number): SplitTick | null {
  const f = isValidId(wallId) ? wallFrame(doc, wallId) : null;
  const face = f ? splitFace(doc, wallId) : null;
  if (!f || !face || distanceToSegment(world, f.a, f.b) > reach) return null;
  const along = dot(sub(world, f.a), f.dir); // metres from joint a
  const at = (t: number): Point => add(f.a, scale(f.dir, t));
  const candidates: { t: number; snap: Omit<SnapResult, "point"> }[] = [];
  const middle = (face.start + face.end) / 2;
  if (Math.abs(along - middle) <= tolerance) candidates.push({ t: middle, snap: { kind: "midpoint" } });
  const w = doc.walls[wallId];
  const axis = Math.abs(f.dir.x) > Math.abs(f.dir.y) ? "x" : "y"; // the coordinate another joint lines up on
  for (const id of sortedIds(doc.joints)) {
    const j = doc.joints[id];
    if (!j || !w || id === w.a || id === w.b) continue;
    const t = dot(sub(j, f.a), f.dir); // where the joint's line crosses the wall (axis-aligned walls)
    const across = Math.abs(axis === "x" ? j.x - at(t).x : j.y - at(t).y);
    if (across < 1e-9 && Math.abs(t - along) <= tolerance && t > face.start && t < face.end) candidates.push({ t, snap: { kind: "aligned", guides: [{ x: j.x, y: j.y }] } });
  }
  const best = candidates.sort((p, q) => Math.abs(p.t - along) - Math.abs(q.t - along))[0];
  const snapped = best ?? { t: face.start + roundTo(along - face.start, step), snap: { kind: "grid" } };
  const t = Math.min(face.end, Math.max(face.start, snapped.t));
  return { offset: roundMm(t - face.start), point: at(t), snap: { ...snapped.snap, point: at(t) } };
}

/** The command a split at `offset` metres from the face's start sends. */
export function splitCommand(opId: string, wallId: string, offset: number): Command {
  return { type: "splitWall", opId, wallId, offset };
}

/** What a remote change cancels the gesture for: the wall, its joints and its openings. */
export function splitDependencies(doc: Document, wallId: string): EntityKey[] {
  const w = isValidId(wallId) ? doc.walls[wallId] : undefined;
  if (!w) return [{ table: "walls", id: wallId }];
  const openings = Object.values(doc.openings).filter((o) => o.wall === wallId).map((o): EntityKey => ({ table: "openings", id: o.id }));
  const neighbours = [...incidentWalls(doc, w.a), ...incidentWalls(doc, w.b)].map((id): EntityKey => ({ table: "walls", id }));
  return [{ table: "walls", id: wallId }, { table: "joints", id: w.a }, { table: "joints", id: w.b }, ...neighbours, ...openings];
}
