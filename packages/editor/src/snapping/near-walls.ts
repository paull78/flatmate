import { cross, distanceToSegment, hiddenAt, isFloor, isFloorWall, pointInPolygon, segmentIntersection, sortedIds, sub, wallFrame, wallRange, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";

/** The rotation grip's near walls (spec: tools): those whose body lies this close to the footprint. */
const PARALLEL_SNAP_M = 0.15;

/**
 * Whether the snaps at `level` see wall `wallId` (spec "Placing at a level", levels.19): at the floor level every wall
 * on the floor, not one on a deck (a loft's wall stands above anything placed there, pillars.53); at an upper level
 * only a wall whose top is above the level (not "under" it, the domain's `hiddenAt`, as the plan draws it), so the
 * shell and the walls on the level's decks.
 */
export function wallSeenAt(doc: Document, wallId: string, level: Level): boolean {
  const w = doc.walls[wallId];
  if (isFloor(level)) return w !== undefined && isFloorWall(w);
  return !hiddenAt(wallRange(doc, wallId), level);
}

/**
 * A wall near a footprint: `distance` from the footprint to the wall body (−thickness/2 when the centre line crosses
 * the footprint or ends inside it), the wall's direction a→b in whole degrees in [0, 360), and its unit normal
 * pointing towards the footprint's centre.
 */
export type NearWall = { wallId: string; distance: number; angleDeg: number; away: Point };

/** The walls whose body lies within `reach` of the footprint `quad` centred on `centre`, nearest first, ties by wall id. */
export function nearWalls(doc: Document, quad: readonly Point[], centre: Point, reach = PARALLEL_SNAP_M): NearWall[] {
  const out: NearWall[] = [];
  for (const id of sortedIds(doc.walls)) {
    const f = wallFrame(doc, id);
    if (!f) continue;
    const { a, b, dir, left: away } = f;
    const distance = quadToSegment(quad, a, b) - f.half;
    if (distance > reach) continue;
    const side = Math.sign(cross(dir, sub(centre, a))) || 1;
    const angle = Math.round((Math.atan2(dir.y, dir.x) * 180) / Math.PI);
    // `+ 0` turns −0 into 0.
    out.push({ wallId: id, distance, angleDeg: (((angle % 360) + 360) % 360) + 0, away: { x: away.x * side + 0, y: away.y * side + 0 } });
  }
  // Array sort is stable, so equal distances keep the sortedIds order.
  return out.sort((p, q) => p.distance - q.distance);
}

/**
 * The distance between a footprint quad and a wall's centre line: 0 when the line crosses the quad or ends inside it,
 * so a footprint pushed across a wall still counts as at that wall.
 */
function quadToSegment(quad: readonly Point[], a: Point, b: Point): number {
  if (pointInPolygon(a, quad) || pointInPolygon(b, quad)) return 0;
  let best = Infinity;
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % quad.length];
    if (!p || !q) continue;
    if (segmentIntersection(p, q, a, b).kind !== "none") return 0;
    best = Math.min(best, distanceToSegment(p, a, b), distanceToSegment(a, p, q), distanceToSegment(b, p, q));
  }
  return best;
}
