import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { incidentWalls } from "../graph";
import { FLOOR_BASE, type Dimension, type DimensionEnd, type Document, type Joint, type Wall } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { lockJoints } from "./column-lock";
import { keepLabelsInRooms } from "./labels";
import { moveJoints } from "./move-joints";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import { keepOpeningsInPlace } from "./opening-stay";
import { splitWallAt } from "./split-at";
import type { CommandOf, CommandResult } from "./types";
import { resolveAt } from "./wall-ends";

// connectJoint (straight.06, .18): a dragged joint lands where addWall's end resolution says. Within 1 mm of a joint of
// the same base it merges into it; within 1 mm of a wall's body (same base, not a column) it splits that wall there
// and joins; anywhere else it is a plain move. The drag and Claude's move_joint both send it, so there is one owner of
// where an end lands. A dimension anchored to the dropped joint moves to the joint it merged into: the point still exists.

/** Moves joint `cmd.jointId` to `cmd.to`, connecting it to what it lands on. */
export function connectJoint(doc: Document, cmd: CommandOf<"connectJoint">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (!isFiniteNumber(cmd.to.x) || !isFiniteNumber(cmd.to.y)) return err(domainError("invalidInput", "Invalid position"));
  const joint = isValidId(cmd.jointId) ? doc.joints[cmd.jointId] : undefined;
  if (!joint) return err(domainError("notFound", "Joint not found"));
  const locked = lockJoints(doc, [joint.id]);
  if (locked) return err(locked);
  const own = incidentWalls(doc, joint.id);
  const base = doc.walls[own[0] ?? ""]?.base ?? FLOOR_BASE;
  const landing = resolveAt(doc, cmd.to, base, { excludeJoints: new Set([joint.id]), excludeWalls: new Set(own), noColumns: true });
  if (landing.kind === "new") return moveJoints(doc, { type: "moveJoints", moves: [{ jointId: joint.id, to: cmd.to }] });
  const deps: EntityKey[] = [{ table: "joints", id: joint.id }, ...own.map((id): EntityKey => ({ table: "walls", id }))];
  // The joint's own walls stretch or turn to the landing point first; a stretched wall keeps its openings in place.
  const moved = keepOpeningsInPlace(doc, { ...doc, joints: { ...doc.joints, [joint.id]: { ...joint, x: landing.point.x, y: landing.point.y } } }, new Set([joint.id]), deps);
  const next = landing.kind === "joint" ? merge(moved, joint.id, landing.jointId, deps) : split(moved, joint.id, landing.wallId, landing.point, cmd.opId, deps);
  if (!next.ok) return next;
  const valid = validateDocument(next.value);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  const labelled = keepLabelsInRooms(doc, next.value, deps);
  return ok({ doc: labelled, patch: diffPatch(doc, labelled, deps) });
}

/** `doc` with joint `from` merged into joint `into`: its walls re-ended, it deleted, its dimension ends re-pointed. */
function merge(doc: Document, from: string, into: string, deps: EntityKey[]): Result<Document, DomainError> {
  const walls: Record<string, Wall> = { ...doc.walls };
  for (const id of incidentWalls(doc, from)) {
    const w = walls[id];
    if (!w) continue;
    const far = w.a === from ? w.b : w.a;
    if (far === into) return err(domainError("tooShort", MESSAGES.tooShort)); // the wall would collapse
    const twin = incidentWalls(doc, into).some((o) => { const ow = doc.walls[o]; return ow !== undefined && (ow.a === far || ow.b === far); });
    if (twin) return err(domainError("overlap", MESSAGES.overlap)); // two walls between the same joints
    walls[id] = w.a === from ? { ...w, a: into } : { ...w, b: into };
  }
  const joints: Record<string, Joint> = { ...doc.joints };
  delete joints[from];
  const dimensions: Record<string, Dimension> = { ...doc.dimensions };
  const repoint = (end: DimensionEnd): DimensionEnd => ("joint" in end && end.joint === from ? { ...end, joint: into } : end);
  for (const d of Object.values(doc.dimensions)) {
    if ([d.a, d.b].some((end) => "joint" in end && end.joint === from)) {
      dimensions[d.id] = { ...d, a: repoint(d.a), b: repoint(d.b) };
      deps.push({ table: "dimensions", id: d.id });
    }
  }
  deps.push({ table: "joints", id: into }, ...incidentWalls(doc, into).map((id): EntityKey => ({ table: "walls", id })));
  return ok({ ...doc, walls, joints, dimensions });
}

/** `doc` with wall `wallId` split at `point`, the moving joint `jointId` as the split joint, the fragment `${opId}/w1`. */
function split(doc: Document, jointId: string, wallId: string, point: Point, opId: string, deps: EntityKey[]): Result<Document, DomainError> {
  const t = { joints: { ...doc.joints }, walls: { ...doc.walls }, openings: { ...doc.openings } };
  const r = splitWallAt(doc, wallId, point, { joint: jointId, fragment: `${opId}/w1` }, MESSAGES.splitTooShort, (o) => `A wall can't end inside ${o}`, deps, t);
  return r.ok ? ok({ ...doc, ...t }) : err(r.error);
}
