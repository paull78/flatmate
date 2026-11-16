import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { columnOf } from "../column-checks";
import { domainError, topologyMessage } from "../errors";
import { add } from "../geometry";
import { incidentWalls } from "../graph";
import type { Document, Placement } from "../model";
import { roundMm } from "../queries/footprints";
import { validateDocument } from "../validate";
import { syncDeps, syncLinkedCopies } from "./linked-copies";
import { placementDeps } from "./object-helpers";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { lockJoints } from "./column-lock";
import { keepLabelsInRooms } from "./labels";
import { applyMoves, shiftJoints } from "./move-joints";
import type { CommandOf, CommandResult } from "./types";

// moveWalls (straight.22): every joint of the listed walls moves by one delta, as one patch. A wall drag sends its run,
// a group drag its walls; Claude's move_walls the walls it names. A column in a wall's line moves rigidly when both its
// joints move (straight.12): the column lock (pillars.31) admits that and nothing else.

/** Moves every joint of `cmd.walls` by `cmd.by`; walls sharing those joints follow. */
export function moveWalls(doc: Document, cmd: CommandOf<"moveWalls">): CommandResult {
  if (cmd.walls.length === 0) return err(domainError("invalidInput", "Nothing to move"));
  if (!isFiniteNumber(cmd.by.x) || !isFiniteNumber(cmd.by.y)) return err(domainError("invalidInput", "Invalid move"));
  const joints = new Set<string>();
  for (const id of cmd.walls) {
    const w = isValidId(id) ? doc.walls[id] : undefined;
    if (!w) return err(domainError("notFound", "Wall not found"));
    if (w.column && columnOf(doc, id)?.line === null) return err(domainError("invalidInput", "Free columns move on their own"));
    joints.add(w.a).add(w.b);
  }
  const pieces: Placement[] = [];
  for (const id of cmd.placements ?? []) {
    const p = isValidId(id) ? doc.placements[id] : undefined;
    if (!p) return err(domainError("notFound", "Placement not found"));
    if (pieces.some((q) => q.id === p.id)) return err(domainError("invalidInput", "Placement listed twice"));
    if (pieces[0] && pieces[0].state !== p.state) return err(domainError("invalidInput", "Placements must be in one layout"));
    pieces.push(p);
  }
  const ids = [...joints].sort();
  // A column moves rigidly only when both its joints are in the move; any other column joint is locked.
  const rigid = (j: string): boolean => incidentWalls(doc, j).some((w) => {
    const row = doc.walls[w];
    return row?.column === true && joints.has(row.a) && joints.has(row.b);
  });
  const locked = lockJoints(doc, ids.filter((j) => !rigid(j)));
  if (locked) return err(locked);
  if (cmd.by.x === 0 && cmd.by.y === 0) return ok({ doc, patch: diffPatch(doc, doc, dependencies(doc, ids)) });
  const deps = dependencies(doc, ids);
  const moves = ids.flatMap((id) => {
    const j = doc.joints[id];
    return j ? [{ jointId: id, to: add(j, cmd.by) }] : [];
  });
  if (pieces.length === 0) {
    const moved = applyMoves(doc, moves, deps);
    if (!moved.ok) return moved;
    const next = keepLabelsInRooms(doc, moved.value, deps);
    return ok({ doc: next, patch: diffPatch(doc, next, deps) });
  }
  // Walls and pieces together (straight.09): everything moves, then one validation, so a piece may pass through a
  // wall's old place. A linked piece's copies follow in every layout (syncLinkedCopies); each keeps its surface.
  const shifted = shiftJoints(doc, moves, deps);
  if (!shifted.ok) return shifted;
  const placements = { ...shifted.value.placements };
  for (const p of pieces) {
    placements[p.id] = { ...p, at: { x: roundMm(p.at.x + cmd.by.x), y: roundMm(p.at.y + cmd.by.y) } };
    deps.push(...placementDeps(p));
  }
  const withPieces = { ...shifted.value, placements };
  const synced = syncLinkedCopies(doc, withPieces);
  const valid = validateDocument(synced);
  if (!valid.ok) return err(domainError("topology", topologyMessage(valid.error), valid.error));
  deps.push(...syncDeps(withPieces, synced));
  const next = keepLabelsInRooms(doc, synced, deps);
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** The moved joints and every wall at them, as a joint move records (spec: collaboration). */
function dependencies(doc: Document, joints: readonly string[]): EntityKey[] {
  return joints.flatMap((id): EntityKey[] => [{ table: "joints", id }, ...incidentWalls(doc, id).map((w): EntityKey => ({ table: "walls", id: w }))]);
}
