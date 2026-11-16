import { assertNever, type EntityKey, type Point } from "@fm/protocol";
import { add, boxOf, convexOverlap, overlappingPairs, scale } from "../geometry";
import { sortedIds } from "../graph";
import { OPENING_KINDS, kindOf, type ObjectKind, type OpeningClearance, type Side } from "../kinds";
import { memo } from "../memo";
import { EPS, type Deck, type Document } from "../model";
import { deckRefs } from "../wall-ranges";
import { clippedToDeck, fitParts, footprints, openingKey, placementKey, placementRug, useZones, wallBodies, wallKey, type Item, type Quads } from "./footprints";
import { geometryOf } from "./openings";
import { ZONE_CLEAR_ABOVE, placementRange, surfaceTop, wallRange, type Range } from "./vertical";

// Clearance (spec: layouts, openings): door swing zones and use zones that overlap furniture or walls, as warnings.

/** A blocked zone: one side's use zone of a placement, or a door's swing. */
export type ZoneRef = { table: "placements"; id: string; side: Side } | { table: "openings"; id: string };
export type ClearanceWarning = { zone: ZoneRef; against: EntityKey };
/** What blocks a zone: a piece with both IDs (the level's rule reads the placement's, MCP prints the object's), a column, or a wall. */
export type Blocker = { kind: "piece"; placement: string; object: string; name: string } | { kind: "wall" } | { kind: "column"; id: string };
export type ZoneBlock = { zone: ZoneRef; blockers: Blocker[] };

/** How deep a folding door's strip is on its opening side: its folded leaves' depth (openkinds.03, .08). */
export const FOLD_DEPTH = 0.15;

/** How long a folding door's folded stack is along its wall: 0.10 m + 0.11 × its width (openkinds.08, product sheets). */
export const foldedLength = (width: number): number => 0.1 + 0.11 * width;

/** How far a kind's clearance reaches from the wall face across its whole span, or null for none (the `clearance` column). */
function clearanceDepth(clearance: OpeningClearance, width: number): number | null {
  switch (clearance) {
    case "square": return width;
    case "twoSquares": return width / 2; // two half-width squares side by side: one rectangle (openkinds.17)
    case "strip": return FOLD_DEPTH;
    case "none": return null;
    default: return assertNever(clearance);
  }
}

/**
 * An opening's clearance (spec: openings, openkinds.03): a rectangle on the opening side, adjacent to the span on the wall
 * face, as deep as its kind's `clearance` says, counter-clockwise; a swing door's is the square of side `width`, one
 * of its corners the hinge. A door on a wall standing on a deck has the same zone, cut at the deck's edge as a use zone
 * is (spec: levels). Null for a kind with none, for missing walls, and for a deck door with no zone left on its deck.
 */
export function swingZone(doc: Document, openingId: string): readonly Point[] | null {
  return swingZones(doc).get(openingId) ?? null;
}

/** The deck a wall stands on, whose edge cuts its doors' swings and whose top starts their band; null on the floor. */
function swingDeck(doc: Document, wallId: string): Deck | null {
  const wall = doc.walls[wallId];
  const base = wall ? deckRefs(wall).base : null;
  return base !== null && Object.hasOwn(doc.decks, base) ? (doc.decks[base] ?? null) : null;
}

const swingZones = memo((doc: Document): Quads => {
  const out = new Map<string, readonly Point[]>();
  for (const id of sortedIds(doc.openings)) {
    const o = doc.openings[id];
    const depth = o ? clearanceDepth(OPENING_KINDS[o.kind].clearance, o.width) : null;
    const g = o && depth !== null ? geometryOf(doc, o) : null;
    if (!o || !g || depth === null) continue;
    const face = scale(g.normal, g.thickness / 2);
    const reach = scale(g.normal, depth);
    const [p, q] = o.side === "left" ? [g.start, g.end] : [g.end, g.start];
    const square = [add(p, face), add(q, face), add(add(q, face), reach), add(add(p, face), reach)];
    const deck = swingDeck(doc, o.wall);
    const zone = deck === null ? square : clippedToDeck(square, deck);
    if (zone.length > 0) out.set(id, zone);
  }
  return out;
});

/**
 * Use zones of the state's placements, one per active side, and swing zones of the doors, that overlap one of the
 * state's footprints or a wall body: warnings, never refusals (spec: layouts, openings). Each zone has a band in height, from
 * its owner's surface (the floor or the top of the deck its piece, or its door's wall, stands on) to ZONE_CLEAR_ABOVE over it, and only a piece
 * or wall whose range overlaps the band blocks it (loft.07, after decks.18 and smalls.06): so a loft's zones warn about
 * the loft, a wall stopping under the loft blocks none of them, and a piece stowed under a platform blocks none of its
 * zones. A piece hung ZONE_CLEAR_ABOVE or more over its own surface owns no zone that warns. A zone never warns against
 * its own footprint or wall, a seat never blocks a zone of a piece you sit at (smart.10, .19), and a rug blocks none
 * (catalog.15). Sorted by zone (side included), then by what it overlaps.
 */
export function clearanceWarnings(doc: Document, stateId: string): ClearanceWarning[] {
  const inState = (id: string): boolean => doc.placements[id]?.state === stateId;
  type Zone = { ref: ZoneRef; quad: readonly Point[]; own: EntityKey; sitAt: boolean; surface: number };
  const zoneList: Zone[] = [
    ...[...useZones(doc)].filter(([id]) => inState(id) && !raised(doc, id)).flatMap(([id, sides]) => {
      const sitAt = kindOfPlacement(doc, id)?.sitAt ?? false;
      const surface = surfaceTop(doc, doc.placements[id]?.deck ?? null);
      return sides.map((z): Zone => ({ ref: { table: "placements", id, side: z.side }, quad: z.quad, own: placementKey(id), sitAt, surface }));
    }),
    ...[...swingZones(doc)].map(([id, quad]): Zone => ({ ref: { table: "openings", id }, quad, own: wallKey(doc.openings[id]?.wall ?? ""), sitAt: false, surface: swingDeck(doc, doc.openings[id]?.wall ?? "")?.top ?? 0 })),
  ];
  if (zoneList.length === 0) return [];
  // An `L` piece blocks by its arms, so its empty quarter stays free (catalog.16); the others by their rectangles.
  const parts = fitParts(doc);
  const feet = [...footprints(doc)].filter(([id]) => inState(id) && !placementRug(doc, id)).flatMap(([id, quad]): [string, readonly Point[]][] =>
    (kindOfPlacement(doc, id)?.outline === "ell" ? (parts.get(id) ?? [quad]) : [quad]).map((q) => [id, q]));
  const list: (Item & { zone: Zone | null })[] = [
    ...zoneList.map((z) => ({ key: zoneKey(z.ref), quad: z.quad, state: stateId, box: boxOf(z.quad), zone: z })),
    ...feet.map(([id, quad]) => ({ key: placementKey(id), quad, state: stateId, box: boxOf(quad), zone: null })),
    ...[...wallBodies(doc)].map(([id, quad]) => ({ key: wallKey(id), quad, state: null, box: boxOf(quad), zone: null })),
  ];
  const out: ClearanceWarning[] = [];
  for (const [i, j] of overlappingPairs(list.map((x) => x.box), EPS)) {
    const a = list[i];
    const b = list[j];
    if (!a || !b || (a.zone === null) === (b.zone === null)) continue; // exactly one of them is a zone
    const [zone, other] = a.zone !== null ? [a.zone, b] : [b.zone, a];
    if (zone === null || sameKey(other.key, zone.own)) continue;
    if (zone.sitAt && other.key.table === "placements" && seatOf(doc, other.key.id)) continue;
    const range = other.key.table === "placements" ? placementRange(doc, other.key.id) : wallRange(doc, other.key.id);
    if (range !== null && !inBand(range, zone.surface)) continue;
    if (convexOverlap(zone.quad, other.quad)) out.push({ zone: zone.ref, against: other.key });
  }
  const order = (w: ClearanceWarning): string => `${zoneOrder(w.zone)}|${w.against.table}|${w.against.id}`;
  // Once per zone and what it overlaps: an `L` front's two strips, or an `L` piece's two arms, may both overlap.
  const unique = [...new Map(out.map((w) => [order(w), w])).values()];
  return unique.sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0));
}

/**
 * Who blocks each zone of the state, in clearanceWarnings' order (clarity.09). Several walls count as one, at the first
 * wall's position: a reader names "a wall", not which. A blocker whose row is missing is skipped, and so is a zone left with none.
 */
export function zoneBlocks(doc: Document, stateId: string): ZoneBlock[] {
  const out = new Map<string, ZoneBlock>();
  for (const { zone, against } of clearanceWarnings(doc, stateId)) {
    const blocker = blockerOf(doc, against);
    if (blocker === null) continue;
    const block = out.get(zoneOrder(zone)) ?? { zone, blockers: [] };
    if (blocker.kind !== "wall" || !block.blockers.some((b) => b.kind === "wall")) block.blockers.push(blocker);
    out.set(zoneOrder(zone), block);
  }
  return [...out.values()];
}

function blockerOf(doc: Document, key: EntityKey): Blocker | null {
  if (key.table === "walls") {
    const wall = doc.walls[key.id];
    return wall ? (wall.column ? { kind: "column", id: key.id } : { kind: "wall" }) : null;
  }
  const placement = key.table === "placements" ? doc.placements[key.id] : undefined;
  const object = placement ? doc.objects[placement.object] : undefined;
  return object ? { kind: "piece", placement: key.id, object: object.id, name: object.name } : null;
}

/** A zone's place in clearanceWarnings' sort, and its identity: side included. */
const zoneOrder = (zone: ZoneRef): string => `${zone.table}|${zone.id}|${zone.table === "placements" ? zone.side : ""}`;

/** The entity a zone belongs to. */
function zoneKey(ref: ZoneRef): EntityKey {
  switch (ref.table) {
    case "placements": return placementKey(ref.id);
    case "openings": return openingKey(ref.id);
    default: return assertNever(ref);
  }
}

/** The kind of a placement's object, read through the kinds table (arch-review.26), or null. */
function kindOfPlacement(doc: Document, placementId: string): ObjectKind | null {
  const p = doc.placements[placementId];
  const object = p ? doc.objects[p.object] : undefined;
  return object ? kindOf(object.kind) : null;
}

/** Whether a placement's bottom is ZONE_CLEAR_ABOVE or more over its own surface: it owns no zone that warns (loft.07). */
function raised(doc: Document, placementId: string): boolean {
  const range = placementRange(doc, placementId);
  return range !== null && range.bottom - surfaceTop(doc, doc.placements[placementId]?.deck ?? null) >= ZONE_CLEAR_ABOVE - EPS;
}

/**
 * Whether a range reaches into a zone's band, from `surface` to ZONE_CLEAR_ABOVE over it: not wholly at or below the
 * surface (stowed under a platform, studio.09) and not from the band's top up (hung, or a loft over a floor zone).
 */
const inBand = (range: Range, surface: number): boolean =>
  range.top > surface + EPS && range.bottom < surface + ZONE_CLEAR_ABOVE - EPS;

/** Whether a placement is a seat (the chair). */
const seatOf = (doc: Document, placementId: string): boolean => (kindOfPlacement(doc, placementId)?.seat ?? null) !== null;

const sameKey = (x: EntityKey, y: EntityKey): boolean => x.table === y.table && x.id === y.id;
