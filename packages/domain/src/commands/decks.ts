import { deepEqual, err, ok } from "@fm/protocol";
import { relinkStairs, stairDeps } from "./stairs";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { CEILING_ID, DECK_SIDES, guardFor, isGuard, isGuardHeight, sameGuards, sideField, type Deck, type DeckGuardField, type Document, type GuardValue } from "../model";
import { diffPatch } from "../patch";
import { DECK_PRESETS, DEFAULT_DECK_SIZE, isDeckPreset } from "../presets";
import { rotateAbout } from "../geometry";
import { carriedBy, deckLabel } from "../queries/decks";
import { roundMm } from "../queries/footprints";
import { isFiniteNumber, isValidId, isValidName } from "../shape";
import { lockDeck } from "./deck-lock";
import { finish, key, placementDeps, validPoint } from "./object-helpers";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";

// Deck commands (spec "The deck", decks.13, .16). Presets, defaults and names resolve here; I18 (validateDocument)
// makes every refusal of a well-formed value.

type DeckFields = Partial<Omit<Deck, "id" | DeckGuardField>>;
type DeckGuards = Pick<Deck, DeckGuardField>;

export const GUARD_KIND_TEXT = "Invalid guard: railing, glass or none";
export const GUARD_HEIGHT_TEXT = "Guard height must be 0.30 to 1.10 m";

/** A guard with `patch` applied (its kind, its height to the millimetre, the rest kept), or the refusal's text. */
export function patchedGuard(value: GuardValue, patch: unknown): GuardValue | string {
  if (patch === undefined) return value;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return GUARD_KIND_TEXT;
  const kind: unknown = "kind" in patch ? patch.kind : undefined;
  const height: unknown = "height" in patch ? patch.height : undefined;
  if (kind !== undefined && !isGuard(kind)) return GUARD_KIND_TEXT;
  if (height !== undefined && !(isFiniteNumber(height) && isGuardHeight(roundMm(height)))) return GUARD_HEIGHT_TEXT;
  return { kind: kind ?? value.kind, height: height === undefined ? value.height : roundMm(height) };
}

/** A deck's four guards after a command's `guard` (every side's kind) and per-side patches, or the refusal's text. */
function patchedGuards(base: DeckGuards, f: { guard?: unknown } & { [F in DeckGuardField]?: unknown }): DeckGuards | string {
  const all: unknown = f.guard;
  if (all !== undefined && !isGuard(all)) return GUARD_KIND_TEXT;
  const out: DeckGuards = { guardFront: base.guardFront, guardRight: base.guardRight, guardBack: base.guardBack, guardLeft: base.guardLeft };
  for (const side of DECK_SIDES) {
    const field = sideField(side);
    const value = patchedGuard(all === undefined ? base[field] : { ...base[field], kind: all }, f[field]);
    if (typeof value === "string") return value;
    out[field] = value;
  }
  return out;
}

/**
 * The fields given, checked for their types and kept to the millimetre, the rotation to whole degrees 0–359
 * (decks.21), or the refusal's text. Commands arrive as JSON from MCP and the editor.
 */
function cleanFields(f: DeckFields): DeckFields | string {
  const out: DeckFields = {};
  const name: unknown = f.name;
  if (name !== undefined) {
    if (typeof name !== "string") return "Invalid name";
    if (!isValidName(name)) return "Name too long";
    out.name = name;
  }
  if (f.at !== undefined) {
    if (!validPoint(f.at)) return "Invalid position";
    out.at = { x: roundMm(f.at.x), y: roundMm(f.at.y) };
  }
  for (const side of ["w", "d"] as const) {
    const v: unknown = f[side];
    if (v === undefined) continue;
    if (!isFiniteNumber(v)) return "Invalid size";
    out[side] = roundMm(v);
  }
  const rotation: unknown = f.rotation;
  if (rotation !== undefined) {
    if (!isFiniteNumber(rotation)) return "Invalid rotation";
    out.rotation = ((Math.round(rotation) % 360) + 360) % 360;
  }
  const top: unknown = f.top;
  if (top !== undefined) {
    if (!isFiniteNumber(top)) return "Invalid height";
    out.top = roundMm(top);
  }
  const solid: unknown = f.solid;
  if (solid !== undefined) {
    if (typeof solid !== "boolean") return "Invalid solid flag";
    out.solid = solid;
  }
  return out;
}

/** The preset's name, or the first "Loft 2", "Loft 3"… no deck has (spec "The deck"). */
export function freeName(doc: Document, base: string): string {
  const taken = new Set(Object.values(doc.decks).map((d) => d.name));
  let n = 2;
  if (!taken.has(base)) return base;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A deck's I18 reads every wall and the ceiling: a concurrent change to either conflicts. */
function deckDeps(doc: Document, deckId: string): EntityKey[] {
  return [key("decks", deckId), key("ceilings", CEILING_ID), ...Object.keys(doc.walls).map((id) => key("walls", id))];
}

/**
 * Adds a deck `${opId}/k0` from a preset: its name (numbered when taken), top and solid flag, 2.00 × 1.40 m,
 * unrotated; any field given overrides the preset's, so MCP adds a custom deck in one edit.
 */
export function addDeck(doc: Document, cmd: CommandOf<"addDeck">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  const preset: unknown = cmd.preset;
  if (!isDeckPreset(preset)) return err(domainError("invalidInput", "Unknown deck preset"));
  const fields = cleanFields(cmd);
  if (typeof fields === "string") return err(domainError("invalidInput", fields));
  if (!fields.at) return err(domainError("invalidInput", "Invalid position"));
  const defaults = DECK_PRESETS[preset];
  const guards = patchedGuards(sameGuards(guardFor(fields.top ?? defaults.top)), cmd);
  if (typeof guards === "string") return err(domainError("invalidInput", guards));
  const id = `${cmd.opId}/k0`;
  const deck: Deck = {
    id,
    name: fields.name ?? freeName(doc, defaults.name),
    at: fields.at,
    w: fields.w ?? DEFAULT_DECK_SIZE.w,
    d: fields.d ?? DEFAULT_DECK_SIZE.d,
    rotation: fields.rotation ?? 0,
    top: fields.top ?? defaults.top,
    solid: fields.solid ?? defaults.solid,
    finish: null,
    ...guards,
  };
  return finish(doc, { ...doc, decks: { ...doc.decks, [id]: deck } }, deckDeps(doc, id));
}

/**
 * Sets any of a deck's fields; the rest keep their values (decks.13). A move (a new centre at the same size) carries
 * every piece standing on the deck, in every layout, by the same delta, its anchor kept to the millimetre; a resize,
 * even one that shifts the centre (a side grip), and a new top keep them in place on the plan. Its holes follow a move
 * and a turn and stay put on a resize. A move, resize or turn is refused while a wall or column references the deck
 * (deck-lock.ts), and a turn while it carries a piece. Validation refuses whatever then breaks a rule.
 */
export function setDeck(doc: Document, cmd: CommandOf<"setDeck">): CommandResult {
  const deck = isValidId(cmd.deckId) ? doc.decks[cmd.deckId] : undefined;
  if (!deck) return err(domainError("notFound", "Deck not found"));
  const fields = cleanFields(cmd);
  if (typeof fields === "string") return err(domainError("invalidInput", fields));
  const guards = patchedGuards(deck, cmd);
  if (typeof guards === "string") return err(domainError("invalidInput", guards));
  const next: Deck = { ...deck, ...fields, ...guards };
  const carried = carriedBy(doc, deck.id);
  const holes = Object.values(doc.deckHoles).filter((h) => h.deck === deck.id);
  const deps = [...deckDeps(doc, deck.id), ...carried.flatMap(placementDeps), ...holes.map((h) => key("deckHoles", h.id))];
  if (deepEqual(next, deck)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  // A row standing on the deck or reaching up to it locks its place, size and turn, named before any piece (pillars.23).
  const reshaped = next.at.x !== deck.at.x || next.at.y !== deck.at.y || next.w !== deck.w || next.d !== deck.d || next.rotation !== deck.rotation;
  const held = reshaped ? lockDeck(doc, deck.id) : null;
  if (held) return err(held);
  const first = carried[0];
  if (first && next.rotation !== deck.rotation) {
    const text = MESSAGES.deckCarries(deckLabel(deck), doc.objects[first.object]?.name || "Object", doc.states[first.state]?.name || "a layout");
    return err(domainError("invalid", text));
  }
  const moved = next.w === deck.w && next.d === deck.d && (next.at.x !== deck.at.x || next.at.y !== deck.at.y);
  const placements = { ...doc.placements };
  if (moved) {
    const dx = next.at.x - deck.at.x;
    const dy = next.at.y - deck.at.y;
    for (const p of carried) placements[p.id] = { ...p, at: { x: roundMm(p.at.x + dx), y: roundMm(p.at.y + dy) } };
  }
  // Its holes follow it (stairwell.34): a move or a turn at the same size carries them rigidly, their sides staying
  // along its axes; a resize keeps them on the plan, and I22 refuses one it leaves outside.
  const deckHoles = { ...doc.deckHoles };
  if (next.w === deck.w && next.d === deck.d) {
    for (const h of holes) {
      const p = rotateAbout(h.at, deck.at, next.rotation - deck.rotation);
      deckHoles[h.id] = { ...h, at: { x: roundMm(p.x + next.at.x - deck.at.x), y: roundMm(p.y + next.at.y - deck.at.y) } };
    }
  }
  // Stairs reaching the deck or standing on it follow its top (stairs.10), checked with the rest.
  const after = relinkStairs({ ...doc, decks: { ...doc.decks, [deck.id]: next }, placements, deckHoles }, deck.id);
  return finish(doc, after, [...deps, ...Object.keys(after.objects).filter((id) => after.objects[id] !== doc.objects[id]).flatMap((id) => stairDeps(after, id))]);
}
