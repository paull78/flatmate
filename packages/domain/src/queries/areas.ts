import type { Point } from "@fm/protocol";
import { convexIntersection, signedArea } from "../geometry";
import type { Area, Document } from "../model";
import { faceAt, zones, type Zone } from "./zones";

// An area's room and m² (areas.04, .17): one owner, read by its tag, Properties, the rooms table and MCP.

/** An area's rectangle, counter-clockwise from its lower left corner. */
export function areaRing(area: Pick<Area, "at" | "w" | "d">): Point[] {
  const [x0, x1, y0, y1] = [area.at.x - area.w / 2, area.at.x + area.w / 2, area.at.y - area.d / 2, area.at.y + area.d / 2];
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** The room holding an area's centre, or null for one outside every room (a wall moved, areas.04) or an unknown ID. */
export function areaRoom(doc: Document, areaId: string): Zone | null {
  const area = Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  const face = area ? faceAt(doc, area.at) : null;
  return face ? (zones(doc).find((z) => z.face.key === face.key) ?? null) : null;
}

const clippedArea = (ring: readonly Readonly<Point>[], rect: readonly Point[]): number => Math.abs(signedArea(convexIntersection(ring, rect)));

/**
 * An area's m²: its rectangle cut to its room's clear floor, less the footprints of columns and wall groups standing in
 * it. Null when its room is unknown or its room's area is unavailable.
 */
export function areaM2(doc: Document, areaId: string): number | null {
  const area = Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  const room = areaRoom(doc, areaId);
  if (!area || !room || room.floor === null || room.area === null) return null;
  const rect = areaRing(area);
  const holes = room.holes.reduce((sum, h) => sum + (h.footprint ? clippedArea(h.footprint, rect) : 0), 0);
  return Math.max(0, clippedArea(room.floor, rect) - holes);
}
