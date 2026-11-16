import type { Point } from "@fm/protocol";
import { distance, normalize, perpLeft, sub } from "./geometry";
import type { Document } from "./model";
import { isValidId } from "./shape";

/** IDs of a table in lexicographic (UTF-16 code unit) order: the order normalisation inspects entities. */
export function sortedIds<T>(table: Record<string, T>): string[] {
  return Object.keys(table).sort();
}

/** Walls using the joint, sorted by ID. */
export function incidentWalls(doc: Document, jointId: string): string[] {
  return sortedIds(doc.walls).filter((id) => {
    const w = doc.walls[id];
    return w !== undefined && (w.a === jointId || w.b === jointId);
  });
}

/** Joint ID → incident wall IDs (sorted), for every joint that has walls. */
export function jointWalls(doc: Document): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (!w) continue;
    for (const j of [w.a, w.b]) map.set(j, [...(map.get(j) ?? []), id]);
  }
  return map;
}

/** A joint's position, or null when it is missing. IDs outside I8 (e.g. "constructor") are never found. */
export function jointPoint(doc: Document, id: string): Point | null {
  const j = isValidId(id) ? doc.joints[id] : undefined;
  return j ? { x: j.x, y: j.y } : null;
}

/** The two endpoint positions of a wall, or null when the wall or a joint is missing (IDs as in jointPoint). */
export function wallEnds(doc: Document, wallId: string): { a: Point; b: Point } | null {
  const w = isValidId(wallId) ? doc.walls[wallId] : undefined;
  if (!w) return null;
  const a = jointPoint(doc, w.a);
  const b = jointPoint(doc, w.b);
  return a && b ? { a, b } : null;
}

/** A wall's frame: its ends, the unit direction a → b, that direction's left normal, half its thickness and its length. */
export type WallFrame = { a: Point; b: Point; dir: Point; left: Point; half: number; length: number };

/** The wall's frame, or null when the wall or a joint is missing (as in wallEnds) or the wall is under 1e-12 m long. */
export function wallFrame(doc: Document, wallId: string): WallFrame | null {
  const ends = wallEnds(doc, wallId);
  const w = doc.walls[wallId];
  const dir = ends ? normalize(sub(ends.b, ends.a)) : null;
  return w && ends && dir ? { a: ends.a, b: ends.b, dir, left: perpLeft(dir), half: w.thickness / 2, length: distance(ends.a, ends.b) } : null;
}
