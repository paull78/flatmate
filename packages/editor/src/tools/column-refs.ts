import { FLOOR_BASE, isFloor, levelDeckAt, levels, type DeckView, type Document, type Level, type WallTop } from "@fm/domain";
import type { Point } from "@fm/protocol";

// Where a column stands and what it reaches up to (spec "Vertical range", pillars.23): the Column tool sets them from
// where it is placed, and a free floor column's Top offers the level decks over it. The domain checks the result.
//
//   ceiling ───────────────────────────
//               ┃ at the loft's level: base Loft, top ceiling
//   loft    ════╋═══════╗
//               ┃       ║ at the floor under it: base floor, top Loft
//   floor   ────┸───────╨──────┸────── elsewhere: floor to ceiling

/** The decks that are levels holding `p`, lowest first: one per level above the floor, since decks don't overlap. */
export function levelDecksOver(doc: Document, p: Point): DeckView[] {
  return levels(doc).flatMap((level) => {
    const deck = isFloor(level) ? null : levelDeckAt(doc, level, p);
    return deck ? [deck] : [];
  });
}

/**
 * A column placed at `at` from `level`: at a deck's level on the level's deck there (else its first, which the domain
 * refuses as off the deck) up to the ceiling; at the floor from the floor up to the lowest level deck over it, else
 * the ceiling. Over a wall with that base the domain puts it in the wall's line, with the wall's base and top.
 */
export function columnRefs(doc: Document, level: Level, at: Point): { base: string; top: WallTop } {
  if (!isFloor(level)) return { base: baseAt(doc, level, at), top: "ceiling" };
  return { base: FLOOR_BASE, top: levelDecksOver(doc, at)[0]?.id ?? "ceiling" };
}

/**
 * What a wall or column built at `at` from `level` stands on (pillars.09, .23): the floor at the floor level; at a
 * deck's level the level's deck there, else its first, which the domain refuses as off the deck.
 */
export function baseAt(doc: Document, level: Level, at: Point): string {
  return isFloor(level) ? FLOOR_BASE : levelDeckAt(doc, level, at)?.id ?? level.deckIds[0] ?? FLOOR_BASE;
}
