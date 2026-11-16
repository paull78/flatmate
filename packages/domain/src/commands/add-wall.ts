import { assertNever, err, ok } from "@fm/protocol";
import type { EntityKey, Result } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { distance, segmentIntersection } from "../geometry";
import { sortedIds, wallEnds } from "../graph";
import { DEFAULT_WALL_THICKNESS, EPS, FLOOR_BASE, MIN_EDGE, isWallThickness, type Document, type Joint, type Opening, type Wall, type WallTop } from "../model";
import { diffPatch } from "../patch";
import { roundMm } from "../queries/footprints";
import { rangesOverlap, wallRange, type Range } from "../queries/vertical";
import { highSide, highestCeilingAlong } from "../roof";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { columnTouched, lockJoints, lockWall } from "./column-lock";
import { keepLabelsInRooms } from "./labels";
import { splitWallAt } from "./split-at";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";
import { refPoint, resolveEnd, type Resolved } from "./wall-ends";

/**
 * The new wall's base, top and range (pillars.09, .23): the floor or a deck, up to the ceiling or a height from the
 * base, kept to the millimetre; a deck as top is refused (only a free column reaches up to one).
 */
function refsOf(doc: Document, cmd: CommandOf<"addWall">): { base: string; top: WallTop; range: Range } | DomainError {
  const base: unknown = cmd.base ?? FLOOR_BASE; // commands arrive as JSON
  const top: unknown = cmd.top ?? "ceiling";
  const deck = isValidId(base) && Object.hasOwn(doc.decks, base) ? doc.decks[base] : undefined;
  if (!isValidId(base) || (base !== FLOOR_BASE && !deck)) return domainError("notFound", "Deck not found");
  if (isValidId(top) && Object.hasOwn(doc.decks, top)) return domainError("invalidInput", MESSAGES.onlyColumnsReachDecks);
  if (top !== "ceiling" && !isFiniteNumber(top)) return domainError("invalidInput", "Invalid height");
  const bottom = deck?.top ?? 0;
  const value = top === "ceiling" ? top : roundMm(top);
  const [a, b] = [refPoint(doc, cmd.from), refPoint(doc, cmd.to)];
  const ceiling = a.ok && b.ok ? highestCeilingAlong(doc, a.value, b.value) : highSide(doc); // a full wall's highest point (roofs.17)
  return { base, top: value, range: { bottom, top: value === "ceiling" ? ceiling : bottom + value } };
}

/** A new wall never ends on a column's joint nor splits a column (pillars.22). */
function lockResolved(doc: Document, r: Resolved): DomainError | null {
  if (r.kind === "joint") return lockJoints(doc, [r.jointId]);
  return r.kind === "split" ? lockWall(doc, r.wallId) : null;
}

/**
 * addWall normalisation (spec: walls-rooms): resolve endpoints, split walls at T-junctions, reject collinear
 * overlap and interior crossings, validate. IDs: the new wall is `${opId}/w0`, split fragments
 * `${opId}/w1`…, new joints `${opId}/j0`…, in from-then-to order. A split wall keeps its ID on the
 * fragment next to its original `a` endpoint, with the openings before the split; the others move to the new fragment.
 * A label the new wall cuts off from its room's floor moves back onto it (`keepLabelsInRooms`).
 */
export function addWall(doc: Document, cmd: CommandOf<"addWall">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  const thickness = cmd.thickness ?? DEFAULT_WALL_THICKNESS;
  if (!isWallThickness(thickness)) return err(domainError("invalidInput", MESSAGES.thickness));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  const refs = refsOf(doc, cmd);
  if ("kind" in refs) return err(refs);
  const prefix = `${cmd.opId}/`;
  const [p, q] = [refPoint(doc, cmd.from), refPoint(doc, cmd.to)];
  if (!p.ok) return p;
  if (!q.ok) return q;
  const from = resolveEnd(doc, cmd.from, q.value, refs.base, refs.range);
  if (!from.ok) return from;
  const to = resolveEnd(doc, cmd.to, p.value, refs.base, refs.range);
  if (!to.ok) return to;
  const locked = lockResolved(doc, from.value) ?? lockResolved(doc, to.value);
  if (locked) return err(locked);
  if (distance(from.value.point, to.value.point) < MIN_EDGE) return err(domainError("tooShort", MESSAGES.tooShort));
  if (from.value.kind === "split" && to.value.kind === "split" && from.value.wallId === to.value.wallId) {
    return err(domainError("overlap", MESSAGES.overlap));
  }

  const joints: Record<string, Joint> = { ...doc.joints };
  const walls: Record<string, Wall> = { ...doc.walls };
  const openings: Record<string, Opening> = { ...doc.openings };
  const deps: EntityKey[] = [];
  let nextJoint = 0;
  let nextWall = 1;

  const place = (r: Resolved): Result<string, DomainError> => {
    switch (r.kind) {
      case "joint":
        deps.push({ table: "joints", id: r.jointId });
        return ok(r.jointId);
      case "new": {
        const id = `${prefix}j${nextJoint++}`;
        joints[id] = { id, x: r.point.x, y: r.point.y };
        return ok(id);
      }
      case "split": { // the one split shared with splitWall (split-at.ts)
        const id = `${prefix}j${nextJoint++}`;
        const fragment = `${prefix}w${nextWall++}`;
        const split = splitWallAt(doc, r.wallId, r.point, { joint: id, fragment }, MESSAGES.splitTooShort, (o) => `A wall can't end inside ${o}`, deps, { joints, walls, openings });
        return split.ok ? ok(id) : err(split.error);
      }
      default:
        return assertNever(r);
    }
  };

  const a = place(from.value);
  if (!a.ok) return a;
  const b = place(to.value);
  if (!b.ok) return b;
  const wallId = `${prefix}w0`;
  walls[wallId] = { id: wallId, a: a.value, b: b.value, thickness, top: refs.top, base: refs.base, column: false };
  const next: Document = { ...doc, joints, walls, openings };
  const pa = joints[a.value];
  const pb = joints[b.value];
  if (!pa || !pb) return err(domainError("notFound", "Joint not found"));

  // Steps 2 and 3 apply only to walls whose heights meet the new one's (pillars.08), as I5–I7 do.
  const mine = wallRange(next, wallId);
  const meets = (id: string): boolean => {
    const r = wallRange(next, id);
    return !mine || !r || rangesOverlap(mine, r);
  };
  const others = sortedIds(walls).filter((id) => id !== wallId && meets(id));
  // spec: walls-rooms step 2: collinear overlap.
  for (const id of others) {
    const o = walls[id];
    const ends = wallEnds(next, id);
    if (!o || !ends) continue;
    const sharesBoth = (o.a === a.value || o.a === b.value) && (o.b === a.value || o.b === b.value);
    if (sharesBoth || segmentIntersection(pa, pb, ends.a, ends.b).kind === "overlap") {
      return err(o.column ? columnTouched(id, wallId) : domainError("overlap", MESSAGES.overlap));
    }
  }
  // spec: walls-rooms step 3: the new wall may touch other walls only at its own endpoints' joints.
  for (const id of others) {
    const o = walls[id];
    const ends = wallEnds(next, id);
    if (!o || !ends) continue;
    const hit = segmentIntersection(pa, pb, ends.a, ends.b);
    if (hit.kind !== "point") continue;
    const shared = [a.value, b.value].find((j) => j === o.a || j === o.b);
    const sharedPoint = shared === undefined ? undefined : joints[shared];
    if (!sharedPoint || distance(hit.point, sharedPoint) >= EPS) return err(o.column ? columnTouched(id, wallId) : domainError("crossing", MESSAGES.crossing));
  }
  // spec: walls-rooms step 4.
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  // A wall closing a loop around a label leaves the label on the room's floor (holes.03).
  const labelled = keepLabelsInRooms(doc, next, deps);
  return ok({ doc: labelled, patch: diffPatch(doc, labelled, deps) });
}
