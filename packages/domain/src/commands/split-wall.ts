import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage } from "../errors";
import { add, scale } from "../geometry";
import { wallFrame } from "../graph";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { wallFace } from "../queries/helpers";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { lockWall } from "./column-lock";
import { keepLabelsInRooms } from "./labels";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import { splitWallAt } from "./split-at";
import type { CommandOf, CommandResult } from "./types";

// splitWall (straight step 12, spec M2 "Split"): a wall cut in two at a distance along its room-side face from the
// face's start, as the Split gesture's typed value and Claude's split_wall give it. Both pieces copy the row; openings
// move to their piece at their world places; a split inside an opening or leaving a piece under 1 cm refuses.

/** Splits `cmd.wallId` at `cmd.offset` metres along its room-side face: the new joint `${opId}/j0`, the fragment `${opId}/w1`. */
export function splitWall(doc: Document, cmd: CommandOf<"splitWall">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (!isFiniteNumber(cmd.offset)) return err(domainError("invalidInput", "Invalid offset"));
  const wall = isValidId(cmd.wallId) ? doc.walls[cmd.wallId] : undefined;
  const frame = wall ? wallFrame(doc, wall.id) : null;
  const face = wall ? wallFace(doc, wall.id) : null;
  if (!wall || !frame || !face) return err(domainError("notFound", "Wall not found"));
  const locked = lockWall(doc, wall.id);
  if (locked) return err(locked);
  const point = add(frame.a, scale(frame.dir, face.faceStart + cmd.offset));
  const deps: EntityKey[] = [];
  const t = { joints: { ...doc.joints }, walls: { ...doc.walls }, openings: { ...doc.openings } };
  const split = splitWallAt(doc, wall.id, point, { joint: `${cmd.opId}/j0`, fragment: `${cmd.opId}/w1` }, MESSAGES.splitShort, (what) => `A wall can't be split inside ${what}`, deps, t);
  if (!split.ok) return split;
  const next: Document = { ...doc, ...t };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  const labelled = keepLabelsInRooms(doc, next, deps);
  return ok({ doc: labelled, patch: diffPatch(doc, labelled, deps) });
}
