import { assertNever, err, ok, type EntityKey, type Point, type Result } from "@fm/protocol";
import { MESSAGES, domainError, type DomainError } from "../errors";
import { GUARD_DROP, handrailFor, isHandrailKind, sameRails, type Document, type HandrailKind, type LayoutObject, type Placement } from "../model";
import { guardAt } from "../queries/guards";
import { hasOption } from "../options";
import { isValidId } from "../shape";
import { roundMm } from "../queries/footprints";
import { placementRange } from "../queries/vertical";
import { ellPartner, stairBase, stairGeometry, stairRise } from "../queries/stairs";
import { MAX_GOING, MIN_GOING, isTargetRiser } from "../stairs";
import { isObjectSize, kindOf, railShape, stairRuleOf } from "../kinds";
import { finish, givenSurface, key, placementsOf } from "./object-helpers";
import { entrySideMoved, optionChange } from "./options";
import type { CommandOf, CommandResult } from "./types";

// A stair's links change only by explicit acts (stairdraw.08). `reaches` (stairs.10): set by a command's `reaches`,
// setStairReaches or placeStair, kept through every move and rotation, cleared explicitly or when the deck goes; touching
// a deck's edge sets nothing. While linked, its height is the deck's top less its surface, rewritten here by every
// command that could change either (I19 checks it). `startsAt` (stairs.49) is kept as stored and cleared when its deck
// goes; it changes no height, only where the steps begin.

/** The object linked to `deck` (or unlinked, keeping its height), its heights from `p`'s surface. */
function linkedObject(doc: Document, object: LayoutObject, p: Placement, deck: string | null): LayoutObject {
  if (deck === null) return { ...object, reaches: null };
  const rise = stairRise(doc, deck, p.deck);
  return { ...object, reaches: deck, h: Object.fromEntries(Object.keys(object.h).map((c) => [c, rise])) };
}

/**
 * After a placement was placed or moved in `next`: an explicit `reaches` (a deck ID or null) sets the link, otherwise
 * the stair keeps its own, its height rewritten from its surface. Furniture is unchanged, and an explicit `reaches` on
 * it is refused. A new stair, or one switched to another kind, gets or drops its handrail here too (`withHandrail`): every
 * way a stair object comes to be passes through, and one that has a handrail keeps it.
 */
export function linkStair(next: Document, placementId: string, explicit: string | null | undefined): Result<Document, DomainError> {
  const p = next.placements[placementId];
  const object = p ? next.objects[p.object] : undefined;
  if (!p || !object) return ok(next);
  if (stairRuleOf(object.kind) === null) return explicit === undefined ? ok(next) : err(domainError("invalidInput", MESSAGES.onlyStairsReach));
  if (typeof explicit === "string" && !Object.hasOwn(next.decks, explicit)) return err(domainError("notFound", "Deck not found"));
  const deck = explicit !== undefined ? explicit : (object.reaches ?? null);
  // The rails are chosen on the document that holds the linked height: a new stair's rule reads its rise (knownbugs AC-04).
  const linked: Document = { ...next, objects: { ...next.objects, [object.id]: linkedObject(next, object, p, deck) } };
  const made = linked.objects[object.id];
  return ok(made ? { ...linked, objects: { ...linked.objects, [object.id]: withHandrail(linked, made) } } : linked);
}

/**
 * `object` with the rails its kind takes (guards.28, edges.06): a flight's by side, a spiral's one, none on a kind
 * without rails. Its own are kept, a spiral's one going to both sides of a flight and a flight's agreeing sides to a
 * spiral (else Railing); else its L's other flight's in `doc` (guards.33); else what a new stair gets from the guard
 * where its top arrives (`startRail`). A new stair, and one switched to another kind, come through here.
 */
export function withHandrail(doc: Document, object: LayoutObject): LayoutObject {
  const plain: LayoutObject = { ...object };
  delete plain.handrail;
  delete plain.handrails;
  const shape = railShape(object.kind);
  switch (shape) {
    case null:
      return plain;
    case "spiral": {
      const sides = object.handrails;
      const kind = object.handrail ?? (sides === undefined ? startRail(doc, object) : sides.left === sides.right ? sides.left : "railing");
      return { ...plain, handrail: kind };
    }
    case "flight": {
      if (object.handrails !== undefined) return { ...plain, handrails: object.handrails };
      if (object.handrail !== undefined) return { ...plain, handrails: sameRails(object.handrail) };
      const partner = otherFlight(doc, object)?.handrails;
      return { ...plain, handrails: partner ?? sameRails(startRail(doc, object)) };
    }
    default:
      return assertNever(shape);
  }
}

/**
 * The rail a new stair starts with (guards.28, edges.09): None when it rises no more than a platform that wants no guard
 * (GUARD_DROP, steps.16); else Glass where its top arrives on a Glass side or hole of the deck it reaches, else Railing;
 * Railing reaching nothing.
 */
export function startRail(doc: Document, object: LayoutObject): HandrailKind {
  const p = doc.placements[placementsOf(doc, object.id)[0] ?? ""];
  return railFor(doc, typeof object.reaches === "string" ? object.reaches : null, p?.at ?? null, p ? stairRiseOf(doc, p.id) : null);
}

/**
 * The one rule for a new stair's rail (steps.16): None rising no more than GUARD_DROP, as a platform that low wants no
 * guard; else the rail its top arrives on at `at` on `deck` (Glass on a Glass side or hole), else Railing.
 */
export function railFor(doc: Document, deck: string | null, at: Point | null, rise: number | null): HandrailKind {
  if (rise !== null && rise <= GUARD_DROP + 1e-9) return "none";
  return handrailFor(deck !== null && at !== null ? guardAt(doc, deck, at) : null);
}

/** The rise a placed stair's steps count, from where they begin to its top (stairs.49), or null without a range. */
function stairRiseOf(doc: Document, placementId: string): number | null {
  const range = placementRange(doc, placementId);
  const base = stairBase(doc, placementId);
  return range && base !== null ? range.top - base : null;
}

/** What a stair's links depend on: the object, its placements, the decks it reaches and starts at; nothing for furniture. */
export function stairDeps(doc: Document, objectId: string): EntityKey[] {
  const object = doc.objects[objectId];
  if (!object || stairRuleOf(object.kind) === null) return []; // furniture: nothing, and no sort of every placement
  const decks = [object.reaches, object.startsAt].flatMap((d) => (typeof d === "string" ? [key("decks", d)] : []));
  return [key("objects", objectId), ...placementsOf(doc, objectId).map((id) => key("placements", id)), ...decks];
}

export function setStairReaches(doc: Document, cmd: CommandOf<"setStairReaches">): CommandResult {
  const object = isValidId(cmd.objectId) ? doc.objects[cmd.objectId] : undefined;
  if (!object) return err(domainError("notFound", "Object not found"));
  if (stairRuleOf(object.kind) === null) return err(domainError("invalidInput", MESSAGES.onlyStairsReach));
  const deck = givenSurface(doc, cmd.deck);
  if (deck === undefined) return err(domainError("notFound", "Deck not found"));
  const p = doc.placements[placementsOf(doc, object.id)[0] ?? ""];
  if (!p) return err(domainError("notFound", "Placement not found"));
  const next = { ...doc, objects: { ...doc.objects, [object.id]: linkedObject(doc, object, p, deck) } };
  return finish(doc, next, [...stairDeps(doc, object.id), ...(deck === null ? [] : [key("decks", deck)])]);
}

/**
 * A stair's target riser, keeping the run so the footprint can't move (riser.02), and its going, setting the run from
 * the count that target gives: both together are one edit. Its handrail (guards.28) goes with them, on a kind with rails,
 * and to an L's other flight too (guards.33), so the L keeps one value; its riser and going stay on this flight.
 */
export function setStair(doc: Document, cmd: CommandOf<"setStair">): CommandResult {
  const object = isValidId(cmd.objectId) ? doc.objects[cmd.objectId] : undefined;
  if (!object) return err(domainError("notFound", "Object not found"));
  const rule = stairRuleOf(object.kind);
  if (rule === null) return err(domainError("invalidInput", MESSAGES.onlyStairsStep));
  if (cmd.riser !== undefined && cmd.riser !== null && !isTargetRiser(cmd.riser)) return err(domainError("invalidInput", MESSAGES.targetRiser));
  if (cmd.going !== undefined && rule.shape === "spiral") return err(domainError("invalidInput", MESSAGES.spiralGoing));
  if (cmd.going !== undefined && !(cmd.going >= MIN_GOING && cmd.going <= MAX_GOING)) return err(domainError("invalidInput", MESSAGES.stairGoing));
  const rails = railPatch(object, cmd);
  if (typeof rails === "string") return err(domainError("invalidInput", rails));
  const first = placementsOf(doc, object.id)[0] ?? "";
  const range = placementRange(doc, first);
  const base = stairBase(doc, first);
  if (!range || base === null) return err(domainError("notFound", "Placement not found"));
  const target = cmd.riser === undefined ? (object.riser ?? null) : cmd.riser;
  const plain: LayoutObject = { ...object };
  delete plain.riser;
  const railed: LayoutObject = rails(plain);
  const aimed: LayoutObject = target === null ? railed : { ...railed, riser: target };
  // A winder's entry and a ladder's hooks (steps.07): through the one option writer, refused on a kind without them.
  let targeted: LayoutObject = aimed;
  for (const [option, on] of [["leftEntry", cmd.leftEntry], ["hooks", cmd.hooks]] as const) {
    if (on === undefined) continue;
    if (typeof on !== "boolean") return err(domainError("invalidInput", "Invalid option")); // built from JSON
    const changed = optionChange(targeted, option, on);
    if (!changed.ok) return changed;
    targeted = changed.value;
  }
  const going = cmd.going;
  // The run a going gives, from the geometry (steps.09): a winder keeps its front square, so it reads the width too.
  const runFor = (c: string, g: number): number => stairGeometry(rule, object.w[c] ?? 0, 1, range.top - base, target).runFor(g);
  const next: LayoutObject = going === undefined ? targeted : { ...targeted, d: Object.fromEntries(Object.keys(object.d).map((c) => [c, roundMm(runFor(c, going))])) };
  if (Object.values(next.d).some((d) => !isObjectSize(d))) return err(domainError("invalidInput", MESSAGES.objectSize));
  const partner = otherFlight(doc, object);
  const both = partner !== undefined && railShape(partner.kind) === "flight" ? { [partner.id]: railPatchOrSame(partner, cmd) } : {};
  const written: Document = { ...doc, objects: { ...doc.objects, [object.id]: next, ...both } };
  // A new entry side takes its use zones with it (steps.39); the side it already has moves nothing.
  const moved = hasOption(next, "leftEntry") !== hasOption(object, "leftEntry") ? entrySideMoved(written, object.id) : written;
  return finish(doc, moved, stairDeps(doc, object.id));
}

/**
 * What setStair's rails do to `object` (edges.06), or the refusal: `handrail` sets a spiral's one or both sides of a
 * flight, `handrailLeft` and `handrailRight` a flight's side; a kind without rails refuses any of them.
 */
function railPatch(object: LayoutObject, cmd: CommandOf<"setStair">): ((o: LayoutObject) => LayoutObject) | string {
  const given = [cmd.handrail, cmd.handrailLeft, cmd.handrailRight].filter((v) => v !== undefined);
  if (given.length === 0) return (o) => o;
  if (!given.every(isHandrailKind)) return MESSAGES.handrail;
  const shape = railShape(object.kind);
  if (shape === null) return MESSAGES.noHandrail(kindOf(object.kind)?.label ?? object.kind);
  if (shape === "spiral") {
    if (cmd.handrailLeft !== undefined || cmd.handrailRight !== undefined) return MESSAGES.spiralSides;
    return (o) => (cmd.handrail === undefined ? o : { ...o, handrail: cmd.handrail });
  }
  return (o) => {
    const now = o.handrails ?? sameRails("railing");
    const all = cmd.handrail;
    return { ...o, handrails: { left: cmd.handrailLeft ?? all ?? now.left, right: cmd.handrailRight ?? all ?? now.right } };
  };
}

/** `object` with setStair's rails applied, or as it is: an L's other flight follows the side set (guards.34, edges.06). */
function railPatchOrSame(object: LayoutObject, cmd: CommandOf<"setStair">): LayoutObject {
  const patch = railPatch(object, cmd);
  return typeof patch === "string" ? object : patch(object);
}

/** The other flight of `object`'s L in `doc` (guards.33), if it is one: its rails are the L's, side by side. */
function otherFlight(doc: Document, object: LayoutObject): LayoutObject | undefined {
  const id = ellPartner(doc, object);
  return id === null ? undefined : doc.objects[id];
}

/** Every stair that reaches deck `id` or stands on it, its height rewritten after the deck changed in `next`. */
export function relinkStairs(next: Document, id: string): Document {
  const objects = { ...next.objects };
  for (const object of Object.values(next.objects)) {
    if (stairRuleOf(object.kind) === null || typeof object.reaches !== "string") continue;
    const p = next.placements[placementsOf(next, object.id)[0] ?? ""];
    if (p && (object.reaches === id || p.deck === id)) objects[object.id] = linkedObject(next, object, p, object.reaches);
  }
  return { ...next, objects };
}

/** The stairs that reached or started at a deleted deck, unlinked from it with their heights kept. */
export function unlinkStairs(next: Document, deleted: ReadonlySet<string>): Document {
  const objects = { ...next.objects };
  const gone = (d: string | null | undefined): boolean => typeof d === "string" && deleted.has(d);
  for (const object of Object.values(next.objects)) {
    if (gone(object.reaches) || gone(object.startsAt)) {
      objects[object.id] = { ...object, ...(gone(object.reaches) ? { reaches: null } : {}), ...(gone(object.startsAt) ? { startsAt: null } : {}) };
    }
  }
  return { ...next, objects };
}
