import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError, thicknessViolation, topologyMessage } from "../errors";
import { isWallThickness, type Document } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { lockWall } from "./column-lock";
import type { CommandOf, CommandResult } from "./types";

/** A requested thickness within this of the current one leaves the wall unchanged. */
const SAME_THICKNESS = 1e-9;

/** Sets one wall's thickness (spec: walls-rooms, layout-states.27). Topology and labels are unaffected. */
export function setWallThickness(doc: Document, cmd: CommandOf<"setWallThickness">): CommandResult {
  const wall = isValidId(cmd.wallId) ? doc.walls[cmd.wallId] : undefined;
  if (!wall) return err(domainError("notFound", "Wall not found"));
  const locked = lockWall(doc, wall.id); // a column's depth is set by setColumn (pillars.18)
  if (locked) return err(locked);
  if (!isFiniteNumber(cmd.thickness)) return err(domainError("invalidInput", "Invalid thickness"));
  if (!isWallThickness(cmd.thickness)) {
    return err(domainError("invalidInput", MESSAGES.thickness, [thicknessViolation(wall.id, cmd.thickness)]));
  }
  const deps: EntityKey[] = [{ table: "walls", id: wall.id }];
  if (Math.abs(wall.thickness - cmd.thickness) <= SAME_THICKNESS) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, walls: { ...doc.walls, [wall.id]: { ...wall, thickness: cmd.thickness } } };
  // A thicker body can reach furniture in any state (I10, layout-states.18).
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("topology", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
