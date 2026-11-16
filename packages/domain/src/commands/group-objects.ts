import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import type { Document, Placement } from "../model";
import { diffPatch } from "../patch";
import { isValidId } from "../shape";
import { finish, normaliseRotation, placementDeps, validPoint } from "./object-helpers";
import type { CommandOf, CommandResult } from "./types";

// Group furniture commands (direct.16): each builds one patch and checks fit once, at its end, so pieces of the
// group may pass through each other's places on the way.

/**
 * Moves and turns several placements of one layout. The editor computes each anchor and rotation (a group turn is
 * about the group's box); the domain stores them as given, like movePlacement.
 */
export function movePlacements(doc: Document, cmd: CommandOf<"movePlacements">): CommandResult {
  if (cmd.moves.length === 0) return err(domainError("invalidInput", "Nothing to move"));
  const seen = new Set<string>();
  const states = new Set<string>();
  const moved: Placement[] = [];
  const deps: EntityKey[] = [];
  for (const m of cmd.moves) {
    const p = isValidId(m.placementId) ? doc.placements[m.placementId] : undefined;
    if (!p) return err(domainError("notFound", "Placement not found"));
    if (seen.has(p.id)) return err(domainError("invalidInput", "Placement listed twice"));
    seen.add(p.id);
    states.add(p.state);
    if (states.size > 1) return err(domainError("invalidInput", "Placements must be in one layout"));
    if (!validPoint(m.at)) return err(domainError("invalidInput", "Invalid position"));
    const rotation = normaliseRotation(m.rotation);
    if (rotation === null) return err(domainError("invalidInput", "Invalid rotation"));
    deps.push(...placementDeps(p));
    // A piece that stays put keeps its row object.
    const same = p.at.x === m.at.x && p.at.y === m.at.y && p.rotation === rotation;
    if (!same) moved.push({ ...p, at: { x: m.at.x, y: m.at.y }, rotation });
  }
  // diffPatch sorts the dependencies and drops duplicates (the shared state).
  if (moved.length === 0) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const placements = { ...doc.placements };
  for (const p of moved) placements[p.id] = p;
  return finish(doc, { ...doc, placements }, deps);
}
