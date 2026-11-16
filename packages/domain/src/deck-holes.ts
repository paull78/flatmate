import type { EntityKey } from "@fm/protocol";
import { MESSAGES, type Violation } from "./errors";
import { EPS, type Document } from "./model";
import { MIN_DECK_SIZE } from "./presets";
import { deckLabel, deckViews, holeRect } from "./queries/decks";

// I22, a hole's own rules (stairwell.04, .20), beside decks.ts' I18: its deck exists; each side at least the deck's
// minimum; it lies in its deck's rectangle (it may reach the edge, a notch); it overlaps no other hole of its deck
// (touching is fine). What a hole does to pieces, rows and stairs is the slab's (queries/decks.ts).

const holeKey = (id: string): EntityKey => ({ table: "deckHoles", id });

/** I22 for every hole, by deck and then by ID; each overlapping pair once, under the lower ID. */
export function deckHoleViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const deck of deckViews(doc)) {
    const name = deckLabel(deck);
    const rects = deck.holes.map((h) => ({ id: h.id, r: holeRect(deck, h) }));
    rects.forEach(({ id, r }, i) => {
      seen.add(id);
      const v = (message: string, entities: EntityKey[] = [holeKey(id), { table: "decks", id: deck.id }]): void => void out.push({ invariant: "I22", message, entities });
      if (r.x1 - r.x0 < MIN_DECK_SIZE - EPS || r.y1 - r.y0 < MIN_DECK_SIZE - EPS) return v(MESSAGES.holeSizes);
      if (r.x0 < -deck.w / 2 - EPS || r.x1 > deck.w / 2 + EPS || r.y0 < -deck.d / 2 - EPS || r.y1 > deck.d / 2 + EPS) v(MESSAGES.holeOutside(name));
      for (const other of rects.slice(i + 1)) {
        const o = other.r;
        if (r.x0 < o.x1 - EPS && r.x1 > o.x0 + EPS && r.y0 < o.y1 - EPS && r.y1 > o.y0 + EPS) v(MESSAGES.holesOverlap(name), [holeKey(id), holeKey(other.id)]);
      }
    });
  }
  // A hole whose deck is gone: deckViews never lists it.
  for (const [id, h] of Object.entries(doc.deckHoles)) if (!seen.has(id)) out.push({ invariant: "I22", message: MESSAGES.holeNoDeck, entities: [holeKey(id), { table: "decks", id: h.deck }] });
  return out;
}
