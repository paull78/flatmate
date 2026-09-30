import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { add, distance, normalize, scale, sub } from "../geometry";
import { incidentWalls } from "../graph";
import { MIN_EDGE, type Document } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { keepLabelsInRooms } from "./labels";
import { applyMoves } from "./move-joints";
import type { CommandOf, CommandResult } from "./types";

/** A requested length within this of the current one leaves the wall unchanged. */
const SAME_LENGTH = 1e-9;

/** Moves the non-kept endpoint along the wall; walls sharing that joint follow (spec §3.4). */
export function setWallLength(doc: Document, cmd: CommandOf<"setWallLength">): CommandResult {
  const wall = isValidId(cmd.wallId) ? doc.walls[cmd.wallId] : undefined;
  if (!wall) return err(domainError("notFound", "Wall not found"));
  if (cmd.keep !== "a" && cmd.keep !== "b") return err(domainError("invalidInput", "Invalid kept endpoint"));
  if (!isFiniteNumber(cmd.length) || cmd.length <= 0) return err(domainError("invalidInput", "Invalid length"));
  if (cmd.length < MIN_EDGE) return err(domainError("tooShort", MESSAGES.tooShort));
  const keptId = cmd.keep === "a" ? wall.a : wall.b;
  const movingId = cmd.keep === "a" ? wall.b : wall.a;
  const kept = doc.joints[keptId];
  const moving = doc.joints[movingId];
  if (!kept || !moving) return err(domainError("notFound", "Joint not found"));
  const deps: EntityKey[] = [
    { table: "walls", id: wall.id },
    { table: "joints", id: keptId },
    { table: "joints", id: movingId },
    ...incidentWalls(doc, movingId).map((id): EntityKey => ({ table: "walls", id })),
  ];
  // Recomputing the endpoint does not round-trip exactly; an unchanged length must not write anything.
  if (Math.abs(distance(kept, moving) - cmd.length) <= SAME_LENGTH) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const dir = normalize(sub(moving, kept));
  if (!dir) return err(domainError("invalid", MESSAGES.invalid));
  const moved = applyMoves(doc, [{ jointId: movingId, to: add(kept, scale(dir, cmd.length)) }]);
  if (!moved.ok) return moved;
  const next = keepLabelsInRooms(doc, moved.value, deps);
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
