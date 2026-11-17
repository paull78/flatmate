import type { Point } from "@fm/protocol";
import { inConvex, pointInPolygon } from "../geometry";
import { EPS, GUARD_DROP, type Document } from "../model";
import { insideDeck, onSlab, overHole, type DeckView } from "./decks";
import { deckRing } from "./footprints";
import { faceAt } from "./zones";

// Whether a piece stands on the deck it names (steps.06, .11): the one owner, read by validation (I10) and by the
// preview (`footprintFit`), so they agree. On a loft it lies inside the deck, as always (decks.11). On a platform, a
// deck no higher than GUARD_DROP, it may overhang the edge:
//
//          room ─────────────────────────────┐
//            ┌──── deck grown by 0.30 ───┐    │   in order: no part over a hole; the centre on the slab;
//            │   ┌──── platform ────┐    │    │   inside the deck grown by 0.30 m in its own frame;
//            │   │      ●centre     │    │    │   every corner off the deck in the centre's room.
//            │   └──────────────────┘    │    │   What is under the overhang is the height tests' (fit.ts).
//            └───────────────────────────┘    │

/** How far a piece may reach past a platform's edge, measured in the deck's own frame. */
export const OVERHANG = 0.3;
/** The highest deck a piece may overhang: a platform that wants no guard (model.ts). */
export const PLATFORM_TOP = GUARD_DROP;

/** Why a piece doesn't stand on a deck, by the first rule it breaks, or null when it does. */
export type DeckStanding = null | "overHole" | "deckCentre" | "deckReach" | "deckRoom" | "outsideDeck" | "floorOnly";

/** Whether a shape, as its convex `parts` with its footprint's `centre`, stands on `deck` (see above). */
export function deckStanding(doc: Document, deck: DeckView, parts: readonly (readonly Point[])[], centre: Point | null): DeckStanding {
  if (overHole(deck, parts)) return "overHole";
  if (insideDeck(deck, parts)) return null;
  if (deck.top > PLATFORM_TOP + EPS) return "outsideDeck";
  if (centre === null || !onSlab(deck, centre)) return "deckCentre";
  const grown = deckRing({ at: deck.at, w: deck.w + 2 * OVERHANG, d: deck.d + 2 * OVERHANG, rotation: deck.rotation });
  if (!parts.every((ring) => ring.every((p) => inConvex(p, grown, EPS)))) return "deckReach";
  const room = faceAt(doc, centre);
  const off = parts.flatMap((ring) => ring.filter((p) => !inConvex(p, deck.ring, EPS)));
  return room !== null && off.every((p) => pointInPolygon(p, room.ring)) ? null : "deckRoom";
}
