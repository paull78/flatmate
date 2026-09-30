import type { Point } from "@fm/protocol";
import { distance, distanceToSegment } from "../geometry";
import { sortedIds, wallEnds } from "../graph";
import { WALL_THICKNESS, type Document, type EntityRef } from "../model";

/**
 * Entities under a point: joints within `tolerance`, then walls whose body (centreline ± half the
 * thickness, plus tolerance) contains it; each group by distance, then ID. Distances within 1e-9 m
 * tie, so float noise cannot reorder equally near entities. Labels are hit-tested by the editor
 * because their size depends on text metrics.
 */
export function hitCandidates(doc: Document, p: Point, tolerance: number): EntityRef[] {
  const joints: { id: string; d: number }[] = [];
  for (const id of sortedIds(doc.joints)) {
    const j = doc.joints[id];
    const d = j ? distance(p, j) : Infinity;
    if (d <= tolerance) joints.push({ id, d });
  }
  const walls: { id: string; d: number }[] = [];
  for (const id of sortedIds(doc.walls)) {
    const ends = wallEnds(doc, id);
    const d = ends ? distanceToSegment(p, ends.a, ends.b) : Infinity;
    if (d <= tolerance + WALL_THICKNESS / 2) walls.push({ id, d });
  }
  const order = (x: { id: string; d: number }, y: { id: string; d: number }): number =>
    Math.abs(x.d - y.d) <= 1e-9 ? (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) : x.d - y.d;
  return [
    ...joints.sort(order).map((j): EntityRef => ({ table: "joints", id: j.id })),
    ...walls.sort(order).map((w): EntityRef => ({ table: "walls", id: w.id })),
  ];
}
