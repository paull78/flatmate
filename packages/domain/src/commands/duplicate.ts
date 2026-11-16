import { err } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import type { Document, LayoutObject, Placement } from "../model";
import { isValidId } from "../shape";
import { finish, normaliseRotation, placementDeps, validPoint } from "./object-helpers";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import { placeLinked, withLink } from "./link";
import type { CommandOf, CommandResult } from "./types";

/**
 * Copies placements of one layout into new objects (direct.11): source i, in sorted ID order, becomes object
 * `${opId}/o${i}` (kind, name, every configuration's size, an `L`'s arms, the options) and placement `${opId}/p${i}` at the copy's
 * own `at` and `rotation` (the editor's ghost computes them, ghost.06), with its source's configuration and sides.
 * Copies of one object in a layout would break I9, so each is a new object. The places are the caller's: the user puts
 * them down with the ghost (ghost.01, ghost.06); fit is checked once, at the end.
 */
export function duplicatePlacements(doc: Document, cmd: CommandOf<"duplicatePlacements">): CommandResult {
  // A copy of a linked piece is linked when it fits in every layout, else in this layout only (review.06).
  return placeLinked(undefined, (link) => duplicateOnce(doc, cmd, link));
}

function duplicateOnce(doc: Document, cmd: CommandOf<"duplicatePlacements">, link: boolean): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (cmd.copies.length === 0) return err(domainError("invalidInput", "Nothing to duplicate"));
  const copies = [...cmd.copies].sort((a, b) => (a.placementId < b.placementId ? -1 : a.placementId > b.placementId ? 1 : 0));
  const objects = { ...doc.objects };
  const placements = { ...doc.placements };
  const deps: EntityKey[] = [];
  let state: string | undefined;
  for (const [i, c] of copies.entries()) {
    // Two places for one source are ambiguous.
    if (i > 0 && copies[i - 1]?.placementId === c.placementId) return err(domainError("invalidInput", "Placement listed twice"));
    const p = isValidId(c.placementId) ? doc.placements[c.placementId] : undefined;
    const object = p ? doc.objects[p.object] : undefined;
    if (!p || !object) return err(domainError("notFound", "Placement not found"));
    state ??= p.state;
    if (p.state !== state) return err(domainError("invalidInput", "Placements must be in one layout"));
    if (!validPoint(c.at)) return err(domainError("invalidInput", "Invalid position"));
    const rotation = normaliseRotation(c.rotation);
    if (rotation === null) return err(domainError("invalidInput", "Invalid rotation"));
    const sized: LayoutObject = { id: `${cmd.opId}/o${i}`, kind: object.kind, name: object.name, w: { ...object.w }, d: { ...object.d }, h: { ...object.h }, z: { ...object.z }, ...(object.arms ? { arms: { ...object.arms } } : {}) };
    const optioned: LayoutObject = object.options ? { ...sized, options: { ...object.options } } : sized; // library.10
    const targeted: LayoutObject = object.riser === undefined ? optioned : { ...optioned, riser: object.riser }; // riser.11
    const railed: LayoutObject = object.handrail === undefined ? targeted : { ...targeted, handrail: object.handrail }; // guards.28
    const base: LayoutObject = object.handrails === undefined ? railed : { ...railed, handrails: { ...object.handrails } }; // edges.06
    // A stair's copy keeps its links (stairs.10, .49).
    const copy: LayoutObject = object.reaches === undefined ? base : { ...base, reaches: object.reaches, startsAt: object.startsAt ?? null };
    // `at` as given, as movePlacements stores it: the editor keeps it to the millimetre.
    const placed: Placement = { ...p, id: `${cmd.opId}/p${i}`, object: copy.id, at: { x: c.at.x, y: c.at.y }, rotation, sides: { ...p.sides }, zones: { ...p.zones } };
    objects[copy.id] = withLink(copy, link && object.linked === true);
    placements[placed.id] = placed;
    deps.push(...placementDeps(p));
  }
  // placementDeps names the layout once per source; diffPatch drops the repeats.
  return finish(doc, { ...doc, objects, placements }, deps);
}
