import type { EntityKey, Point } from "@fm/protocol";
import { MESSAGES, collisionMessage, type Violation } from "./errors";
import { boxOf, convexOverlap, inConvex } from "./geometry";
import { EPS, type Document } from "./model";
import { MAX_DECK_TOP, MIN_DECK_SIZE, MIN_DECK_TOP } from "./presets";
import { deckLabel, deckViews, type DeckView } from "./queries/decks";
import { solidsCollide, type Box3 } from "./queries/fit";
import { wallBodies } from "./queries/footprints";
import { ceilingOver, solids } from "./queries/vertical";
import { faceAt } from "./queries/zones";

// I18, the deck's own rules (spec "The deck", decks.14, .15), beside validate.ts as ceiling.ts holds I17. Pieces
// against decks are fit rules (fit.ts).

const deckKey = (id: string): EntityKey => ({ table: "decks", id });

/** Width and depth at least MIN_DECK_SIZE, top MIN_DECK_TOP to MAX_DECK_TOP (a hollow underside is then above 0). */
function sized(deck: DeckView): boolean {
  return deck.w >= MIN_DECK_SIZE && deck.d >= MIN_DECK_SIZE && deck.top >= MIN_DECK_TOP && deck.top <= MAX_DECK_TOP;
}

/**
 * Whether a point is over the building (decks.14): in a room, or in a wall's body within the tolerance. A room's ring
 * is its walls' centreline, where `faceAt` answers null; the walls' bodies cover it.
 */
function overBuilding(doc: Document, p: Point): boolean {
  if (faceAt(doc, p) !== null) return true;
  for (const body of wallBodies(doc).values()) if (inConvex(p, body, EPS)) return true;
  return false;
}

/**
 * I18 for every deck, by ID, in this order: sizes (nothing else is checked for a deck that breaks them), over the
 * building (centre and four corners), clear of every wall in height, no other deck's slab overlapping its slab on plan (each pair once,
 * under the lower ID), under the ceiling. Texts name the deck.
 */
export function deckViolations(doc: Document): Violation[] {
  const decks = deckViews(doc);
  if (decks.length === 0) return [];
  const walls = solids(doc).filter((s) => s.key.table === "walls");
  // A deck meets walls and other decks with its slab's cells (stairwell.15): a hole lets them through.
  const cells = (d: DeckView): Box3[] => d.cells.map((ring) => ({ ring, box: boxOf(ring), range: d.range }));
  const out: Violation[] = [];
  decks.forEach((deck, i) => {
    const v = (message: string, entities: EntityKey[] = [deckKey(deck.id)]): void => void out.push({ invariant: "I18", message, entities });
    if (!sized(deck)) return v(MESSAGES.deckSizes);
    const name = deckLabel(deck);
    if (![deck.at, ...deck.ring].every((p) => overBuilding(doc, p))) v(MESSAGES.deckOutside(name));
    const own = cells(deck);
    for (const wall of walls) {
      if (!own.some((c) => solidsCollide(c, wall))) continue;
      const column = doc.walls[wall.key.id]?.column === true;
      v(collisionMessage(column ? { with: "deckColumn", deck: { name, ...deck.range }, column: { name: "Column", ...wall.range } } : { with: "deckWall", deck: { name, ...deck.range }, wallTop: wall.range.top }), [deckKey(deck.id), wall.key]);
    }
    for (const other of decks.slice(i + 1)) {
      if (sized(other) && deck.cells.some((c) => other.cells.some((o) => convexOverlap(c, o)))) v(MESSAGES.decksOverlap(name, deckLabel(other)), [deckKey(deck.id), deckKey(other.id)]);
    }
    const ceiling = ceilingOver(doc, deck.ring);
    if (deck.top > ceiling + EPS) v(collisionMessage({ with: "deckCeiling", name, top: deck.top, ceiling }));
  });
  return out;
}
