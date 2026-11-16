import type { Document } from "@fm/domain";
import { patternShows, type FinishGeometry } from "./finish/geometry";
import { roomFinishes, type RoomFinish } from "./finish/rooms";
import { idsKey, idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import { upperLevel, type PlanView } from "./plan-view";
import type { Primitive } from "./scene-types";

// The floors layer on the canvas and on paper (finishes.03, .10, .18): each finished room's colour and pattern, below
// the room fills.

const NONE: readonly Primitive[] = [];

/**
 * The rooms whose pattern shows at `zoom` (drawing units per metre), as an `idsKey`: a spacing of at least `minSpacing`
 * drawing units, so `minSpacing / zoom` metres (finishes.06, .16). The layer takes this key, not the zoom, so a zoom
 * frame rebuilds it only when a room crosses its threshold (finishes.18).
 */
export function visibleRooms(doc: Document, zoom: number, minSpacing: number): string {
  return idsKey(roomFinishes(doc).filter((r) => patternShows(r.geometry, minSpacing / zoom)).map((r) => r.id));
}

/**
 * Finished rooms in `style`: every room's colour, then the patterns of the rooms in `visible` (an `idsKey` from
 * `visibleRooms`). Fills come first, as the GPU renderers draw a layer's polygons before its segments. Keyed on the
 * `roomFinishes` array, which stays the same while no finished room changes, so a furniture drag reuses the layer.
 */
export const finishesLayer = memoLast((rooms: readonly RoomFinish[], style: PlanStyle, visible: string): readonly Primitive[] => finishPrimitives(rooms, style, visible));

/**
 * Finished floors in `style` (rooms or decks): every one's colour, then the patterns of those in `visible` (an `idsKey`),
 * shapes before lines, fills before segments as the GPU renderers draw a layer.
 */
export function finishPrimitives(floors: readonly { id: string; geometry: FinishGeometry }[], style: PlanStyle, visible: string): readonly Primitive[] {
  const look = style.finish;
  if (look === null) return NONE;
  const shown = idsOf(visible);
  const out: Primitive[] = floors.map(({ geometry: { fill } }): Primitive => ({ kind: "polygon", points: fill.points, holes: fill.holes, color: fill.color }));
  const patterned = floors.filter((r) => shown.has(r.id)).map((r) => r.geometry);
  for (const g of patterned) for (const s of g.shapes) out.push({ kind: "polygon", points: s.points, holes: s.holes, color: s.color });
  for (const g of patterned) {
    for (const l of g.lines) out.push({ kind: "segment", a: l.a, b: l.b, width: { px: look.line }, color: l.color, cap: "butt" });
  }
  return out;
}

/**
 * The floors layer of a picture, the one guard for drawing floors: only when `on` (the viewer's switch, the export's
 * With), only at the floor level (levels.04), and only in a style with a finish, checked first so look tiles no room.
 */
export function floorsLayer(doc: Document, view: PlanView, style: PlanStyle, zoom: number, on: boolean): readonly Primitive[] {
  const finish = style.finish;
  if (!on || finish === null || upperLevel(view)) return NONE;
  return finishesLayer(roomFinishes(doc), style, visibleRooms(doc, zoom, finish.minSpacing));
}
