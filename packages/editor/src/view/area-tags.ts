import { areaM2, areaName, areaRoom, boxOf, isValidId, sortedIds, zones, type Document } from "@fm/domain";
import type { Camera } from "../camera";
import { textWidth } from "./fonts";
import { plateBox } from "./labels";
import { CANVAS_STYLE, type PlanStyle } from "./plan-style";
import { frameOnFloor, frameRing, frameWithin, type Frame, type TagObstacle } from "./tag-spot";
import { AREA_UNAVAILABLE_SHORT, ORPHAN_TEXT, cacheFor, formatArea, inBox, moved, roomTagLayout, tagLayout, type TagCache, type TagLayout } from "./tags";

// A named area's tag (areas.02, .03): like a room's, its name over its m² in the muted ink, no size line and no free
// floor; centred on the rectangle, moved to the first free spot inside it by the room tags' rule (tidy.13), clear of the
// room tags, which are placed first. Cached with the room tags, per document, zoom, layout and style.

const key = (areaId: string): string => `|area|${areaId}`; // "|" is outside the ID alphabet: no label has this key

/** The room tags as obstacles for the area tags, built once per cache entry. */
function roomTags(doc: Document, cached: TagCache): readonly TagObstacle[] {
  if (cached.roomTags) return cached.roomTags;
  const camera = { zoom: cached.zoom };
  const tags = [
    ...sortedIds(doc.zoneLabels).map((id) => tagLayout(doc, id, camera, cached.layout, cached.style)),
    ...zones(doc).map((z) => roomTagLayout(doc, z, camera, cached.layout, cached.style)),
  ];
  cached.roomTags = tags.flatMap((t) => (t ? [{ ring: frameRing(t), box: boxOf(frameRing(t)) }] : []));
  return cached.roomTags;
}

/**
 * An area's tag as drawn and hit-tested: its name and m² if their box lies inside the rectangle (and on its room's
 * floor), else its name alone, else null (hidden). Its `labelId` is the area's ID. An area outside every room reads "no
 * enclosing walls" and stays at its centre.
 */
export function areaTagLayout(doc: Document, areaId: string, camera: Pick<Camera, "zoom">, layout: string | null, style: PlanStyle = CANVAS_STYLE): TagLayout | null {
  const cached = cacheFor(doc, camera.zoom, layout, style);
  const hit = cached.layouts.get(key(areaId));
  if (hit !== undefined) return hit;
  const computed = computeAreaTag(doc, areaId, cached);
  cached.layouts.set(key(areaId), computed);
  return computed;
}

function computeAreaTag(doc: Document, areaId: string, cached: TagCache): TagLayout | null {
  const area = isValidId(areaId) && Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  if (!area) return null;
  const { zoom, style } = cached;
  const tag = style.tag;
  const zone = areaRoom(doc, areaId);
  const m2 = areaM2(doc, areaId);
  const second = !zone ? ORPHAN_TEXT : m2 === null ? AREA_UNAVAILABLE_SHORT : formatArea(m2);
  const rect: Frame = { min: { x: area.at.x - area.w / 2, y: area.at.y - area.d / 2 }, max: { x: area.at.x + area.w / 2, y: area.at.y + area.d / 2 } };
  const all = [{ text: areaName(area), role: "name" as const }, { text: second, role: "area" as const }];
  for (const lines of [all, all.slice(0, 1)]) {
    const k = lines.length;
    const width = Math.max(...lines.map((l) => textWidth(style.font, l.text, tag.size)));
    const frame = plateBox(area.at, width, k, tag, zoom);
    if (!frameWithin(frame, rect) || (zone && !frameOnFloor(zone, frame))) continue;
    const placed = lines.map((l, i) => ({ ...l, at: { x: area.at.x, y: area.at.y + (((k - 1) / 2 - i) * tag.line) / zoom } }));
    const [first, ...rest] = placed;
    if (!first) continue;
    const laid: TagLayout = { labelId: areaId, lines: [first, ...rest], ...frame };
    return zone ? moved(laid, zone, doc, cached, rect, roomTags(doc, cached)) : laid;
  }
  return null;
}

/** Every area's tag at the floor, in ID order, the hidden ones left out. */
export function areaTags(doc: Document, camera: Pick<Camera, "zoom">, layout: string | null, style: PlanStyle = CANVAS_STYLE): TagLayout[] {
  return sortedIds(doc.areas).flatMap((id) => areaTagLayout(doc, id, camera, layout, style) ?? []);
}

/** The area whose tag contains p; where tags overlap, the highest ID. */
export function areaTagAt(doc: Document, p: { x: number; y: number }, camera: Pick<Camera, "zoom">, layout: string | null): string | null {
  let found: string | null = null;
  for (const tag of areaTags(doc, camera, layout)) if (inBox(p, tag.min, tag.max)) found = tag.labelId;
  return found;
}
