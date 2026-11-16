import { add, anchorAtMm, anchorFor, boxOf, depthOf, footprints, placementCentre, rotateAbout, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Places } from "./types";

/**
 * Turning an object in the editor (`R`, the angle field) keeps its centre where the user sees it; the domain turns
 * about the anchor, so the move carries the new anchor (layout-states.49).
 */
export function turnInPlace(doc: Document, p: Placement, rotation: number): Command | null {
  const centre = placementCentre(doc, p);
  const at = centre ? anchorFor(doc, p, centre, rotation) : null;
  return at ? { type: "movePlacement", placementId: p.id, at, rotation } : null;
}

/**
 * R on a group (direct.08): the group turns 90° counter-clockwise about the centre of its bounding box, and each
 * piece turns with it, keeping its place in the group. Null when a piece has no footprint.
 */
export function turnGroup(doc: Document, placementIds: string[]): Command | null {
  const moves = turnedPlaces(doc, placementIds, groupCentre(doc, placementIds), 90, { x: 0, y: 0 });
  return moves ? { type: "movePlacements", moves } : null;
}

/** The centre of the bounding box of the placements' footprints: what a group turns about and is placed by. */
export function groupCentre(doc: Document, placementIds: readonly string[]): Point {
  const quads = footprints(doc);
  const box = boxOf(placementIds.flatMap((id) => quads.get(id) ?? []));
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/**
 * The places of `placementIds` turned `turn` degrees counter-clockwise about `c`, then moved by `offset`: each centre
 * turns and moves, each rotation gains `turn` (not normalised; the domain does that). Null when a piece has no footprint.
 */
export function turnedPlaces(doc: Document, placementIds: readonly string[], c: Point, turn: number, offset: Point): Places | null {
  const places: Places = [];
  for (const id of placementIds) {
    const p = doc.placements[id];
    const centre = p ? placementCentre(doc, p) : null;
    const depth = p ? depthOf(doc, p) : null;
    if (!p || !centre || depth === null) return null; // no footprint
    const rotation = p.rotation + turn;
    places.push({ placementId: id, at: anchorAtMm(add(rotateAbout(centre, c, turn), offset), depth, rotation), rotation });
  }
  return places;
}
