import { distance } from "../geometry";
import { wallEnds } from "../graph";
import type { Document } from "../model";
import type { Point } from "@fm/protocol";

/** Endpoints and centreline length of a wall, for its editable helper dimension (spec §5.6). */
export function wallHelperDimension(doc: Document, wallId: string): { a: Point; b: Point; length: number } | null {
  const ends = wallEnds(doc, wallId);
  return ends ? { a: ends.a, b: ends.b, length: distance(ends.a, ends.b) } : null;
}
