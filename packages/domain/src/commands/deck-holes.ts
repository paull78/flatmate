import { err } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import { convexOverlap } from "../geometry";
import { guardFor, guardValue, type DeckHole, type Document } from "../model";
import { patchedGuard } from "./decks";
import { deckView } from "../queries/decks";
import { footprints, roundMm } from "../queries/footprints";
import { isFiniteNumber, isValidId } from "../shape";
import { finish, key, placementDeps, validPoint } from "./object-helpers";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";

// A hole's commands (stairwell.03, .14, .20): plan coordinates in, rounded to the millimetre; I22 and the slab's
// checks (validateDocument) make every refusal of a well-formed value. Deleting a hole is deleteEntities.

/**
 * A hole's checks read its deck, its deck's other holes, every wall (rows on or under the deck) and the pieces over
 * the deck's rectangle: a concurrent change to any of them conflicts.
 */
function holeDeps(doc: Document, hole: DeckHole): EntityKey[] {
  const view = deckView(doc, hole.deck);
  const holes = view ? view.holes.map((h) => key("deckHoles", h.id)) : [];
  const pieces = view ? [...footprints(doc)].filter(([, quad]) => convexOverlap(quad, view.ring)).flatMap(([id]) => {
    const p = doc.placements[id];
    return p ? placementDeps(p) : [];
  }) : [];
  return [key("deckHoles", hole.id), key("decks", hole.deck), ...holes, ...Object.keys(doc.walls).map((id) => key("walls", id)), ...pieces];
}

/** The size given, to the millimetre, or the refusal's text. */
function cleanSize(v: unknown): number | string {
  return isFiniteNumber(v) ? roundMm(v) : "Invalid size";
}

/** Cuts a hole `${opId}/h0` in a deck: its centre `at` in plan coordinates, its sides along the deck's axes. */
export function addDeckHole(doc: Document, cmd: CommandOf<"addDeckHole">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (!isValidId(cmd.deck) || !doc.decks[cmd.deck]) return err(domainError("notFound", "Deck not found"));
  if (!validPoint(cmd.at)) return err(domainError("invalidInput", "Invalid position"));
  const w = cleanSize(cmd.w);
  const d = cleanSize(cmd.d);
  if (typeof w === "string" || typeof d === "string") return err(domainError("invalidInput", "Invalid size"));
  const deck = doc.decks[cmd.deck];
  const guard = patchedGuard(guardValue(guardFor(deck?.top ?? 0)), cmd.guard); // from the deck's top, as its sides (edges.01)
  if (typeof guard === "string") return err(domainError("invalidInput", guard));
  const hole: DeckHole = { id: `${cmd.opId}/h0`, deck: cmd.deck, at: { x: roundMm(cmd.at.x), y: roundMm(cmd.at.y) }, w, d, guard };
  return finish(doc, { ...doc, deckHoles: { ...doc.deckHoles, [hole.id]: hole } }, holeDeps(doc, hole));
}

/** Moves or resizes a hole, or sets its guard; the fields not given keep their values. */
export function setDeckHole(doc: Document, cmd: CommandOf<"setDeckHole">): CommandResult {
  const hole = isValidId(cmd.holeId) ? doc.deckHoles[cmd.holeId] : undefined;
  if (!hole) return err(domainError("notFound", "Hole not found"));
  if (cmd.at !== undefined && !validPoint(cmd.at)) return err(domainError("invalidInput", "Invalid position"));
  const w = cmd.w === undefined ? hole.w : cleanSize(cmd.w);
  const d = cmd.d === undefined ? hole.d : cleanSize(cmd.d);
  if (typeof w === "string" || typeof d === "string") return err(domainError("invalidInput", "Invalid size"));
  const at = cmd.at === undefined ? hole.at : { x: roundMm(cmd.at.x), y: roundMm(cmd.at.y) };
  const guard = patchedGuard(hole.guard, cmd.guard);
  if (typeof guard === "string") return err(domainError("invalidInput", guard));
  const next: DeckHole = { ...hole, at, w, d, guard };
  return finish(doc, { ...doc, deckHoles: { ...doc.deckHoles, [hole.id]: next } }, [...holeDeps(doc, hole), ...holeDeps(doc, next)]);
}
