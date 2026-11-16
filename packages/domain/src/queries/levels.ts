import { memo } from "../memo";
import { FLOOR_BASE, type Document } from "../model";
import type { Point } from "@fm/protocol";
import { deckLabel, deckUnder, deckViews, type DeckView } from "./decks";
import { cutAt, cutHeight, openingRange, placementRange, relationToCut, wallRange, type CutRelation, type Range } from "./vertical";
import { shown, toMm } from "../format";

// The one owner of levels (levels.16): the floor plus each distinct deck top at or above the floor's cut, tops equal to
// the millimetre making one level (levels.02). Worked out from the document, never stored.

/**
 * A level of the drawing: its height (0 for the floor, else its decks' top to the millimetre), its decks by ID (none
 * for the floor), the plan's cut there (levels.03) and its name, its decks' names joined.
 */
export type Level = { height: number; deckIds: readonly string[]; cut: number; name: string };

type Levels = { floor: Level; all: readonly Level[] };

const computed = memo((doc: Document): Levels => {
  const floor: Level = { height: 0, deckIds: [], cut: cutHeight(doc), name: "Floor" };
  const groups = new Map<number, DeckView[]>();
  for (const deck of deckViews(doc)) { // by ID, so each group keeps that order
    const key = toMm(deck.top);
    if (key < toMm(floor.cut)) continue; // a step or platform belongs to the floor level
    groups.set(key, [...(groups.get(key) ?? []), deck]);
  }
  const upper = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, decks]): Level => {
      const height = key / 1000;
      return { height, deckIds: decks.map((d) => d.id), cut: cutAt(doc, height, decks.map((d) => d.ring)), name: decks.map(deckLabel).join(", ") };
    });
  return { floor, all: [floor, ...upper] };
});

/** Every level, ascending by height, the floor first. Shared by every caller, so read-only. */
export function levels(doc: Document): readonly Level[] {
  return computed(doc).all;
}

/** The level whose decks hold `deck`, else the floor: for a deck below the floor's cut, a missing deck, or null. */
export function levelOf(doc: Document, deck: string | null): Level {
  const { floor, all } = computed(doc);
  return (deck === null ? undefined : all.find((l) => l.deckIds.includes(deck))) ?? floor;
}

/** Whether `level` is the floor: the one level without decks. */
export function isFloor(level: Level): boolean {
  return level.deckIds.length === 0;
}

/**
 * Where a range lies at `level` (levels.04): "under" it, beneath the level's surface and hidden there, or against the
 * level's cut. At the floor nothing is under, so this is the cut alone. Decks go through `deckRelationAt`.
 */
export function relationAt(range: Range, level: Level): CutRelation {
  return relationToCut(range, level.cut, level.height);
}

/** Whether `level` hides a range: "under" it. Never at the floor; a missing range (an unknown row) is not hidden. */
export function hiddenAt(range: Range | null, level: Level): boolean {
  return range !== null && relationAt(range, level) === "under";
}

/** The level of what the placement stands on: its deck's level, else the floor (shown.02); null for an unknown row. */
export function placementLevel(doc: Document, placementId: string): Level | null {
  const p = doc.placements[placementId];
  return p ? levelOf(doc, p.deck) : null;
}

/**
 * Whether the Opening tool at `level` reaches the wall (sills.06): a wall standing on the level's own surface (the floor,
 * or one of its decks), or a wall on the floor whose range the level's cut crosses (the shell seen from a loft).
 */
export function wallOpenableAt(doc: Document, wallId: string, level: Level): boolean {
  const w = Object.hasOwn(doc.walls, wallId) ? doc.walls[wallId] : undefined;
  if (!w) return false;
  if (level.deckIds.length === 0) return w.base === FLOOR_BASE;
  if (level.deckIds.includes(w.base)) return true;
  const range = wallRange(doc, wallId);
  return w.base === FLOOR_BASE && range !== null && relationAt(range, level) === "crossing";
}

/**
 * How a level's plan shows an opening (sills.05, .12): `cut` when its cut crosses it, `above` when it lies wholly above
 * the cut (drawn dashed), `hidden` below the cut or under the level's surface. An opening on a wall standing on a deck
 * belongs to that deck's level, as the wall does: hidden at every other one (sills.28). The plan draws by it and picking
 * follows.
 */
export function openingShown(doc: Document, openingId: string, level: Level): "cut" | "above" | "hidden" {
  const base = doc.walls[doc.openings[openingId]?.wall ?? ""]?.base ?? FLOOR_BASE;
  if (base !== FLOOR_BASE && !level.deckIds.includes(base)) return "hidden";
  const range = openingRange(doc, openingId);
  const relation = range === null ? null : relationAt(range, level);
  return relation === "crossing" ? "cut" : relation === "above" ? "above" : "hidden";
}

/**
 * Whether `level` shows the placement (shown.02): a stair reaching the level, shown whole there (stairs.02), or a piece
 * not under the level that doesn't stand on a higher level (a loft's mattress isn't drawn at the floor). An unknown row
 * is shown, as `hiddenAt` treats a missing range.
 */
export function shownAt(doc: Document, placementId: string, level: Level): boolean {
  const p = doc.placements[placementId];
  if (!p) return true;
  if (reachesLevel(doc, p.object, level)) return true;
  return !hiddenAt(placementRange(doc, placementId), level) && levelOf(doc, p.deck).height <= level.height;
}

/**
 * Whether the object is a stair reaching a deck of `level` (stairs.02): shown there whole, labelled DN, though its top
 * is the level and `hiddenAt` would hide it. A flight reaching the landing another such stair starts at reaches the
 * level too, so an L shows whole from its top (stairs.49).
 */
export function reachesLevel(doc: Document, objectId: string, level: Level): boolean {
  const seen = new Set<string>();
  let decks = [doc.objects[objectId]?.reaches];
  while (decks.length > 0) {
    const next: (string | null | undefined)[] = [];
    for (const deck of decks) {
      if (typeof deck !== "string" || seen.has(deck)) continue;
      if (level.deckIds.includes(deck)) return true;
      seen.add(deck);
      for (const o of Object.values(doc.objects)) if (o.startsAt === deck) next.push(o.reaches);
    }
    decks = next;
  }
  return false;
}

/** A deck's `relationAt`, except that the level's own decks, whose tops are the level, are never under it (levels.24). */
export function deckRelationAt(deck: Pick<DeckView, "id" | "range">, level: Level): CutRelation {
  return level.deckIds.includes(deck.id) ? relationToCut(deck.range, level.cut) : relationAt(deck.range, level);
}

/**
 * The deck of `level` holding `p`, as `deckUnder` picks it among the level's decks: an upper level's own, or at the
 * floor the decks below its cut (levels.23). On a shared edge of two levels' decks each level reaches its own.
 */
export function levelDeckAt(doc: Document, level: Level, p: Point): DeckView | null {
  return deckUnder(doc, p, (d) => ownsDeck(doc, level, d.id));
}

/**
 * Whether `level` owns the deck: at the floor a deck below the floor's cut (a platform), at an upper level its own
 * decks. A level clicks (`levelDeckAt`) and draws a finish (deck-floors.06) only on the decks it owns.
 */
export function ownsDeck(doc: Document, level: Level, deckId: string): boolean {
  return isFloor(level) ? isFloor(levelOf(doc, deckId)) : level.deckIds.includes(deckId);
}

/** A level's height as the strip shows it: "+2.15", "0.00" for the floor. */
export function levelHeight(level: Level): string {
  const text = shown(level.height);
  return Number(text) > 0 ? `+${text}` : text;
}

export { cutAt };
