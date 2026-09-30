import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { domainError, topologyMessage, type DomainError } from "../errors";
import { incidentWalls } from "../graph";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { keepLabelsInRooms } from "./labels";
import type { CommandOf, CommandResult } from "./types";

/**
 * Moves joints to new positions and validates the result. Only the destination matters (spec §3.4):
 * an invalid result is a "topology" error and the document is unchanged.
 */
export function applyMoves(doc: Document, moves: { jointId: string; to: Point }[]): Result<Document, DomainError> {
  if (moves.length === 0) return err(domainError("invalidInput", "Nothing to move"));
  const joints = { ...doc.joints };
  for (const m of moves) {
    if (!isValidId(m.jointId) || !doc.joints[m.jointId]) return err(domainError("notFound", "Joint not found"));
    if (!isFiniteNumber(m.to.x) || !isFiniteNumber(m.to.y)) return err(domainError("invalidInput", "Invalid position"));
    joints[m.jointId] = { id: m.jointId, x: m.to.x, y: m.to.y };
  }
  const next: Document = { ...doc, joints };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("topology", topologyMessage(valid.error), valid.error));
  return ok(next);
}

/** Moves joints; a label the move pushes out of its room goes back inside it (`keepLabelsInRooms`). */
export function moveJoints(doc: Document, cmd: CommandOf<"moveJoints">): CommandResult {
  const moved = applyMoves(doc, cmd.moves);
  if (!moved.ok) return moved;
  const deps: EntityKey[] = [];
  for (const m of cmd.moves) {
    deps.push({ table: "joints", id: m.jointId });
    for (const w of incidentWalls(doc, m.jointId)) deps.push({ table: "walls", id: w });
  }
  const next = keepLabelsInRooms(doc, moved.value, deps);
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
