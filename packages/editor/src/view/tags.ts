import { formatArea } from "./area-text";
import { freeFloor, furnishedRooms, interiorPoint, isValidId, sortedIds, zoneOfLabel as domainZoneOfLabel, type Document, type Zone, shown } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { textWidth } from "./fonts";
import { plateBox } from "./labels";
import { CANVAS_STYLE, type PlanStyle } from "./plan-style";
import { frameOnFloor, tagObstacles, tagOffset, type Frame, type TagObstacle } from "./tag-spot";

// Zone tags (spec: walls-rooms): the name, the clear size of a rectangular room (export.09), then the clear area, centred
// on the label point.
export const AREA_UNAVAILABLE_SHORT = "Area unavailable";
export const ORPHAN_TEXT = "no enclosing walls";

type TagLine = { text: string; at: Point; role: "name" | "size" | "area" };
/** Every line, or fewer when they don't fit its room: the size line drops first, then the area, the name last (export.34). */
export type TagLayout = { labelId: string; lines: [TagLine, ...TagLine[]]; min: Point; max: Point };

const RIGHT_ANGLE_TOLERANCE = (0.5 * Math.PI) / 180;
const COLLINEAR = 1e-9;

/**
 * "4.20 × 3.10 m": the clear interior of a room whose clear outline is a rectangle (four corners at right angles
 * within 0.5°), the side closer to horizontal first, to the centimetre (export.09). Null for any other shape, a room
 * with holes other than free columns (pillars.34), an unavailable area or an orphan.
 */
export function roomSizeText(zone: Zone | null): string | null {
  if (!zone || zone.face.holes.some((h) => !h.column)) return null;
  const ring = zone.floor ? corners(zone.floor) : null;
  if (!ring || ring.length !== 4) return null;
  const sides = ring.map((p, i) => {
    const q = ring[(i + 1) % 4] ?? p;
    return { x: q.x - p.x, y: q.y - p.y };
  });
  for (let i = 0; i < 4; i++) {
    const a = sides[i];
    const b = sides[(i + 1) % 4];
    if (!a || !b) return null;
    const angle = Math.atan2(Math.abs(a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y);
    if (Math.abs(angle - Math.PI / 2) > RIGHT_ANGLE_TOLERANCE) return null;
  }
  const [s0, s1] = sides;
  if (!s0 || !s1) return null;
  const tilt = (s: Point): number => Math.abs(Math.atan2(s.y, s.x)) % Math.PI; // 0 or π: horizontal
  const offHorizontal = (s: Point): number => Math.min(tilt(s), Math.PI - tilt(s));
  const [first, second] = offHorizontal(s0) <= offHorizontal(s1) ? [s0, s1] : [s1, s0];
  return `${shown(Math.hypot(first.x, first.y))} × ${shown(Math.hypot(second.x, second.y))} m`;
}

/** The ring without points that sit on a straight run (a joint in the middle of a wall). */
function corners(ring: readonly Readonly<Point>[]): Point[] {
  return ring.filter((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length] ?? p;
    const next = ring[(i + 1) % ring.length] ?? p;
    const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
    return Math.abs(cross) > COLLINEAR;
  });
}

export { formatArea }; // its own leaf module (area-text.ts), re-exported so imports stay here

/** The derived zone that holds this label, or null for an orphan: a lookup in the domain's cached rooms (spec: walls-rooms). */
export function zoneOfLabel(doc: Document, labelId: string): Zone | null {
  return domainZoneOfLabel(doc, labelId);
}

/** The tag's area line, its last: the clear area, a short unavailable note, or the orphan note. */
function tagAreaText(zone: Zone | null): string {
  if (!zone) return ORPHAN_TEXT;
  return zone.area !== null ? formatArea(zone.area) : AREA_UNAVAILABLE_SHORT;
}

/**
 * The tag's area line in a layout drawing (spec: layouts): the clear area, then the free floor of the active state
 * rounded to 0.1 m² ("22.04 m² · free 18.8 m²"), in rooms that hold furniture in some state. Other rooms, and
 * drawings without objects, keep the plain area.
 */
function tagAreaTextFor(doc: Document, zone: Zone | null, layout: string | null): string {
  const base = tagAreaText(zone);
  if (!zone || zone.area === null || layout === null || !furnishedRooms(doc).has(zone.face.key)) return base;
  const free = freeFloor(doc, layout).get(zone.face.key);
  return free === null || free === undefined ? base : `${base} · free ${shown(free, 1)} m²`;
}

/** The properties "Area" field: the clear area, the domain's reason when unavailable, or the orphan note. */
export function areaFieldText(zone: Zone | null): string {
  if (!zone) return ORPHAN_TEXT;
  return zone.area !== null ? formatArea(zone.area) : (zone.unavailable ?? AREA_UNAVAILABLE_SHORT);
}

/**
 * The tag as drawn and hit-tested, with the box used for its plate (spec: editor): every line (name, size, area) if that
 * box's corners are on its zone's floor, else without the size, else the name alone centred on the label point if that
 * fits, else null (hidden). The chosen lines then move to the first free spot around the point (C4). An orphan always
 * shows its lines, at its point. Null also when the label does not exist.
 */
export function tagLayout(
  doc: Document,
  labelId: string,
  camera: Pick<Camera, "zoom">,
  layout: string | null,
  style: PlanStyle = CANVAS_STYLE,
): TagLayout | null {
  // Cached per document → zoom, active state and style (spec: editor, layouts): nothing else feeds a layout (the font
  // tables are constants, render.15), and documents are immutable values.
  const cached = cacheFor(doc, camera.zoom, layout, style);
  const hit = cached.layouts.get(labelId);
  if (hit !== undefined) return hit;
  const computed = computeTagLayout(doc, labelId, cached);
  cached.layouts.set(labelId, computed);
  return computed;
}

/** `obstacles` are built on first need, once per entry (C4). */
export type TagCache = { zoom: number; layout: string | null; style: PlanStyle; layouts: Map<string, TagLayout | null>; obstacles: readonly TagObstacle[] | null; roomTags: readonly TagObstacle[] | null };

/** One zoom per document and style: panning reuses it, a zoom step replaces it. Shared results: read-only for callers. */
const layoutCache = new WeakMap<Document, TagCache[]>();
const MAX_STYLES = 2; // the canvas and one export at a time in the browser, the canvas and look in the MCP: a third
// style only costs recomputation

export function cacheFor(doc: Document, zoom: number, layout: string | null, style: PlanStyle): TagCache {
  const entries = layoutCache.get(doc) ?? [];
  let cached = entries.find((c) => c.style === style);
  if (!cached || cached.zoom !== zoom || cached.layout !== layout) {
    cached = { zoom, layout, style, layouts: new Map(), obstacles: null, roomTags: null };
    layoutCache.set(doc, [cached, ...entries.filter((c) => c.style !== style)].slice(0, MAX_STYLES));
  }
  return cached;
}

function computeTagLayout(doc: Document, labelId: string, cached: TagCache): TagLayout | null {
  // The ID may come from outside the document: an Object.prototype member name would find the inherited member.
  const label = isValidId(labelId) ? doc.zoneLabels[labelId] : undefined;
  if (!label) return null;
  const { zoom, layout, style } = cached;
  const tag = style.tag;
  const at = label.at;
  const zone = zoneOfLabel(doc, labelId);
  const all: { text: string; role: TagLine["role"] }[] = [{ text: label.name, role: "name" }];
  const size = roomSizeText(zone);
  if (size !== null) all.push({ text: size, role: "size" });
  all.push({ text: tagAreaTextFor(doc, zone, layout), role: "area" });
  // The first set that fits at the point (the clear floor, as drawn): every line, then without the size, then the name
  // alone (export.34); centred on the label point, one line apart. An orphan always fits and never moves.
  const sets = [all, all.filter((l) => l.role !== "size"), all.slice(0, 1)].filter((s, i, arr) => i === 0 || s.length < (arr[i - 1]?.length ?? 0));
  for (const shown of sets) {
    const k = shown.length;
    const width = Math.max(...shown.map((l) => textWidth(style.font, l.text, tag.size)));
    const frame = plateBox(at, width, k, tag, zoom);
    if (zone && !frameOnFloor(zone, frame)) continue;
    const lines = shown.map((l, i): TagLine => ({ ...l, at: { x: at.x, y: at.y + (((k - 1) / 2 - i) * tag.line) / zoom } }));
    const [first, ...rest] = lines;
    if (!first) continue;
    const placed: TagLayout = { labelId, lines: [first, ...rest], ...frame };
    return zone ? moved(placed, zone, doc, cached) : placed;
  }
  return null;
}

/**
 * The tag at the first free spot around where it was laid out (C4): the same object when that is where it was. An area's
 * tag also stays `within` its rectangle and keeps off `extra`, its room's tags (areas.03).
 */
export function moved(tag: TagLayout, zone: Zone, doc: Document, cached: TagCache, within: Frame | null = null, extra: readonly TagObstacle[] = []): TagLayout {
  cached.obstacles ??= tagObstacles(doc, cached.layout, cached.style, cached.zoom);
  const d = tagOffset(tag, zone, extra.length === 0 ? cached.obstacles : [...cached.obstacles, ...extra], within);
  if (d.x === 0 && d.y === 0) return tag;
  const shift = (p: Point): Point => ({ x: p.x + d.x, y: p.y + d.y });
  const [first, ...rest] = tag.lines;
  const line = (l: TagLine): TagLine => ({ ...l, at: shift(l.at) });
  return { labelId: tag.labelId, lines: [line(first), ...rest.map(line)], min: shift(tag.min), max: shift(tag.max) };
}

export function inBox(p: Point, min: Point, max: Point): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

/** The label whose tag contains p. Where tags overlap, the last drawn (highest ID) wins. */
export function tagAt(doc: Document, p: Point, camera: Camera, layout: string | null): string | null {
  let found: string | null = null;
  for (const id of sortedIds(doc.zoneLabels)) {
    const tag = tagLayout(doc, id, camera, layout);
    if (tag && inBox(p, tag.min, tag.max)) found = id;
  }
  return found;
}

/**
 * The tag of an unlabelled room that holds furniture in some layout (layout-states.51): one line, the clear area and
 * the active layout's free floor, at a point inside the room or the first free spot around it (C4); null when the
 * room has a label, no furniture or no room for the tag at that point. Never hit-tested: clicks reach the floor and
 * the objects. Cached with the label tags.
 */
export function roomTagLayout(
  doc: Document,
  zone: Zone,
  camera: Pick<Camera, "zoom">,
  layout: string | null,
  style: PlanStyle = CANVAS_STYLE,
): TagLayout | null {
  if (zone.labelIds.length > 0 || layout === null || !furnishedRooms(doc).has(zone.face.key)) return null;
  const key = `|room|${zone.face.key}`; // "|" is outside the ID alphabet: no label has this key
  const cached = cacheFor(doc, camera.zoom, layout, style);
  const tag = style.tag;
  const hit = cached.layouts.get(key);
  if (hit !== undefined) return hit;
  const at = interiorPoint(zone);
  let result: TagLayout | null = null;
  if (at) {
    const text = tagAreaTextFor(doc, zone, layout);
    const frame = plateBox(at, textWidth(style.font, text, tag.size), 1, tag, camera.zoom);
    if (frameOnFloor(zone, frame)) result = moved({ labelId: key, lines: [{ text, at, role: "area" }], ...frame }, zone, doc, cached);
  }
  cached.layouts.set(key, result);
  return result;
}

