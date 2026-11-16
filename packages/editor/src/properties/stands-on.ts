import { deckUnder, deckView, placementCentre, type Command, type DeckView, type Document, type Placement } from "@fm/domain";
import { deckTitle } from "../view/deck-label";
import type { Field } from "../view/view-model-types";
import { field } from "./fields";

// A piece's "Stands on" (spec "The Deck tool and editing", decks.11, .16): the floor, or the deck under its centre,
// "Loft +2.15". Choosing one moves it there in place; a refusal toasts and keeps the surface. Only the domain names
// the decks (deckUnder, deckView), so a piece lists at most the floor and one deck, plus the one it stands on.

const FLOOR = "floor"; // never a deck's ID, which always holds a "/" (`${opId}/k0`)

/** The decks the piece may stand on: the one under its centre, and the one it stands on if that is another. */
function surfaces(doc: Document, p: Placement): DeckView[] {
  const centre = placementCentre(doc, p);
  const under = centre ? deckUnder(doc, centre) : null;
  const current = p.deck === null ? null : deckView(doc, p.deck);
  return [...(current && current.id !== under?.id ? [current] : []), ...(under ? [under] : [])];
}

/** A drop-down of Floor and the decks, on the one it stands on; read-only "Floor" when no deck is near. */
export function standsOnField(doc: Document, p: Placement): Field {
  const decks = surfaces(doc, p);
  if (decks.length === 0) return field("Placement", "standsOn", "Stands on", "Floor", null);
  const options = [{ value: FLOOR, label: "Floor" }, ...decks.map((d) => ({ value: d.id, label: deckTitle(d) }))];
  return { ...field("Placement", "standsOn", "Stands on", p.deck ?? FLOOR, null, false), select: true, options };
}

/** The piece moved onto the chosen surface where it is: `movePlacement` with its own place. Null for a surface not offered. */
export function standsOnCommand(doc: Document, p: Placement, value: string): Command | null {
  const deck = value === FLOOR ? null : surfaces(doc, p).find((d) => d.id === value)?.id;
  return deck === undefined ? null : { type: "movePlacement", placementId: p.id, at: p.at, rotation: p.rotation, deck };
}
