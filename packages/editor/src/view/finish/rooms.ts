import { deckViews, doorSpans, firstLabelId, floorRings, roomFinish, zones, type Document } from "@fm/domain";
import { memoLast } from "../memo";
import { createFinishCache, type FinishGeometry, type FinishRoom } from "./geometry";

// The document's finished rooms and decks, shared by the canvas, the picture, 3D and the Properties panel
// (finishes.18, .41, deck-floors.06).

/** A finished room: its first label's ID (the one whose finish it shows), its face key and its geometry. */
export type RoomFinish = { id: string; room: string; geometry: FinishGeometry };
/** A finished deck: its ID and its top's geometry, holes cut out. */
export type DeckFinish = { id: string; geometry: FinishGeometry };
/** A door's span showing a finished room's floor (thresholds.06): the door's ID, the room's face key, the span's geometry. */
export type SpanFinish = { id: string; room: string; geometry: FinishGeometry };

// Keyed by value, one build for rooms and decks together, since the cache holds only its last build: two builds would
// evict each other and tile on every call (deck-floors.08). Only callers with other inputs (the palette's swatches)
// call finishGeometry directly (finishes.31).
const cache = createFinishCache();

let lastRooms: readonly RoomFinish[] = [];
let lastDecks: readonly DeckFinish[] = [];
let lastSpans: readonly SpanFinish[] = [];

/** Whether two builds hold the same entries: keys and geometry objects, in order. */
function same<T extends { id: string; geometry: FinishGeometry }>(a: readonly T[], b: readonly T[], key: (t: T) => string): boolean {
  return a.length === b.length && a.every((r, i) => {
    const o = b[i];
    return o !== undefined && key(r) === key(o) && r.geometry === o.geometry;
  });
}

/**
 * Every finished room, in `zones` order, and every finished deck, in `deckViews` order, through the value-keyed cache:
 * a document that changes no floor or finish (a furniture drag, a flip) gets each geometry back (finishes.18), and the
 * previous arrays themselves, so the layers keyed on them are reused on every drag frame. A room's fill polygon is the
 * zone fill's; a deck's is its slab with each hole clockwise, as its tint draws it.
 */
const built = memoLast((doc: Document): { rooms: readonly RoomFinish[]; decks: readonly DeckFinish[]; spans: readonly SpanFinish[] } => {
  const rooms: (FinishRoom & { id: string; room: string })[] = [];
  for (const z of zones(doc)) {
    const finish = roomFinish(doc, z);
    const id = firstLabelId(z);
    if (finish === null || id === null) continue;
    const { outer, holes } = floorRings(z);
    rooms.push({ id, room: z.face.key, ring: outer, holes, finish });
  }
  const decks: (FinishRoom & { id: string })[] = [];
  for (const v of deckViews(doc)) {
    if (v.finish !== null) decks.push({ id: v.id, ring: v.ring, holes: v.holes.map((h) => [...h.ring].reverse()), finish: v.finish });
  }
  // A door's span in its room's finish, laid from the origin as the room is, so its joints run on (thresholds.06).
  const finishOf = new Map(zones(doc).map((z) => [z.face.key, roomFinish(doc, z)]));
  const spans: (FinishRoom & { id: string; room: string })[] = [];
  for (const s of doorSpans(doc)) {
    const finish = s.room === null ? null : finishOf.get(s.room) ?? null;
    if (s.room !== null && finish !== null) spans.push({ id: s.openingId, room: s.room, ring: s.ring, holes: [], finish });
  }
  const geometry = cache.build([...rooms, ...decks, ...spans]);
  const nextRooms = rooms.flatMap(({ id, room }, i) => {
    const g = geometry[i];
    return g ? [{ id, room, geometry: g }] : [];
  });
  const nextDecks = decks.flatMap(({ id }, i) => {
    const g = geometry[rooms.length + i];
    return g ? [{ id, geometry: g }] : [];
  });
  const nextSpans = spans.flatMap(({ id, room }, i) => {
    const g = geometry[rooms.length + decks.length + i];
    return g ? [{ id, room, geometry: g }] : [];
  });
  if (!same(nextRooms, lastRooms, (r) => `${r.id}|${r.room}`)) lastRooms = nextRooms;
  if (!same(nextDecks, lastDecks, (d) => d.id)) lastDecks = nextDecks;
  if (!same(nextSpans, lastSpans, (d) => `${d.id}|${d.room}`)) lastSpans = nextSpans;
  return { rooms: lastRooms, decks: lastDecks, spans: lastSpans };
});

/** Every finished room (see `built`). */
export function roomFinishes(doc: Document): readonly RoomFinish[] {
  return built(doc).rooms;
}

/** Every finished deck (see `built`). */
export function deckFinishes(doc: Document): readonly DeckFinish[] {
  return built(doc).decks;
}

/** Every door span showing a finished room's floor (see `built`). */
export function spanFinishes(doc: Document): readonly SpanFinish[] {
  return built(doc).spans;
}
