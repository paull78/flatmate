import type { Point } from "@fm/protocol";
import { convexOverlap, inConvex, signedArea } from "../geometry";
import { sortedIds } from "../graph";
import { memo } from "../memo";
import { EPS, type Deck, type DeckHole, type Document, type Placement } from "../model";
import { deckRing } from "./footprints";
import { slabOf, slabs, type HoleView, type Slab, type SlabEdge, type SlabFill } from "./slab";
import { deckRange, type Range } from "./vertical";

export { deckFrame, holeRect, type DeckFrame, type EdgeOwner, type HoleView, type SlabEdge } from "./slab";

// Decks as the editor, MCP and the rules see them (decks.16): `deckViews` is the one place a deck row becomes a ring
// on plan and a range in height, and, with its holes, a slab (stairwell.15, built in slab.ts): the holes' rings, the
// slab as convex cells and its boundary edges. Cached by document identity and shared, so read-only.

/**
 * A deck row with its ring (counter-clockwise from the corner at −w/2, −d/2 before turning), its range, its holes, its
 * slab as convex counter-clockwise cells (the rectangle less the holes) and the slab's boundary edges.
 */
export type DeckView = Deck & { ring: Point[]; range: Range; holes: HoleView[]; cells: Point[][]; edges: SlabEdge[]; fills: SlabFill[] };

/** A deck with its slab: with no hole its one fill is its own ring, the same array, which layers draw and compare by. */
function viewOf(deck: Deck, slab: Slab): DeckView {
  const ring = deckRing(deck);
  return { ...deck, ring, range: deckRange(deck), ...slab, fills: slab.holes.length === 0 ? [{ ring, holes: [] }] : slab.fills };
}

/** Every deck, sorted by ID. */
export const deckViews = memo((doc: Document): readonly DeckView[] =>
  sortedIds(doc.decks).flatMap((id) => {
    const deck = doc.decks[id];
    const slab = slabs(doc).get(id);
    return deck && slab ? [viewOf(deck, slab)] : [];
  }),
);

/** A deck with its holes as the rules see it (stairwell.15), outside any document. */
export function slabView(deck: Deck, holes: readonly DeckHole[]): DeckView {
  return viewOf(deck, slabOf(deck, holes));
}

const byId = memo((doc: Document): ReadonlyMap<string, DeckView> => new Map(deckViews(doc).map((v) => [v.id, v])));

/** One deck's view, or null for an unknown ID. */
export function deckView(doc: Document, id: string): DeckView | null {
  return byId(doc).get(id) ?? null;
}

/**
 * The deck holding `p`, within the tolerance, or null over the floor; only decks `among` accepts count (levels.ts'
 * `levelDeckAt`). On a shared edge the higher top wins, then the lower ID (decks.11).
 */
export function deckUnder(doc: Document, p: Point, among: (deck: DeckView) => boolean = () => true): DeckView | null {
  let best: DeckView | null = null;
  for (const v of deckViews(doc)) { // by ID, so a tie keeps the lower one
    if (among(v) && onSlab(v, p) && (!best || v.top > best.top)) best = v;
  }
  return best;
}

/** Whether `p` is on a deck's slab: in its rectangle within the tolerance, strictly inside none of its holes (stairwell.16). */
export function onSlab(deck: Pick<DeckView, "ring" | "holes">, p: Point): boolean {
  return inConvex(p, deck.ring, EPS) && !deck.holes.some((h) => inConvex(p, h.ring, -EPS));
}

/**
 * Whether a shape, as its convex `parts` (one ring for most; an `L` piece's two arms, catalog.16), lies on the deck's
 * slab (decks.11, stairwell.16): every point at most the tolerance outside its rectangle, and overlapping no hole by
 * more than the tolerance (touching a hole's side is fine).
 */
export function insideDeck(deck: Pick<DeckView, "ring" | "holes">, parts: readonly (readonly Point[])[]): boolean {
  return parts.every((ring) => ring.every((p) => inConvex(p, deck.ring, EPS))) && !overHole(deck, parts);
}

/** Whether a shape, as its convex `parts`, overlaps one of the deck's holes by more than the tolerance. */
export function overHole(deck: Pick<DeckView, "holes">, parts: readonly (readonly Point[])[]): boolean {
  return deck.holes.some((h) => parts.some((ring) => convexOverlap(ring, h.ring)));
}

/** Whether a convex `ring` overlaps the deck's slab, a cell of it, by more than the tolerance (stairwell.15). */
export function overSlab(deck: Pick<DeckView, "cells">, ring: readonly Point[]): boolean {
  return deck.cells.some((c) => convexOverlap(ring, c));
}

/** A hole by ID with the deck it cuts, as the adapters find one (they never read the table, stairwell.15), or null. */
export function holeView(doc: Document, id: string): { hole: HoleView; deck: DeckView } | null {
  for (const deck of deckViews(doc)) {
    const hole = deck.holes.find((h) => h.id === id);
    if (hole) return { hole, deck };
  }
  return null;
}

/** The area of a deck's slab: its rectangle's less its holes', in square metres. */
export function slabArea(deck: Pick<DeckView, "cells">): number {
  return deck.cells.reduce((sum, c) => sum + Math.abs(signedArea(c)), 0);
}

/** A deck's name in a refusal: a blank one still reads, as a piece's "Object" does in fit.ts (decks.23). */
export const deckLabel = (deck: Pick<Deck, "name">): string => (deck.name.trim() === "" ? "Deck" : deck.name);

/** The placements standing on a deck, in every layout: by layout order, then by ID. */
export function carriedBy(doc: Document, deckId: string): Placement[] {
  const order = (p: Placement): number => doc.states[p.state]?.order ?? Number.MAX_SAFE_INTEGER;
  return Object.values(doc.placements)
    .filter((p) => p.deck === deckId)
    .sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
