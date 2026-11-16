import { assertNever, type EntityKey, type Point } from "@fm/protocol";
import { add, boxOf, clipHalfPlane, pointInPolygon, rotateAbout, scale, signedArea, sub, type Box } from "../geometry";
import { sortedIds, wallFrame } from "../graph";
import { SIDE_IDS, configOf, isBeam, isRug, isWell, kindOf, type Side } from "../kinds";
import { memo } from "../memo";
import { isFloorWall, type Deck, type Document, type Placement } from "../model";
import { armsFor, armsOf, type Arms } from "../arms";
import { ellInsets, ellShortest, ellStrips, ellZoneRing, type StripRect } from "../ell-zone";
import { outlineOf, placedPiece } from "../shapes";
import { clampInsets, storedZone, type ZoneExtent } from "../use-zone";
import { faceAt } from "./zones";
import { toMm } from "../format";

// Layout-state geometry (spec: layouts): footprints and use zones as convex quads (an `L` front's two strips drawn as one
// ring, ell-zone.ts), wall bodies as rectangles, the room a placement lies in. Fit (I10, I11) is in fit.ts, clearance
// in clearance.ts, free floor in free-floor.ts. Results are cached by document identity (memo.ts) and shared, so
// read-only.

export type Quads = ReadonlyMap<string, readonly Point[]>;

/** The rectangle [x0, x1] × [y0, y1] in placement coordinates, turned and moved to the placement. */
function placed(p: Pick<Placement, "at" | "rotation">, x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map((q) => rotateAbout(add(q, p.at), p.at, p.rotation));
}

/**
 * A w × d footprint anchored at `at`, the middle of its back edge (layout-states.49): before rotation it spans x from
 * −w/2 to w/2 and y from −d to 0, front edge facing −y; `rotation` turns it counter-clockwise about `at`. The one
 * footprint rule: stored placements, previews of moves, the Object tool's ghost and tweened sizes all use it.
 */
export function footprintQuad(at: Point, w: number, d: number, rotation: number): Point[] {
  return placed({ at, rotation }, -w / 2, -d, w / 2, 0);
}

/**
 * A deck's ring (decks.03): the w × d rectangle about its centre `at`, turned by `rotation`, counter-clockwise from the
 * corner at (−w/2, −d/2). Read it through `deckViews`; `solids` builds its deck rows from it too.
 */
export function deckRing(deck: Pick<Deck, "at" | "w" | "d" | "rotation">): Point[] {
  return placed(deck, -deck.w / 2, -deck.d / 2, deck.w / 2, deck.d / 2);
}

/** Size and use-zone depth of a placement's configuration, or null when its object or configuration is missing. */
export function sizeOf(doc: Document, p: Placement): { w: number; d: number; zone: number | null } | null {
  const object = doc.objects[p.object];
  const config = object ? configOf(object, p.config) : null;
  const w = object?.w[p.config];
  const d = object?.d[p.config];
  return config && w !== undefined && d !== undefined ? { w, d, zone: config.zone } : null;
}

/**
 * One side's use zone (furnish.20, spec: layouts): its depth and its insets along the side, front and back from the left
 * corner, left and right from the back corner. The side's stored entry when it has one, in every configuration with a
 * zone, else the configuration's depth and the kind's `zoneDefaults`; insets that leave less than MIN_ZONE_SIZE of the
 * side shrink in proportion (`clampInsets`). Null when the side is off, the configuration has no zone (or one of 0 or
 * less, smart.30) or the object is missing.
 */
export function zoneExtent(doc: Document, p: Placement, side: Side): ZoneExtent | null {
  const size = sizeOf(doc, p);
  if (!size || size.zone === null || size.zone <= 0 || !p.sides[side]) return null;
  const length = side === "front" || side === "back" ? size.w : size.d;
  const stored = storedZone(p.zones, side);
  const fallback = kindOf(doc.objects[p.object]?.kind ?? "")?.zoneDefaults[side] ?? { start: 0, end: 0 };
  const [start, end] = stored ? [stored.start, stored.end]
    : "centred" in fallback ? [Math.max(0, (length - fallback.centred) / 2), Math.max(0, (length - fallback.centred) / 2)]
    : "frontSquare" in fallback ? [side === "left" || side === "right" ? Math.max(0, length - size.w) : 0, 0] // insets from the back corner
    : [fallback.start, fallback.end];
  const arms = ellFront(doc, p, side, size);
  const [s, e] = arms ? ellInsets(size.w, size.d, arms, start, end) : clampInsets(length, start, end);
  return { depth: stored?.depth ?? size.zone, start: s, end: e };
}

/** The arms an `L` piece draws with, when `side` is its front (whose zone is two strips, catalog.13); else null. */
function ellFront(doc: Document, p: Placement, side: Side, size: { w: number; d: number }): Arms | null {
  const object = doc.objects[p.object];
  return side === "front" && object && outlineOf(object.kind) === "ell" ? armsFor(object.kind, size.w, size.d, armsOf(object) ?? undefined) : null;
}

/**
 * The length a zone on `side` with insets `start` and `end` leaves, as given (no clamp): the side's, or an `L` front's
 * shorter strip (each runs from the inner corner, catalog.13). Null without the placement's object.
 */
export function zoneLength(doc: Document, p: Placement, side: Side, start: number, end: number): number | null {
  const size = sizeOf(doc, p);
  if (!size) return null;
  const arms = ellFront(doc, p, side, size);
  if (arms) return ellShortest(size.w, size.d, arms, start, end);
  return (side === "front" || side === "back" ? size.w : size.d) - start - end;
}

/**
 * Each placement's footprint: a counter-clockwise quad starting at the front-left corner. `at` is the middle of the
 * back edge (layout-states.49): before rotation the footprint spans x from −w/2 to w/2 and y from −d to 0, so the
 * front edge faces −y; `rotation` turns it counter-clockwise about `at`. A configuration change or resize keeps the
 * back edge in place.
 */
export const footprints = memo((doc: Document): Quads => {
  const out = new Map<string, readonly Point[]>();
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const size = p ? sizeOf(doc, p) : null;
    if (p && size) out.set(id, footprintQuad(p.at, size.w, size.d, p.rotation));
  }
  return out;
});

/** Each placement's outline and convex parts, placed like its footprint (catalog.16). */
const fitPieces = memo((doc: Document): ReadonlyMap<string, { outline: readonly Point[]; parts: readonly (readonly Point[])[] }> => {
  const out = new Map<string, { outline: readonly Point[]; parts: readonly (readonly Point[])[] }>();
  for (const [id, quad] of footprints(doc)) {
    const p = doc.placements[id];
    const object = p ? doc.objects[p.object] : undefined;
    const size = p ? sizeOf(doc, p) : null;
    if (!p || !object || !size) continue;
    out.set(id, outlineOf(object.kind) === "rect" ? { outline: quad, parts: [quad] } : placedPiece(object.kind, p.at, size.w, size.d, p.rotation, armsOf(object) ?? undefined));
  }
  return out;
});

/**
 * Each placement's fit shape (shapefit.01): its kind's outline placed like its footprint, one ring (six corners for an
 * `L`), what drawing, free floor, the room a piece lies in and the click hit test read. A rectangle kind's entry is its
 * footprint quad itself; grips, zones and snapping keep reading `footprints`. Collisions read `fitParts`.
 */
export const fitShapes = memo((doc: Document): Quads => new Map([...fitPieces(doc)].map(([id, s]) => [id, s.outline])));

/**
 * Each placement's convex parts (catalog.16): its fit shape for today's outlines, an `L`'s two arms. What I10, I11,
 * the tucks and tag spots test, a pair of convex rings at a time.
 */
export const fitParts = memo((doc: Document): ReadonlyMap<string, readonly (readonly Point[])[]> => new Map([...fitPieces(doc)].map(([id, s]) => [id, s.parts])));

/** Whether a placement's object is a rug (`isRug`, catalog.15); false for a missing one. */
export function placementRug(doc: Document, placementId: string): boolean {
  const p = Object.hasOwn(doc.placements, placementId) ? doc.placements[placementId] : undefined;
  const kind = p ? doc.objects[p.object]?.kind : undefined;
  return kind !== undefined && isRug(kind);
}

/** The footprint a placement would have (for previews of moves not yet made), or null without its object. */
export function footprintOf(doc: Document, p: Placement): readonly Point[] | null {
  const size = sizeOf(doc, p);
  return size ? footprintQuad(p.at, size.w, size.d, p.rotation) : null;
}

/** One active side's use zone (smart.08); an `L` front's is two, its left strip 0 and its back strip 1 (catalog.13). */
export type SideZone = { side: Side; quad: readonly Point[]; strip?: 0 | 1 };
/** One active side's zone as drawn: its band, or an `L` front's union of strips (catalog.11). */
export type ZoneRing = { side: Side; ring: readonly Point[] };

/**
 * The band `depth` deep outside one side of a w × d footprint, inset `start` and `end` from that side's corners
 * (front and back from the left corner, left and right from the back corner). Left is the edge at x = −w/2, as in the
 * editor's side grips. `p` is the placement, or where one would stand (a winder's entry probe, steps.39).
 */
export function sideBand(p: Pick<Placement, "at" | "rotation">, w: number, d: number, { depth: z, start: s, end: e }: ZoneExtent, side: Side): Point[] {
  switch (side) {
    case "front": return placed(p, -w / 2 + s, -d - z, w / 2 - e, -d);
    case "back": return placed(p, -w / 2 + s, 0, w / 2 - e, z);
    case "left": return placed(p, -w / 2 - z, -d + e, -w / 2, -s);
    case "right": return placed(p, w / 2, -d + e, w / 2 + z, -s);
    default: return assertNever(side);
  }
}

/**
 * The part of a zone's `ring` on its owner's deck (AC-05), which stops at the edge; empty when none of it is. A piece's
 * use zone and a deck door's swing (spec: levels) are both cut by it.
 */
export function clippedToDeck(ring: readonly Point[], deck: Deck): Point[] {
  const edges = deckRing(deck); // counter-clockwise
  const kept = edges.reduce<Point[]>((r, a, i) => (r.length === 0 ? r : clipHalfPlane(r, a, edges[(i + 1) % edges.length] ?? a)), [...ring]);
  return Math.abs(signedArea(kept)) > MIN_ZONE_AREA ? kept : [];
}

/** Under this, in m², a clipped zone is a line along the edge: no zone. */
const MIN_ZONE_AREA = 1e-6;

/**
 * Each placement's use zones and their outlines: one band per side that `zoneExtent` gives, in SIDE_IDS order, an
 * `L` front's two strips and their union, each stopping at the edge of the deck its piece stands on (AC-05). A placement
 * whose state has no zone, with every side off, or with no zone left on its deck, has no entry.
 */
const zoneShapes = memo((doc: Document): ReadonlyMap<string, { zones: readonly SideZone[]; rings: readonly ZoneRing[] }> => {
  const out = new Map<string, { zones: SideZone[]; rings: ZoneRing[] }>();
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const size = p ? sizeOf(doc, p) : null;
    if (!p || !size) continue;
    const zones: SideZone[] = [];
    const rings: ZoneRing[] = [];
    const deck = p.deck !== null && Object.hasOwn(doc.decks, p.deck) ? doc.decks[p.deck] : undefined;
    const onDeck = (ring: readonly Point[]): Point[] => (deck ? clippedToDeck(ring, deck) : [...ring]);
    for (const side of SIDE_IDS) {
      const extent = zoneExtent(doc, p, side);
      const arms = extent ? ellFront(doc, p, side, size) : null;
      if (extent && arms) {
        const strips = ellStrips(size.w, size.d, arms, extent);
        const rect = (r: StripRect): Point[] => onDeck(placed(p, r.x0, r.y0, r.x1, r.y1));
        const parts = [rect(strips[0]), rect(strips[1])];
        parts.forEach((quad, i) => { if (quad.length > 0) zones.push({ side, quad, strip: i === 0 ? 0 : 1 }); });
        const ring = onDeck(ellZoneRing(strips).map((q) => rotateAbout(add(q, p.at), p.at, p.rotation)));
        if (ring.length > 0) rings.push({ side, ring });
      } else if (extent) {
        const quad = onDeck(sideBand(p, size.w, size.d, extent, side));
        if (quad.length > 0) {
          zones.push({ side, quad });
          rings.push({ side, ring: quad });
        }
      }
    }
    if (zones.length > 0) out.set(id, { zones, rings });
  }
  return out;
});

/** Each placement's use zones (`zoneShapes`): what clearance tests. */
export const useZones = memo((doc: Document): ReadonlyMap<string, readonly SideZone[]> => new Map([...zoneShapes(doc)].map(([id, z]) => [id, z.zones])));

/** Each placement's use zones as drawn (`zoneShapes`): one ring per active side, an `L` front's union once. */
export const zoneRings = memo((doc: Document): ReadonlyMap<string, readonly ZoneRing[]> => new Map([...zoneShapes(doc)].map(([id, z]) => [id, z.rings])));

/**
 * Wall bodies as rectangles from joint to joint, each its own thickness wide. On the room side this is exactly
 * the drawn body: outer miters lie outside the room (spec: walls-rooms), and bodies end flat.
 */
export const wallBodies = memo((doc: Document): Quads => {
  const out = new Map<string, readonly Point[]>();
  for (const id of sortedIds(doc.walls)) {
    const f = wallFrame(doc, id);
    if (!f) continue;
    const n = scale(f.left, f.half);
    out.set(id, [sub(f.a, n), sub(f.b, n), add(f.b, n), add(f.a, n)]);
  }
  return out;
});

/** The bodies of the rows based on the floor (`isFloorWall`), as `wallBodies` (pillars.24). */
export const floorWallBodies = memo((doc: Document): Quads => {
  const out = new Map<string, readonly Point[]>();
  for (const [id, body] of wallBodies(doc)) {
    const w = doc.walls[id];
    if (w && isFloorWall(w)) out.set(id, body);
  }
  return out;
});

/** The middle of a footprint quad (a rectangle): the midpoint of two opposite corners. */
export function quadCentre(quad: readonly Point[]): Point | null {
  const a = quad[0];
  const c = quad[2];
  return a && c ? { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } : null;
}

/**
 * The key of the room (face) a placement lies in: the innermost room holding its footprint's centre, if it holds
 * every point of its fit shape. (`at` lies on the back edge, so it can sit on a wall face; the centre is inside.)
 * A piece on a deck lies inside the deck instead, which may span rooms (decks.04): it belongs to the room holding its
 * centre, so free floor and room tags count it once, and fit asks this only of pieces on the floor.
 */
export function placementRoom(doc: Document, placementId: string): string | null {
  const ring = fitShapes(doc).get(placementId);
  const quad = footprints(doc).get(placementId);
  const centre = quad ? quadCentre(quad) : null;
  if (!ring || !centre) return null;
  const p = doc.placements[placementId];
  const onDeck = (p?.deck ?? null) !== null;
  if (onDeck) return faceAt(doc, centre)?.key ?? null;
  const kind = p ? (doc.objects[p.object]?.kind ?? "") : "";
  return isWell(kind) || isBeam(kind) ? wellRoom(doc, centre) : roomOf(doc, ring, centre);
}

/** The room holding a wheel well or a beam, which may run under or into walls: the one its centre lies in, outside every floor wall's body (trailer.13, beams.05). */
export function wellRoom(doc: Document, centre: Point | null): string | null {
  if (!centre) return null;
  for (const body of floorWallBodies(doc).values()) if (pointInPolygon(centre, body)) return null;
  return faceAt(doc, centre)?.key ?? null;
}

/**
 * The innermost room holding `centre`, if it holds every point of `ring`. `centre` defaults to a footprint quad's
 * middle: pass the footprint's centre for a ring that isn't the quad (a corner ring's opposite points are its back
 * edge's ends, `at` itself).
 */
export function roomOf(doc: Document, ring: readonly Point[], centre: Point | null = quadCentre(ring)): string | null {
  const face = centre ? faceAt(doc, centre) : null;
  return face && ring.every((c) => pointInPolygon(c, face.ring)) ? face.key : null;
}

export const placementKey = (id: string): EntityKey => ({ table: "placements", id });
export const wallKey = (id: string): EntityKey => ({ table: "walls", id });
export const openingKey = (id: string): EntityKey => ({ table: "openings", id });

export type Item = { key: EntityKey; quad: readonly Point[]; state: string | null; box: Box };

/** Footprints and floor walls' bodies in one list, for one bounding-box sweep (no all-pairs work, spec: domain). */
export function items(doc: Document, quads: Quads, states: (id: string) => string | null): Item[] {
  const out: Item[] = [];
  for (const [id, quad] of floorWallBodies(doc)) out.push({ key: wallKey(id), quad, state: null, box: boxOf(quad) });
  for (const [id, quad] of quads) out.push({ key: placementKey(id), quad, state: states(id), box: boxOf(quad) });
  return out;
}

/**
 * The anchor (the middle of the back edge) of a footprint `depth` deep, turned by `rotation`, whose centre is
 * `centre`: editors keep an object's centre where the user sees it when it turns, and store the anchor.
 */
export function anchorAt(centre: Point, depth: number, rotation: number): Point {
  return rotateAbout({ x: centre.x, y: centre.y + depth / 2 }, centre, rotation);
}

/**
 * Stored positions are kept to the millimetre (EPS): turning by an arbitrary angle gives long decimals. The one
 * millimetre rule, `toMm` (cleanup.39).
 */
export const roundMm = (v: number): number => toMm(v) / 1000;

/** `anchorAt`, to the millimetre: the anchor every editor and the MCP server store for a centre (spec: layouts, mcp). */
export function anchorAtMm(centre: Point, depth: number, rotation: number): Point {
  const at = anchorAt(centre, depth, rotation);
  return { x: roundMm(at.x), y: roundMm(at.y) };
}

/** The centre of a placement's footprint, or null without one. */
export function placementCentre(doc: Document, p: Placement): Point | null {
  const quad = footprints(doc).get(p.id);
  return quad ? quadCentre(quad) : null;
}

/** The anchor that puts a placement's footprint centre at `centre` when turned by `rotation`, to the millimetre. */
export function anchorFor(doc: Document, p: Placement, centre: Point, rotation: number): Point | null {
  const depth = depthOf(doc, p);
  return depth === null ? null : anchorAtMm(centre, depth, rotation);
}

/** The depth of a placement's current configuration, or null without its object. */
export function depthOf(doc: Document, p: Placement): number | null {
  return sizeOf(doc, p)?.d ?? null;
}
