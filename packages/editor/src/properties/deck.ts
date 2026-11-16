import { PLAN_SIDES, deckView, isGuard, isPlanSide, sideAt, sideField, type Command, type Deck, type Document, type PlanSide, shown } from "@fm/domain";
import { field, guardFields, numberField, parseNumber, type FieldCommand, type Properties, holeRows } from "./fields";
import type { Field } from "../view/view-model-types";
import { deckFinishFieldCommand, deckFinishFields } from "./zone-finish";

// A deck's Properties (spec "The Deck tool and editing", decks.06): Name, Top (its absolute top), Solid, Width, Depth and
// Rotation, then a Guards group with a kind and a height for each side, named by where it faces on the plan now
// (edges.05), each typed value one setDeck. A typed size keeps the centre. The preset is only the Deck tool's
// default and is not shown. The domain refuses what I18 forbids, with its text.

const SECTION = "Deck";
const GUARDS = "Guards";
const SIDE_LABELS: Record<PlanSide, string> = { upper: "Upper", right: "Right", lower: "Lower", left: "Left" };

export function deckFields(doc: Document, deckId: string): Properties {
  const deck = deckView(doc, deckId);
  if (!deck) return { kind: "none" };
  return {
    kind: "deck",
    fields: [
      field(SECTION, "name", "Name", deck.name, null, false),
      numberField(SECTION, "top", "Top", shown(deck.top), "m", 0.01),
      { ...field(SECTION, "solid", "Solid", String(deck.solid), null, false), toggle: true },
      numberField(SECTION, "width", "Width", shown(deck.w), "m", 0.01),
      numberField(SECTION, "depth", "Depth", shown(deck.d), "m", 0.01),
      numberField(SECTION, "rotation", "Rotation", String(deck.rotation), "°", 1),
      ...holeRows(SECTION, "Holes", deck.holes),
      ...deckFinishFields(doc, deckId), // its floor finish, as a room's (deck-floors.02)
      ...guardRows(deck),
    ],
  };
}

/** The Guards group: each side by its plan name, its kind and its height; a None side's height is kept but read-only. */
function guardRows(deck: Deck): Field[] {
  return PLAN_SIDES.flatMap((name) => {
    return guardFields(GUARDS, `guard.${name}`, `guardHeight.${name}`, SIDE_LABELS[name], deck[sideField(sideAt(deck, name))]);
  });
}

/** A Guards row's command: `guard.<side>` sets that side's kind, `guardHeight.<side>` its height; null for any other field. */
function guardFieldCommand(doc: Document, deckId: string, fieldId: string, value: string): FieldCommand | undefined {
  const [what, name] = fieldId.split(".");
  if ((what !== "guard" && what !== "guardHeight") || !isPlanSide(name)) return undefined;
  const deck = deckView(doc, deckId);
  if (!deck) return null;
  const side = sideField(sideAt(deck, name));
  if (what === "guard") return isGuard(value) ? { type: "setDeck", deckId, [side]: { kind: value } } : null; // a value no choice offers is ignored
  return typed(value, (height) => ({ type: "setDeck", deckId, [side]: { height } }));
}

export function deckFieldCommand(doc: Document, deckId: string, fieldId: string, value: string): FieldCommand {
  const guard = guardFieldCommand(doc, deckId, fieldId, value);
  if (guard !== undefined) return guard;
  switch (fieldId) {
    case "name":
      return { type: "setDeck", deckId, name: value };
    case "solid":
      return value === "true" || value === "false" ? { type: "setDeck", deckId, solid: value === "true" } : null;
    case "top":
      return typed(value, (top) => ({ type: "setDeck", deckId, top }));
    case "width":
      return typed(value, (w) => ({ type: "setDeck", deckId, w }));
    case "depth":
      return typed(value, (d) => ({ type: "setDeck", deckId, d }));
    case "rotation":
      return typed(value, (rotation) => ({ type: "setDeck", deckId, rotation }));
    default:
      return deckFinishFieldCommand(doc, deckId, fieldId, value);
  }
}

/** A typed number's command, or "notANumber". */
function typed(value: string, command: (v: number) => Command): FieldCommand {
  const v = parseNumber(value);
  return Number.isFinite(v) ? command(v) : "notANumber";
}
