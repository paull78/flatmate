import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { dot, sub } from "../geometry";
import { OPENING_KINDS } from "../kinds";
import { EPS, openingLabel, type Document, type Opening, type Wall } from "../model";
import { wallReach } from "../queries/openings";

/** A wall's run: its joint a and the unit direction a → b. */
export type Run = { a: Point; dir: Point };

/** The run from `a` to `b`; a zero-length run points along x (never used: walls are at least MIN_EDGE long). */
export function runFrom(a: Point, b: Point): Run {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { a, dir: len === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
}

/**
 * Opening `o`, on a wall running `from`, re-hosted onto wall `wall` running `to` on the same line, keeping its place in
 * the world (pillars.25): its offset is measured from the new joint a, and when the new wall runs the other way, its
 * side and hinge flip so it stays the same physical door.
 */
export function rehost(o: Opening, from: Run, to: Run, wall: string): Opening {
  const start = dot(sub(from.a, to.a), to.dir); // where the old joint a lies along the new wall
  if (dot(from.dir, to.dir) > 0) return { ...o, wall, offset: Math.max(0, start + o.offset) };
  const side = o.side === "left" ? "right" : "left";
  return { ...o, wall, offset: Math.max(0, start - o.offset - o.width), side, hinge: o.hinge === "a" ? "b" : "a" };
}

/**
 * The refusal of a cut or a column over opening `o`'s reach on wall `wallId`: an I12 violation naming both, a kind with
 * a pocket by its label, since the cut may lie in the pocket and not the span ("pocket door p", openkinds.16).
 */
export function coverRefusal(o: Opening, wallId: string, refusal: (what: string) => string): DomainError {
  const name = OPENING_KINDS[o.kind].pocket ? OPENING_KINDS[o.kind].label : openingLabel(o.kind);
  const message = refusal(`${name.toLowerCase()} ${o.id}`);
  const entities: EntityKey[] = [{ table: "openings", id: o.id }, { table: "walls", id: wallId }];
  return domainError("topology", message, [{ invariant: "I12", message, entities }]);
}

/**
 * Carries wall `wall`'s openings across a cut from `from` to `to` metres along it from joint a (spec: openings,
 * pillars.25): an opening whose reach (`wallReach`) runs into the cut by more than EPS is refused, named by `refusal` ("A wall can't
 * end inside door D1"); one reaching past `to` moves to `fragment`, which starts at `to`, its offset rewritten so it
 * keeps its place in the world; the others stay. A split is a cut with `from` = `to`. Returns the moved openings and
 * pushes every opening on the wall to `deps`.
 */
export function carryOpenings(
  doc: Document,
  wall: Wall,
  cut: { from: number; to: number; fragment: string },
  refusal: (what: string) => string,
  deps: EntityKey[],
): Result<Record<string, Opening>, DomainError> {
  const moved: Record<string, Opening> = {};
  // Along the wall's own axis: the fragment starts `to` further on, in the same direction.
  const axis: Run = { a: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
  for (const o of Object.values(doc.openings)) {
    if (o.wall !== wall.id) continue;
    const reach = wallReach(o); // a door and its pocket stay on one wall (openkinds.16)
    if (reach.from + EPS < cut.to && cut.from < reach.to - EPS) return err(coverRefusal(o, wall.id, refusal));
    if (reach.to > cut.to + EPS) moved[o.id] = rehost(o, axis, { a: { x: cut.to, y: 0 }, dir: axis.dir }, cut.fragment);
    deps.push({ table: "openings", id: o.id });
  }
  return ok(moved);
}
