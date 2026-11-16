import { assertNever, err, ok, type EntityKey, type Result } from "@fm/protocol";
import { MESSAGES, STAIR_EDGE_MESSAGES, domainError, type DomainError } from "../errors";
import { kindOf, railShape, type Sides } from "../kinds";
import { isHandrailKind, sameRails, type Document, type HandrailKind, type LayoutObject } from "../model";
import { withOption } from "../options";
import { isValidId } from "../shape";
import { clearanceWarnings } from "../queries/clearance";
import { STAIR_LANDING, stairOnEdge, type StairParts } from "../queries/stair-edge";
import { stairRise } from "../queries/stairs";
import { addDeck, freeName } from "./decks";
import { finish, key } from "./object-helpers";
import { railFor } from "./stairs";
import { placeObject } from "./objects";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";

// placeStair (stairdraw.18, .20): the stair stairOnEdge gives for a point on a deck's edge, each flight placed through
// placeObject with its `reaches` explicit, so fit, I19 and syncLinkedCopies apply as to any stair, in one patch.
// An L's landing is added first, as the deck `${opId}/k0` (solid, named "Landing"); flight i is placed with the opId
// `${opId}/s${i}`, so its object is `${opId}/s${i}/o0`. The parts are plain (stairdraw.04): only their links to the landing tie them, which setStair's
// handrail follows (guards.33).
// Every flight takes the stair's one handrail, given or from the deck it goes up to (guards.28), an L's lower flight too.

/** A part's opId suffix ("/s0") still has to fit the created IDs' cap. */
const PART_SUFFIX = 3;
/** The L's landing deck's name (spec "The L"). */
const LANDING_NAME = "Landing";

export function placeStair(doc: Document, cmd: CommandOf<"placeStair">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH - PART_SUFFIX) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (cmd.handrail !== undefined && !isHandrailKind(cmd.handrail)) return err(domainError("invalidInput", MESSAGES.handrail));
  const parts = stairOnEdge(doc, cmd);
  if (parts.ok) return placeParts(doc, cmd.opId, cmd.state, parts.value, cmd.handrail ?? null);
  return err(domainError("invalidInput", STAIR_EDGE_MESSAGES[parts.error](kindOf(cmd.kind)?.label ?? "This kind")));
}

/**
 * Whether `parts` pass the fit the commit runs (stairdraw.19): they are placed as placeStair places them, under an
 * opId the document doesn't use, so the preview can't disagree with the commit. Ok, or the commit's refusal.
 */
export function stairFits(doc: Document, parts: StairParts, state: string): Result<null, DomainError> {
  const placed = placeParts(doc, unusedOpId(doc, "fit"), state, parts);
  return placed.ok ? ok(null) : err(placed.error);
}

/**
 * Whether the stair `parts` would place keeps its own use zones free in `state` (stairdraw.60): placed as placeStair
 * places them, no zone of its flights overlaps a wall or a piece there (clearanceWarnings). Zones are warnings, never
 * refusals (smart.08); a fix chip prefers an L whose zones are free. False when the parts don't fit.
 */
export function stairZonesFree(doc: Document, parts: StairParts, state: string): boolean {
  const opId = unusedOpId(doc, "zones");
  const placed = placeParts(doc, opId, state, parts);
  if (!placed.ok) return false;
  const after = placed.value.doc;
  const ours = (id: string): boolean => after.placements[id]?.object.startsWith(`${opId}/`) ?? false;
  return !clearanceWarnings(after, state).some((w) => w.zone.table === "placements" && ours(w.zone.id));
}

/** `base`, else `base1`, `base2`… : an opId the document doesn't use, for a probe that is never committed. */
function unusedOpId(doc: Document, base: string): string {
  let opId = base;
  for (let n = 1; opIdUsed(doc, opId); n++) opId = `${base}${n}`;
  return opId;
}

/**
 * The landing (if any), then every flight placed in `state` (and so in every layout), its STAIR_LANDING links pointing
 * at the landing, each with `handrail` on a kind with rails (null: the one its own deck gives, for a probe), as one
 * patch, validated whole; refused whole if any part fails.
 */
function placeParts(doc: Document, opId: string, state: string, parts: StairParts, handrail: HandrailKind | null = null): CommandResult {
  // Every flight takes the rail the top one arrives on (guards.28, edges.09): an L's lower flight reaches its landing.
  const top = parts.flights.find((f) => f.reaches !== STAIR_LANDING);
  const rail = handrail ?? (top ? railFor(doc, top.reaches, top.at, stairRise(doc, top.reaches, parts.surface)) : railFor(doc, null, null, null));
  let next = doc;
  const deps: EntityKey[] = [];
  let landingId: string | null = null;
  if (parts.landing !== null) {
    const added = addDeck(next, { type: "addDeck", opId, preset: "platform", ...parts.landing, solid: true, name: freeName(next, LANDING_NAME) });
    if (!added.ok) return added;
    next = added.value.doc;
    deps.push(...added.value.patch.dependencies);
    landingId = `${opId}/k0`;
  }
  const deckOf = (id: string): string => (id === STAIR_LANDING && landingId !== null ? landingId : id);
  for (const [i, f] of parts.flights.entries()) {
    const placed = placeObject(next, {
      type: "placeObject", opId: `${opId}/s${i}`, state, object: { kind: parts.kind, size: { w: f.w, d: f.d } }, at: f.at, rotation: f.rotation, deck: parts.surface, reaches: deckOf(f.reaches),
    });
    if (!placed.ok) return placed;
    next = placed.value.doc;
    deps.push(...placed.value.patch.dependencies);
    const objectId = `${opId}/s${i}/o0`;
    if (f.sides !== null) next = withSides(next, objectId, f.sides);
    const flight = next.objects[objectId];
    const railed = flight === undefined ? undefined : withRail(flight, rail);
    // A winder by a wall enters from the left (steps.39): its sides came with the flight, its option goes on here.
    const object = railed !== undefined && f.leftEntry ? withOption(railed, "leftEntry", true) : railed;
    if (object !== undefined) next = { ...next, objects: { ...next.objects, [objectId]: object } };
    if (f.startsAt !== null && object !== undefined) {
      // Only the L sets where a flight's steps begin (stairdraw.08); I19 checks it in the whole patch's validation below.
      const startsAt = deckOf(f.startsAt);
      next = { ...next, objects: { ...next.objects, [objectId]: { ...object, startsAt } } };
      deps.push(key("decks", startsAt));
    }
  }
  return finish(doc, next, deps);
}

/** `doc` with every copy of the stair `objectId` given `sides` (a spiral's entry side, stairdraw.15), in every layout. */
function withSides(doc: Document, objectId: string, sides: Sides): Document {
  const placements = { ...doc.placements };
  for (const p of Object.values(doc.placements)) if (p.object === objectId) placements[p.id] = { ...p, sides: { ...sides } };
  return { ...doc, placements };
}

/** `object` with `rail` on every side its kind has (edges.06); a kind without rails as it is. */
function withRail(object: LayoutObject, rail: HandrailKind): LayoutObject {
  const shape = railShape(object.kind);
  switch (shape) {
    case "flight": return { ...object, handrails: sameRails(rail) };
    case "spiral": return { ...object, handrail: rail };
    case null: return object;
    default: return assertNever(shape);
  }
}
