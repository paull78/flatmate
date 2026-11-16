import { signedArea } from "../geometry";
import { sortedIds } from "../graph";
import { memo } from "../memo";
import type { Document } from "../model";
import { pieceArea } from "../shapes";
import { footprints, placementRoom, placementRug, sizeOf } from "./footprints";
import { isFloor, placementLevel } from "./levels";
import { tucks } from "./tucks";
import { coveredWell, partArea, placementWellPart } from "./wells";
import { clearAbove, placementRange } from "./vertical";
import { zones } from "./zones";

/** Whether the placement stands on a loft: a room's free floor and its tag stop at a loft, which has no room (spec: levels). */
function onLoft(doc: Document, placementId: string): boolean {
  const level = placementLevel(doc, placementId);
  return level !== null && !isFloor(level);
}

/**
 * Free floor per room for one state: the room's clear area minus the shape areas of the state's placements in it
 * (layout-states.14, shapefit.01), never below 0; a rug (catalog.15) and a piece from ZONE_CLEAR_ABOVE up take no floor, and pieces stacked in
 * plan below it are each counted (heights.36), except a seat tucked under a piece you sit at: their overlap is added
 * back once (seating.09), exact since tables never overlap tables nor seats seats. Null where the clear area is
 * unavailable. A piece standing on a loft takes no floor from the room under it, whatever its height; one on a platform
 * or a raised floor counts as on the floor (decks.34). Keyed by room (face) key.
 */
export function freeFloor(doc: Document, stateId: string): ReadonlyMap<string, number | null> {
  const used = new Map<string, number>();
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const range = p ? placementRange(doc, id) : null;
    if (!p || p.state !== stateId || (range !== null && clearAbove(range)) || onLoft(doc, id)) continue;
    const room = placementRoom(doc, id);
    const size = sizeOf(doc, p);
    const object = doc.objects[p.object];
    if (room === null || !size || !object || placementRug(doc, id)) continue;
    const well = placementWellPart(doc, id); // a well takes its part outside the walls, nothing where a piece covers it (trailer.11)
    const area = well === null ? pieceArea(object.kind, size.w, size.d, object.arms) : coveredWell(doc, id, well) ? 0 : partArea(well);
    used.set(room, (used.get(room) ?? 0) + area);
  }
  const takesFloor = (id: string): boolean => {
    const range = placementRange(doc, id);
    return (range === null || !clearAbove(range)) && !onLoft(doc, id);
  };
  for (const t of tucks(doc)) {
    const room = t.state === stateId && takesFloor(t.seat) && takesFloor(t.table) ? placementRoom(doc, t.seat) : null;
    if (room !== null) used.set(room, (used.get(room) ?? 0) - Math.abs(signedArea(t.overlap)));
  }
  const out = new Map<string, number | null>();
  for (const z of zones(doc)) out.set(z.face.key, z.area === null ? null : Math.max(0, z.area - (used.get(z.face.key) ?? 0)));
  return out;
}

/**
 * Rooms that hold a placement in some state: their tags show free floor (spec: layouts). A piece standing on a loft
 * furnishes no room (spec: levels). Cached by document.
 */
export const furnishedRooms = memo((doc: Document): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const id of footprints(doc).keys()) {
    const room = onLoft(doc, id) ? null : placementRoom(doc, id);
    if (room !== null) out.add(room);
  }
  return out;
});
