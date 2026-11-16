import { EPS, boxOf, convexOverlap, fitParts, floorRings, levelOf, onFloor, placementRug, shownAt, wallBodies, type Box, type Document, type Zone } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { deckLabelBox, labelledDecks } from "./deck-label";
import type { PlanStyle } from "./plan-style";

// Room tags keep off furniture (spec "Room tags keep off furniture", tidy.13): a tag moves from its point to the first
// free spot of a fixed lattice around it, or stays put when there is none.

export type Frame = { min: Point; max: Point };
/** Something a tag keeps off: a convex ring and its bounding box, the cheap test first. */
export type TagObstacle = { ring: readonly Point[]; box: Box };

const STEP_M = 0.25;
const REACH = 8; // lattice steps: out to 2 m

/**
 * The offsets (0.25·i, 0.25·j) m with i² + j² ≤ 64, by i² + j², then j descending (up first), then i ascending: integer
 * keys, so the order has no float ties. The first is (0, 0), the tag's own point.
 */
export const TAG_SPOTS: readonly Point[] = (() => {
  const keys: [number, number][] = [];
  for (let i = -REACH; i <= REACH; i++) {
    for (let j = -REACH; j <= REACH; j++) if (i * i + j * j <= REACH * REACH) keys.push([i, j]);
  }
  keys.sort(([ai, aj], [bi, bj]) => ai * ai + aj * aj - (bi * bi + bj * bj) || bj - aj || ai - bi);
  return keys.map(([i, j]) => ({ x: STEP_M * i, y: STEP_M * j }));
})();

/**
 * What a floor tag keeps off: the drawn shape of every piece of `layout` the floor level shows, as its convex parts
 * (an `L`'s two arms, catalog.16; none without a layout; not a loft's, shown.02; not a rug's, catalog.15), the box of every deck label drawn at the floor, and every wall body. `zoom` is drawing units
 * per metre, as the tags use.
 */
export function tagObstacles(doc: Document, layout: string | null, style: PlanStyle, zoom: number): TagObstacle[] {
  const rings: (readonly Point[])[] = [];
  const floor = levelOf(doc, null);
  if (layout !== null) {
    for (const [id, parts] of fitParts(doc)) if (doc.placements[id]?.state === layout && !placementRug(doc, id) && shownAt(doc, id, floor)) rings.push(...parts);
  }
  for (const deck of labelledDecks(doc, floor)) rings.push(frameRing(deckLabelBox(deck, style, zoom)));
  rings.push(...wallBodies(doc).values());
  return rings.map((ring) => ({ ring, box: boxOf(ring) }));
}

/** Whether the box's four corners are on the room's floor (lenient over holes, holes.10). */
export function frameOnFloor(zone: Zone, frame: Frame): boolean {
  return frameRing(frame).every((corner) => onFloor(zone, corner));
}

/**
 * The offset of the first lattice spot where `frame` is free: its corners on the floor (and inside `within`, an area's
 * rectangle, areas.03), no corner of the floor or of a hole inside it, and overlapping no obstacle beyond touching.
 * (0, 0) when the frame is free where it is, or when no spot is. With its corners on the floor, a box can only leave the floor around a floor corner inside it: at a room's
 * inner corner no wall body covers the joint, which matters once the walls aren't square to the box (tidy.25).
 */
export function tagOffset(frame: Frame, zone: Zone, obstacles: readonly TagObstacle[], within: Frame | null = null): Point {
  const { outer, holes } = floorRings(zone);
  const corners = [...outer, ...holes.flat()];
  for (const d of TAG_SPOTS) {
    const min = { x: frame.min.x + d.x, y: frame.min.y + d.y };
    const max = { x: frame.max.x + d.x, y: frame.max.y + d.y };
    const free = frameOnFloor(zone, { min, max }) && (within === null || frameWithin({ min, max }, within)) && !corners.some((c) => strictlyInside(c, min, max)) && !obstacles.some((o) => overlaps({ min, max }, o));
    if (free) return d;
  }
  return { x: 0, y: 0 };
}

/** Whether `frame` lies inside `bound`, within the domain's tolerance. */
export function frameWithin(frame: Frame, bound: Frame): boolean {
  return frame.min.x >= bound.min.x - EPS && frame.min.y >= bound.min.y - EPS && frame.max.x <= bound.max.x + EPS && frame.max.y <= bound.max.y + EPS;
}

/** Inside the box by more than the domain's touching tolerance on every side. */
function strictlyInside(p: Point, min: Point, max: Point): boolean {
  return p.x > min.x + EPS && p.x < max.x - EPS && p.y > min.y + EPS && p.y < max.y - EPS;
}

function overlaps(frame: Frame, o: TagObstacle): boolean {
  const { min, max } = frame;
  if (o.box.maxX <= min.x || o.box.minX >= max.x || o.box.maxY <= min.y || o.box.minY >= max.y) return false;
  return convexOverlap(frameRing(frame), o.ring);
}

export function frameRing({ min, max }: Frame): Point[] {
  return [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
}
