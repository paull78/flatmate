import type { Point } from "@fm/protocol";
import type { Document } from "../model";
import { deckViews, overSlab } from "./decks";
import { roundMm } from "./footprints";
import { ceilingOver, surfaceTop } from "./vertical";

// The room over a footprint (clarity.06, .11), apart from vertical.ts because it reads a deck's slab, and decks.ts
// reads vertical.ts.

/** How tall a piece can stand: `room`, in metres to the millimetre, and the deck that limits it (null: the ceiling). */
export type RoomOver = { room: number; under: string | null };

/**
 * The room over a shape standing on `surface` (a deck's ID, or null for the floor): `ring` its outline, `parts` its
 * convex parts. Every other deck over the parts counts, even one below the piece, because fit refuses a piece above an
 * underside it overlaps (`deckClash`): a solid deck's bottom is 0, so its room is 0 or less. Another piece doesn't count.
 */
export function roomOver(doc: Document, parts: readonly (readonly Point[])[], ring: readonly Point[], surface: string | null): RoomOver {
  let lowest = ceilingOver(doc, ring);
  let under: string | null = null;
  for (const deck of deckViews(doc)) {
    if (deck.id !== surface && deck.range.bottom < lowest && parts.some((part) => overSlab(deck, part))) {
      lowest = deck.range.bottom;
      under = deck.id;
    }
  }
  return { room: roundMm(lowest - surfaceTop(doc, surface)), under };
}
