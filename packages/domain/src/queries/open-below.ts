import type { Point } from "@fm/protocol";
import { convexOverlap, distanceToSegment, pointInPolygon } from "../geometry";
import { sortedIds } from "../graph";
import { stairRuleOf } from "../kinds";
import { memo } from "../memo";
import type { Document } from "../model";
import { deckView } from "./decks";
import { floorRings } from "./floor";
import { footprints } from "./footprints";
import type { Level } from "./levels";
import { zones } from "./zones";

// What a loft's level leaves open to below (edges.07): the drawing labels these "Open to below". One owner, beside
// shownAt, of what a level shows (shown.07); the editor only places and draws the words. Nothing here is stored.
//
//   at the loft's level             a room the loft covers in part: one spot in its uncovered part,
//   ┌───────┬───────────────┐       the point farthest from every edge (the room's, its holes', the loft's);
//   │ Loft  ║       ·       │       an empty hole: its centre
//   │ ┌─┐   ║  Open to below│
//   │ │·│   ║               │
//   └─┴─┴───┴───────────────┘

/**
 * One label's spot: `at`, and `clear`, how far it is from the nearest edge, so a label wider than about twice that
 * doesn't fit. `room` is the room's face key, `hole` the hole's id: one of the two is null.
 */
export type OpenBelow = { at: Point; clear: number; room: string | null; hole: string | null };

/** The sampling grid's step in metres, coarser in a large room so a room never takes more than about MAX_SAMPLES points. */
const STEP = 0.1;
const MAX_SAMPLES = 6000;

type Ring = readonly Readonly<Point>[];

const ringDistance = (p: Point, ring: Ring): number =>
  ring.reduce((best, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return b === undefined ? best : Math.min(best, distanceToSegment(p, a, b));
  }, Number.POSITIVE_INFINITY);

const box = (ring: Ring): [number, number, number, number] => {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};

/** The rooms `decks` cover in part, each with its uncovered part's most open point; sampled on a grid, the first best kept. */
function rooms(doc: Document, decks: readonly Ring[]): OpenBelow[] {
  return zones(doc).flatMap((zone): OpenBelow[] => {
    const { outer, holes } = floorRings(zone);
    const [x0, x1, y0, y1] = box(outer);
    // Only rooms a deck's box reaches into are sampled; the sampling itself says whether one covers part of the room.
    if (!decks.some((d) => { const [a0, a1, b0, b1] = box(d); return a0 < x1 && a1 > x0 && b0 < y1 && b1 > y0; })) return [];
    const step = Math.max(STEP, Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_SAMPLES));
    let covered = false;
    let best: OpenBelow | null = null;
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        const p = { x, y };
        if (!pointInPolygon(p, outer) || holes.some((h) => pointInPolygon(p, h))) continue;
        if (decks.some((d) => pointInPolygon(p, d))) {
          covered = true;
          continue;
        }
        const clear = Math.min(ringDistance(p, outer), ...holes.map((h) => ringDistance(p, h)), ...decks.map((d) => ringDistance(p, d)));
        if (best === null || clear > best.clear + 1e-9) best = { at: p, clear, room: zone.face.key, hole: null };
      }
    }
    return covered && best !== null ? [best] : [];
  });
}

/** The holes of the level's decks with no stair standing in them, at their centres. */
function emptyHoles(doc: Document, deckIds: readonly string[]): OpenBelow[] {
  const quads = footprints(doc);
  const stairs = sortedIds(doc.placements).flatMap((id) => {
    const p = doc.placements[id];
    const quad = quads.get(id);
    return p && quad && stairRuleOf(doc.objects[p.object]?.kind ?? "") !== null ? [quad] : [];
  });
  return deckIds.flatMap((id) => deckView(doc, id)?.holes ?? [])
    .filter((h) => !stairs.some((q) => convexOverlap(q, h.ring)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((h) => ({ at: h.at, clear: Math.min(h.w, h.d) / 2, room: null, hole: h.id }));
}

const byLevel = memo((): Map<string, readonly OpenBelow[]> => new Map());

/** What `level` leaves open to below: nothing at the floor; at a loft's level, its rooms then its empty holes. */
export function openBelow(doc: Document, level: Level): readonly OpenBelow[] {
  if (level.deckIds.length === 0) return [];
  const key = level.deckIds.join("|");
  const cache = byLevel(doc);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const rings = level.deckIds.flatMap((id) => { const v = deckView(doc, id); return v ? [v.ring] : []; });
  const found = [...rooms(doc, rings), ...emptyHoles(doc, level.deckIds)];
  cache.set(key, found);
  return found;
}
