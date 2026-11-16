import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { distance } from "../geometry";
import { MIN_EDGE, type Document, type Joint, type Opening, type Wall } from "../model";
import { carryOpenings } from "./split-openings";

// Splitting a wall at a point (straight step 12): the one split `addWall`'s T-junctions and `splitWall` share. The wall
// keeps its id from joint a to the new joint; the fragment copies its row (thickness, top, base, finishes) from the new
// joint to joint b; openings past the split move to the fragment at their world places, and a split inside one refuses.

/** The tables a split writes, copied by the caller before the first split. */
export type SplitTables = { joints: Record<string, Joint>; walls: Record<string, Wall>; openings: Record<string, Opening> };

/**
 * Splits `wallId` of `doc` at `point` into `t`: the new joint `ids.joint`, the fragment `ids.fragment`. `tooShort` is
 * the refusal for a piece under 1 cm, `inside(what)` the one for a split inside an opening. Pushes the wall and both
 * its joints (and its openings) to `deps`.
 */
export function splitWallAt(
  doc: Document, wallId: string, point: Point, ids: { joint: string; fragment: string }, tooShort: string, inside: (what: string) => string, deps: EntityKey[], t: SplitTables,
): Result<void, DomainError> {
  const wall = doc.walls[wallId];
  const a = wall && doc.joints[wall.a];
  const b = wall && doc.joints[wall.b];
  if (!wall || !a || !b) return err(domainError("notFound", "Wall not found"));
  if (distance(a, point) < MIN_EDGE || distance(point, b) < MIN_EDGE) return err(domainError("tooShort", tooShort));
  // Openings (spec: openings): a split inside one's span is refused; those past the split move to the new fragment.
  const split = distance(a, point);
  const moved = carryOpenings(doc, wall, { from: split, to: split, fragment: ids.fragment }, inside, deps);
  if (!moved.ok) return err(moved.error);
  Object.assign(t.openings, moved.value);
  t.joints[ids.joint] = { id: ids.joint, x: point.x, y: point.y };
  t.walls[wall.id] = { ...wall, b: ids.joint };
  t.walls[ids.fragment] = { ...wall, id: ids.fragment, a: ids.joint }; // a half wall stays half (heights.31), on the same base
  deps.push({ table: "walls", id: wall.id }, { table: "joints", id: wall.a }, { table: "joints", id: wall.b });
  return ok(undefined);
}
