import type { EntityKey, Point } from "@fm/protocol";
import { boxOf, convexOverlap, type Box } from "../geometry";
import { sortedIds, wallFrame } from "../graph";
import type { OrCeiling } from "../kinds";
import { memo } from "../memo";
import { CEILING_ID, DEFAULT_CEILING, EPS, FLOOR_BASE, type Deck, type Document, type Placement } from "../model";
import { DECK_THICKNESS } from "../presets";
import { fitParts, fitShapes, wallBodies } from "./footprints";
import { slabs } from "./slab";
import { toMm } from "../format";
import { ceilingAtPoint, highSide, highestCeilingOver, roofPlanes } from "../roof";
import { wallOutlines } from "./outlines";

// Every vertical fact (heights.27): the only reader of wall tops, the objects' h and z maps and the ceiling row, so
// "to the ceiling" and "at the ceiling" are resolved here alone, and of deck tops, the surfaces pieces stand on
// (decks.16): every absolute range adds the surface's top here. Stage 3's roofs change ceilingOver, ceilingAlong and
// cutAt.

/** A vertical extent in metres above the floor (0.00). */
export type Range = { bottom: number; top: number };
/** One configuration's height and elevation, as stored. */
export type Heights = { h: number; z: OrCeiling };
/**
 * Everything that takes up space: a placement (in its state), a wall or a deck (in every state, `state` null); `box`
 * bounds `ring`.
 */
export type Solid = { key: EntityKey; ring: readonly Point[]; box: Box; state: string | null; range: Range };

/** The ceiling's height, 2.50 m when the drawing has no row (heights.11). */
export function ceilingHeight(doc: Document): number {
  return doc.ceilings[CEILING_ID]?.height ?? DEFAULT_CEILING;
}

/** A flat ceiling: one height everywhere, read with no geometry, so a flat drawing costs what it did (roofs.27). */
const flat = (doc: Document): boolean => (doc.ceilings[CEILING_ID]?.shape ?? "flat") === "flat";

/** The ceiling at a point, flat or under a shed or gable roof, in whole millimetres (roofs.17). */
function ceilingAt(doc: Document, p: Point): number {
  return ceilingAtPoint(doc, p);
}

/** The lowest ceiling over a footprint: the lowest of its corners, which holds for flat, shed and gable ceilings. */
export function ceilingOver(doc: Document, ring: readonly Point[]): number {
  if (ring.length === 0 || flat(doc)) return ceilingHeight(doc);
  return Math.min(...ring.map((p) => ceilingAt(doc, p)));
}

/** A wall's top at a point of it: a full wall's is the ceiling there (raw, for drawing), any other its range's top. */
export function wallTopAt(doc: Document, wallId: string, p: Point): number | null {
  const range = wallRange(doc, wallId);
  if (!range || doc.walls[wallId]?.top !== "ceiling" || flat(doc)) return range?.top ?? null;
  return Math.min(...roofPlanes(doc).map((q) => q.c + q.gx * p.x + q.gy * p.y));
}

/**
 * A wall's top over the stretch `from`–`to` metres along it from joint a (an opening's span): a full wall's is the
 * lowest ceiling over that stretch of its body, any other its range's top (roofs.17).
 */
export function wallTopOver(doc: Document, wallId: string, from: number, to: number): number | null {
  const range = wallRange(doc, wallId);
  const f = wallFrame(doc, wallId);
  if (!range || !f || doc.walls[wallId]?.top !== "ceiling") return range?.top ?? null;
  const at = (t: number, side: number): Point => ({ x: f.a.x + f.dir.x * t + f.left.x * f.half * side, y: f.a.y + f.dir.y * t + f.left.y * f.half * side });
  return ceilingOver(doc, [at(from, -1), at(to, -1), at(to, 1), at(from, 1)]);
}

/** The highest ceiling over a wall's outline: a full wall's top, the top of its range (roofs.17). */
function highestCeilingAlongWall(doc: Document, wallId: string): number {
  if (flat(doc)) return ceilingHeight(doc);
  const ring = wallOutlines(doc).get(wallId);
  return ring ? highestCeilingOver(doc, ring) : ceilingHeight(doc);
}

/** The lowest ceiling over a wall's outline: what a fixed top must stay under (I17, roofs.17). */
export function ceilingAlong(doc: Document, wallId: string): number {
  if (flat(doc)) return ceilingHeight(doc);
  const ring = wallOutlines(doc).get(wallId);
  return ring ? ceilingOver(doc, ring) : ceilingHeight(doc);
}

/** A configuration's stored height and elevation, or null when the object has none for it. */
export function heightsOf(object: { h: Readonly<Record<string, number>>; z: Readonly<Record<string, OrCeiling>> }, config: string): Heights | null {
  const h = Object.hasOwn(object.h, config) ? object.h[config] : undefined;
  const z = Object.hasOwn(object.z, config) ? object.z[config] : undefined;
  return h === undefined || z === undefined ? null : { h, z };
}

/**
 * The top of what a piece stands on: 0 for the floor (null), else the deck's top. An unknown deck reads as the floor:
 * I9 refuses a placement on one (decks.15), and `placementRange` gives it no range.
 */
export function surfaceTop(doc: Document, deck: string | null): number {
  const row = deck !== null && Object.hasOwn(doc.decks, deck) ? doc.decks[deck] : undefined;
  return row?.top ?? 0;
}

/**
 * What a piece hung from the ceiling hangs from (beams.06): the lowest of the ceiling over `ring` and the underside of
 * each loft whose slab overlaps it, other than `surface`, above `surface`'s top. A loft is a hollow deck that is a level,
 * its top at or above the floor's cut (levels.02); a hollow platform below the cut is not (beams.21). A beam under a
 * loft's edge hangs from the loft; a collar tie under a gable from the slopes over its ends (beams.07).
 */
export function overheadOver(doc: Document, ring: readonly Point[], surface: string | null): number {
  let low = ceilingOver(doc, ring);
  const base = surfaceTop(doc, surface);
  let cut: number | null = null; // the floor's cut, worked out only when a hollow deck needs it
  for (const id of sortedIds(doc.decks)) {
    const deck = doc.decks[id];
    if (!deck || deck.solid || id === surface) continue;
    cut ??= toMm(cutHeight(doc));
    if (toMm(deck.top) < cut) continue;
    const under = deckRange(deck).bottom;
    if (under <= base + EPS || under >= low) continue;
    if ((slabs(doc).get(id)?.cells ?? []).some((cell) => convexOverlap(cell, ring))) low = under;
  }
  return low;
}

/**
 * The range of a box with these heights over `ring`, standing on `surface` (a deck's ID, or null for the floor): a
 * numeric elevation is measured from the surface's top; "ceiling" hangs it from what is over it (`overheadOver`): the
 * lowest ceiling over the ring, or a loft's underside over it (beams.06, which changes decks.04's "whatever it stands on").
 */
export function rangeOf(doc: Document, heights: Heights, ring: readonly Point[], surface: string | null): Range {
  const bottom = heights.z === "ceiling" ? overheadOver(doc, ring, surface) - heights.h : surfaceTop(doc, surface) + heights.z;
  return { bottom, top: bottom + heights.h };
}

/** A placement and its object's stored heights for the configuration it shows, or null for an unknown or broken one. */
function placed(doc: Document, placementId: string): { p: Placement; heights: Heights } | null {
  const p = Object.hasOwn(doc.placements, placementId) ? doc.placements[placementId] : undefined;
  const object = p && doc.objects[p.object];
  const heights = p && object ? heightsOf(object, p.config) : null;
  return p && heights ? { p, heights } : null;
}

/**
 * A placement's absolute range in its state's configuration, over its drawn shape, on its surface; null for an unknown
 * or broken one, or one on a missing deck (decks.15).
 */
export function placementRange(doc: Document, placementId: string): Range | null {
  const found = placed(doc, placementId);
  const ring = fitShapes(doc).get(placementId);
  if (!found || !ring) return null;
  const { p, heights } = found;
  if (p.deck !== null && !Object.hasOwn(doc.decks, p.deck)) return null;
  return rangeOf(doc, heights, ring, p.deck);
}

/** A placement's stored elevation for the configuration it shows, relative to its surface (decks.16); null for none. */
export function elevationOf(doc: Document, placementId: string): OrCeiling | null {
  return placed(doc, placementId)?.heights.z ?? null;
}

/** A deck row by ID, or undefined (own keys only: IDs key plain objects). */
function deckRow(doc: Document, id: string): Deck | undefined {
  return Object.hasOwn(doc.decks, id) ? doc.decks[id] : undefined;
}

/**
 * A wall or column row's range (heights.10, pillars.05, .19), the one place its base and top become metres: from the
 * floor (0) or its base deck's top, up to the ceiling along it ("ceiling"), a height above the base (a number), or a
 * deck's underside (a deck's ID). Null for an unknown row, or one naming a missing deck (I21 reports it).
 */
export function wallRange(doc: Document, wallId: string): Range | null {
  const w = Object.hasOwn(doc.walls, wallId) ? doc.walls[wallId] : undefined;
  const base = w && w.base !== FLOOR_BASE ? deckRow(doc, w.base) : undefined;
  if (!w || (w.base !== FLOOR_BASE && !base)) return null;
  const bottom = base?.top ?? 0;
  if (w.top === "ceiling") return { bottom, top: highestCeilingAlongWall(doc, wallId) };
  if (typeof w.top === "number") return { bottom, top: bottom + w.top };
  const under = deckRow(doc, w.top);
  return under ? { bottom, top: deckRange(under).bottom } : null;
}

// A new opening's heights above its wall's bottom (sills.01), and the wall every head keeps above it (sills.02).
const DOOR_HEAD = 2.1;
const WINDOW_SILL = 0.9;
const WINDOW_HEAD = 2.1;
/** The least wall kept above a head. */
export const HEAD_CLEAR = 0.1;
/** The least height of an opening, sill to head (sills.02): the smallest window's width. */
export const MIN_OPENING_HEIGHT = 0.3;

/**
 * The heights a new opening takes on a wall `height` tall (sills.01): a door or doorway from 0 to 2.10, a window from
 * 0.90 to 2.10, the head dropped to HEAD_CLEAR under the wall's top when that is lower, to the millimetre. The load
 * fill for drawings saved before heights reads the same (sills step 01), so they open as they drew.
 */
export function defaultOpeningHeights(fromFloor: boolean, height: number): { sill: number; head: number } {
  const head = toMm(Math.min(fromFloor ? DOOR_HEAD : WINDOW_HEAD, height - HEAD_CLEAR)) / 1000;
  return { sill: fromFloor ? 0 : WINDOW_SILL, head };
}

/**
 * An opening's range: its stored sill and head above its wall's bottom (sills.01); null for an unknown opening or wall.
 * The plan, the 3D view, sections and look all read it.
 */
export function openingRange(doc: Document, openingId: string): Range | null {
  const o = Object.hasOwn(doc.openings, openingId) ? doc.openings[openingId] : undefined;
  const wall = o ? wallRange(doc, o.wall) : null;
  if (!o || !wall) return null;
  return { bottom: toMm(wall.bottom + o.sill) / 1000, top: toMm(wall.bottom + o.head) / 1000 };
}

/** A deck's range: from the floor to its top when solid, else its fixed thickness under its top (decks.12). */
export function deckRange(deck: Pick<Deck, "top" | "solid">): Range {
  return { bottom: deck.solid ? 0 : deck.top - DECK_THICKNESS, top: deck.top };
}

/**
 * A half wall's top in metres above the floor (wallRange), or null for a full wall, which follows the ceiling, or no
 * wall. A row topped by a deck is not full: it follows the deck.
 */
export function halfWallTop(doc: Document, wallId: string): number | null {
  const top = Object.hasOwn(doc.walls, wallId) ? doc.walls[wallId]?.top : undefined;
  return top === undefined || top === "ceiling" ? null : (wallRange(doc, wallId)?.top ?? null);
}

/** Whether two ranges share more than the tolerance: touching, or 1 mm of float noise, is not overlapping (heights.12, .22). */
export function rangesOverlap(a: Range, b: Range): boolean {
  return a.bottom < b.top - EPS && b.bottom < a.top - EPS;
}

/** Pieces from this height up block no use zone and take no free floor, whatever the ceiling (heights.36). */
export const ZONE_CLEAR_ABOVE = 1.2;
/** The plan's cut above a level, under a ceiling high enough (heights.15); the same 1.20 as ZONE_CLEAR_ABOVE by choice, not by rule. */
export const PLAN_CUT = 1.2;

export function clearAbove(range: Range): boolean {
  return range.bottom >= ZONE_CLEAR_ABOVE - EPS;
}

/**
 * The plan's horizontal cut at a level standing at `base`: the level plus 1.20 m, or half the way to the ceiling under
 * a low one, to the millimetre (heights.15, levels.03). Under a slope the ceiling is the highest over the level: over
 * its decks' rings, or over the whole roof for the floor (roofs.10).
 */
export function cutAt(doc: Document, base: number, rings: readonly (readonly Point[])[] = []): number {
  const highest = rings.length === 0 ? highSide(doc) : Math.max(...rings.map((r) => highestCeilingOver(doc, r)));
  return toMm(base + Math.min(PLAN_CUT, (highest - base) / 2)) / 1000;
}

/** The floor's cut, which also decides which deck tops are levels (levels.02). */
export function cutHeight(doc: Document): number {
  return cutAt(doc, 0);
}

export type CutRelation = "under" | "below" | "crossing" | "above";

/**
 * Where a range lies against the cut of a level at `base`: a bottom at the cut is above it, a top at the cut below it.
 * Above the floor, a top at or under the level, to the millimetre, is under it: beneath the level's surface.
 */
export function relationToCut(range: Range, cut: number, base = 0): CutRelation {
  if (base > 0 && toMm(range.top) <= toMm(base)) return "under";
  if (range.bottom >= cut - EPS) return "above";
  if (range.top <= cut + EPS) return "below";
  return "crossing";
}

/** A piece in the stacking order: a stair, a seat or a rug (by its kind) changes its place among pieces it overlaps. */
export type Stacked = { id: string; range: Range; stair?: boolean; seat?: boolean; rug?: boolean };

/**
 * The one stacking order for drawing (heights.38): by bottom to the millimetre, lowest first, then by ID; except that a
 * stair comes after a piece whose bottom is below its top, which it passes over (a desk under an open stair), and
 * before one wholly above it (stairs.59); a seat comes before other pieces at the same bottom, so a table's fill
 * covers the chair tucked under it (seating.10); and a rug comes before every other piece, right after the floor
 * (catalog.15).
 */
export function stackOrder(a: Stacked, b: Stacked): number {
  return stacking(a, b, 1);
}

/**
 * The click cycle's order (heights.52): the stacking order, except that a seat comes after other pieces at the same
 * bottom, so a click on a tucked chair's overlap picks the table drawn over it first (seating.10), and a rug comes
 * after every other piece, so a click on a piece standing on a rug picks the piece (catalog.15).
 */
export function pickOrder(a: Stacked, b: Stacked): number {
  return stacking(a, b, -1);
}

function stacking(a: Stacked, b: Stacked, seats: 1 | -1): number {
  const rug = Number(b.rug === true) - Number(a.rug === true);
  if (rug !== 0) return seats * rug;
  if (a.stair === true && b.stair !== true) return toMm(b.range.bottom) < toMm(a.range.top) ? 1 : -1;
  if (b.stair === true && a.stair !== true) return toMm(a.range.bottom) < toMm(b.range.top) ? -1 : 1;
  const seat = Number(b.seat === true) - Number(a.seat === true);
  return toMm(a.range.bottom) - toMm(b.range.bottom) || seats * seat || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Every wall, deck cell and placement as a box: its shape on plan, its state (null for walls and decks) and its range.
 * A deck is one box per cell of its slab, a placement one per convex part (fitParts): boxes may share a key. Walls first, as fit's sweep has always listed them, so a refused edit's first violation stays the same; decks by ID.
 */
export const solids = memo((doc: Document): readonly Solid[] => {
  const out: Solid[] = [];
  for (const [id, ring] of wallBodies(doc)) {
    const range = wallRange(doc, id);
    if (range) out.push({ key: { table: "walls", id }, ring, box: boxOf(ring), state: null, range });
  }
  // A deck is its slab's cells (stairwell.15): every check against a solid sees the holes.
  for (const id of sortedIds(doc.decks)) {
    const deck = doc.decks[id];
    const cells = slabs(doc).get(id)?.cells ?? [];
    if (deck) for (const ring of cells) out.push({ key: { table: "decks", id }, ring, box: boxOf(ring), state: null, range: deckRange(deck) });
  }
  // A piece is one box per convex part (catalog.16): an `L`'s two arms share its key and range.
  for (const [id, parts] of fitParts(doc)) {
    const p = doc.placements[id];
    const range = placementRange(doc, id);
    if (p && range) for (const ring of parts) out.push({ key: { table: "placements", id }, ring, box: boxOf(ring), state: p.state, range });
  }
  return out;
});
