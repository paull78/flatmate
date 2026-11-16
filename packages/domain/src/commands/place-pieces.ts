import { err } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import { configsOf, defaultSides, defaultSize, isObjectHeight, isObjectSize, kindConfigs, kindOf, type ObjectSizes } from "../kinds";
import type { Document, LayoutObject, Placement } from "../model";
import { parseOptions } from "../options";
import { isFiniteNumber, isValidId, isValidName } from "../shape";
import { nullZones } from "../use-zone";
import { finish, givenSurface, key, normaliseRotation, placementsOf, validPoint } from "./object-helpers";
import { withoutPlacements } from "./objects";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import { placeLinked, withLink } from "./link";
import type { CommandOf, CommandResult, NewPiece } from "./types";

/** Every configuration of the kind has a width, a depth, a height and an elevation in range. */
function validSizes(kind: string, s: ObjectSizes): boolean {
  return kindConfigs(kind).every((c) => {
    const [w, d, h, z] = [s.w[c.id], s.d[c.id], s.h[c.id], s.z[c.id]];
    return w !== undefined && isObjectSize(w) && d !== undefined && isObjectSize(d) && h !== undefined && isObjectHeight(h) && (z === "ceiling" || (isFiniteNumber(z) && z >= 0));
  });
}

/**
 * Adds new pieces and takes away at most one object, in one patch, all or none (seated.10): a set broken apart, or several
 * pieces placed as one. Piece i becomes object `${opId}/o${i}`, its placements `${opId}/p${n}`, numbered across the list.
 * The places and sizes are the caller's and are stored as given, as duplicatePlacements stores them; what the pieces mean
 * is the editor's, and the domain checks only the result, once, at the end, so a piece may stand where the removed one did.
 * A stair has its own links and rules, so it isn't placed here.
 */
export function placePieces(doc: Document, cmd: CommandOf<"placePieces">): CommandResult {
  // A set broken apart keeps its link; pieces placed as one link when they fit everywhere (review.06).
  const removed = cmd.remove === undefined ? undefined : doc.objects[cmd.remove];
  return placeLinked(removed === undefined ? undefined : removed.linked === true, (link) => placeOnce(doc, cmd, link));
}

function placeOnce(doc: Document, cmd: CommandOf<"placePieces">, link: boolean): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (cmd.pieces.length === 0) return err(domainError("invalidInput", "Nothing to place"));

  const deps: EntityKey[] = [];
  let base = doc;
  if (cmd.remove !== undefined) {
    if (!isValidId(cmd.remove) || !doc.objects[cmd.remove]) return err(domainError("notFound", "Object not found"));
    deps.push(key("objects", cmd.remove));
    base = withoutPlacements(doc, new Set(placementsOf(doc, cmd.remove)), deps);
  }

  const objects = { ...base.objects };
  const placements = { ...base.placements };
  let n = 0;
  for (const [i, piece] of cmd.pieces.entries()) {
    const built = buildObject(piece, `${cmd.opId}/o${i}`);
    if (typeof built === "string") return err(domainError("invalidInput", built));
    // A piece given its own place in several layouts is an exception unless it replaces a linked set (review.06).
    objects[built.id] = withLink(built, link && (piece.placements.length === 1 || cmd.remove !== undefined));
    if (piece.placements.length === 0) return err(domainError("invalidInput", "A piece needs a place"));
    const seen = new Set<string>();
    for (const at of piece.placements) {
      const state = isValidId(at.state) ? doc.states[at.state] : undefined;
      if (!state) return err(domainError("notFound", "Layout not found"));
      if (seen.has(state.id)) return err(domainError("invalidInput", "Already placed in this state"));
      seen.add(state.id);
      if (!validPoint(at.at)) return err(domainError("invalidInput", "Invalid position"));
      const rotation = normaliseRotation(at.rotation);
      if (rotation === null) return err(domainError("invalidInput", "Invalid rotation"));
      const deck = givenSurface(doc, at.deck);
      if (deck === undefined) return err(domainError("notFound", "Deck not found"));
      const config = at.config ?? configsOf(built)[0]?.id;
      if (!config || !kindConfigs(built.kind).some((c) => c.id === config)) return err(domainError("invalidInput", "Unknown configuration"));
      const sides = defaultSides(built.kind);
      if (!sides) return err(domainError("invalidInput", "Unknown kind"));
      const placed: Placement = { id: `${cmd.opId}/p${n}`, object: built.id, state: state.id, at: { x: at.at.x, y: at.at.y }, rotation, config, sides, zones: nullZones(), deck };
      placements[placed.id] = placed;
      n++;
      deps.push(key("states", state.id), ...(deck === null ? [] : [key("decks", deck)]));
    }
  }
  return finish(doc, { ...base, objects, placements }, deps);
}

/** The object of a new piece, or the reason it can't be one. */
function buildObject(piece: NewPiece, id: string): LayoutObject | string {
  const kind = kindOf(piece.kind);
  if (!kind) return "Unknown kind";
  if (kind.stair !== null) return "A stair is placed on its own";
  const name = piece.name ?? kind.label;
  if (!isValidName(name)) return "Name too long";
  const sizes = piece.size ?? defaultSize(kind.id);
  if (!sizes || !validSizes(kind.id, sizes)) return "Invalid size";
  const options = piece.options === undefined ? undefined : parseOptions(piece.options, kind.options);
  if (options === null) return "Invalid options";
  return { id, kind: kind.id, name, w: { ...sizes.w }, d: { ...sizes.d }, h: { ...sizes.h }, z: { ...sizes.z }, ...(kind.arms === null ? {} : { arms: { ...kind.arms } }), ...(options === undefined ? {} : { options }) };
}
