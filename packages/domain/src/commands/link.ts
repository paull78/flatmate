import { err, ok } from "@fm/protocol";
import { domainError } from "../errors";
import { inEveryLayout } from "../kinds";
import type { Document, LayoutObject, Placement } from "../model";
import { diffPatch } from "../patch";
import { isValidId } from "../shape";
import { finish, key, placementDeps, placementsOf } from "./object-helpers";
import type { CommandOf, CommandResult } from "./types";

// Layouts linked by default (review.05, .06, .07, .11): the fallback for a new piece, and the switch.

/**
 * A new piece placed linked when it fits in every layout (review.06): `run(true)` places it linked, `run(false)` in its
 * own layout only. `mode` absent tries linked, then alone when only another layout refused it (alone fits); true
 * refuses rather than fall back; false never links. The refusal of a piece that fits nowhere is its own layout's.
 */
export function placeLinked(mode: boolean | undefined, run: (link: boolean) => CommandResult): CommandResult {
  if (mode === false) return run(false);
  const linked = run(true);
  if (linked.ok || mode === true) return linked;
  return run(false);
}

/** `object` with `linked` set as asked, or as it was for a kind in every layout, which never stores it. */
export function withLink(object: LayoutObject, link: boolean): LayoutObject {
  if (link && !inEveryLayout(object.kind)) return { ...object, linked: true };
  const rest = { ...object };
  delete rest.linked;
  return rest;
}

/**
 * Links or unlinks the placement's object (review.07). On: every layout takes this placement's pose and surface, and a
 * layout without the piece gets a copy (the sync adds it); refused where it doesn't fit. Off: the copies stay where they
 * are, each its own from now on. A kind in every layout can't be unlinked.
 */
export function setLinked(doc: Document, cmd: CommandOf<"setLinked">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  if (!p || !object) return err(domainError("notFound", "Placement not found"));
  if (inEveryLayout(object.kind)) return err(domainError("invalidInput", `${object.name} is in every layout`));
  const deps = [...placementDeps(p), ...placementsOf(doc, object.id).map((id) => key("placements", id))];
  if ((object.linked === true) === cmd.on) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  if (!cmd.on) return finish(doc, { ...doc, objects: { ...doc.objects, [object.id]: withLink(object, false) } }, deps);
  const placements: Record<string, Placement> = { ...doc.placements };
  for (const id of placementsOf(doc, object.id)) {
    const c = placements[id];
    if (c) placements[id] = { ...c, at: { ...p.at }, rotation: p.rotation, deck: p.deck };
  }
  return finish(doc, { ...doc, objects: { ...doc.objects, [object.id]: withLink(object, true) }, placements }, deps);
}
