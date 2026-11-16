import type { Point } from "@fm/protocol";
import { clipHalfPlane, pointInPolygon, signedArea } from "../geometry";
import { wallFrame } from "../graph";
import { isWell } from "../kinds";
import { EPS, type Document } from "../model";
import { convexOverlap } from "../geometry";
import { fitParts, floorWallBodies, footprints, quadCentre } from "./footprints";
import { placementRange } from "./vertical";

// Wheel wells (trailer.07, .09, .13, .14): a well may run under walls, its centre in a room, and a taller piece may
// cover it. Its covered part is its rectangle cut by the inner face of each floor wall it overlaps, keeping its
// centre's side:
//
//   wall ════════╤══════════╤═══   outer half under the wall: cut off at the inner face
//                │░ covered ░│
//                └───────────┘
//
// Exact when a wall runs right across the well; where a partition ends inside one, the part beside its end is dropped
// too, so a slightly shorter piece covers it there.

/** How far inside a piece a well's covered part must lie, so edges on the same line (a bench against the wall) count. */
const INSIDE = 0.001;

/** The well's part outside the floor walls it overlaps, from its `ring` (a rectangle) and its `centre`. */
export function wellPart(doc: Document, ring: readonly Point[], centre: Point): readonly Point[] {
  let part: readonly Point[] = ring;
  for (const [id, body] of floorWallBodies(doc)) {
    if (!convexOverlap(ring, body)) continue;
    const f = wallFrame(doc, id);
    if (!f) continue;
    // The face on the centre's side, as a directed line with the centre on its left.
    const side = (centre.x - f.a.x) * f.left.x + (centre.y - f.a.y) * f.left.y >= 0 ? 1 : -1;
    const n = { x: f.left.x * side * f.half, y: f.left.y * side * f.half };
    const [a, b] = [{ x: f.a.x + n.x, y: f.a.y + n.y }, { x: f.b.x + n.x, y: f.b.y + n.y }];
    part = side === 1 ? clipHalfPlane(part, a, b) : clipHalfPlane(part, b, a);
  }
  return part;
}

/** Whether a piece's convex `ring` covers a well's `part`: every point of it inside, by INSIDE, the piece standing taller. */
export function covers(ring: readonly Point[], part: readonly Point[], pieceTop: number, wellTop: number): boolean {
  if (!(wellTop < pieceTop - EPS) || part.length < 3) return false;
  const c = { x: part.reduce((s, p) => s + p.x, 0) / part.length, y: part.reduce((s, p) => s + p.y, 0) / part.length };
  const pulled = part.map((p) => {
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const len = Math.hypot(dx, dy);
    return len > INSIDE ? { x: p.x + (dx / len) * INSIDE, y: p.y + (dy / len) * INSIDE } : p;
  });
  return pulled.every((p) => pointInPolygon(p, ring));
}

/** A placement's covered part when it is a well, else null. */
export function placementWellPart(doc: Document, placementId: string): readonly Point[] | null {
  const p = doc.placements[placementId];
  const quad = footprints(doc).get(placementId);
  const centre = quad ? quadCentre(quad) : null;
  if (!p || !quad || !centre || !isWell(doc.objects[p.object]?.kind ?? "")) return null;
  return wellPart(doc, quad, centre);
}

/** Whether another piece in the well's layout state covers its `part` (the free floor counts it once, trailer.11). */
export function coveredWell(doc: Document, wellId: string, part: readonly Point[]): boolean {
  const well = doc.placements[wellId];
  const top = placementRange(doc, wellId)?.top;
  if (!well || top === undefined) return false;
  const parts = fitParts(doc);
  return Object.values(doc.placements).some((q) => {
    const range = q.id === wellId || q.state !== well.state ? null : placementRange(doc, q.id);
    return range !== null && (parts.get(q.id) ?? []).some((ring) => covers(ring, part, range.top, top));
  });
}

/** The area of a well's covered part. */
export const partArea = (part: readonly Point[]): number => Math.abs(signedArea(part));
