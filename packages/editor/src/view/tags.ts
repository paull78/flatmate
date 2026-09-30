import { isValidId, pointInPolygon, sortedIds, zones, type Document, type Zone } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Host } from "../ports/host";
import { TAG_FONT } from "./fonts";

// Zone tags (spec §3.6): the name above, the clear area below, centred on the label point.
export const TAG_LINE_PX = 16; // distance between the two line centres
export const TAG_PAD_PX = 4;
export const AREA_UNAVAILABLE_SHORT = "Area unavailable";
export const ORPHAN_TEXT = "no enclosing walls";

export type TagLine = { text: string; at: Point; role: "name" | "area" };
/** Both lines, or the name alone when only that fits its room (spec §5.9). */
export type TagLayout = { labelId: string; lines: [TagLine, TagLine] | [TagLine]; min: Point; max: Point };

export function formatArea(area: number): string {
  return `${area.toFixed(2)} m²`;
}

/** The derived zone that holds this label, or null for an orphan. */
export function zoneOfLabel(doc: Document, labelId: string): Zone | null {
  return zones(doc).find((z) => z.labelIds.includes(labelId)) ?? null;
}

/** Second tag line: the clear area, a short unavailable note, or the orphan note. */
export function tagAreaText(zone: Zone | null): string {
  if (!zone) return ORPHAN_TEXT;
  return zone.area !== null ? formatArea(zone.area) : AREA_UNAVAILABLE_SHORT;
}

/** The properties "Area" field: the clear area, the domain's reason when unavailable, or the orphan note. */
export function areaFieldText(zone: Zone | null): string {
  if (!zone) return ORPHAN_TEXT;
  return zone.area !== null ? formatArea(zone.area) : (zone.unavailable ?? AREA_UNAVAILABLE_SHORT);
}

/**
 * The tag as drawn and hit-tested, with the box used for its plate (spec §5.9): both lines if that box fits inside
 * its zone's outline, else the name alone centred on the label point if that fits, else null (hidden). An orphan
 * always shows both lines. Null also when the label does not exist.
 */
export function tagLayout(doc: Document, labelId: string, camera: Camera, host: Host): TagLayout | null {
  // The ID may come from outside the document: an Object.prototype member name would find the inherited member.
  const label = isValidId(labelId) ? doc.zoneLabels[labelId] : undefined;
  if (!label) return null;
  const at = label.at;
  const zone = zoneOfLabel(doc, labelId);
  const box = (hwPx: number, hhPx: number) => {
    const hw = hwPx / camera.zoom;
    const hh = hhPx / camera.zoom;
    return { min: { x: at.x - hw, y: at.y - hh }, max: { x: at.x + hw, y: at.y + hh } };
  };
  const fits = ({ min, max }: { min: Point; max: Point }): boolean =>
    !zone ||
    [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }].every((corner) => pointInPolygon(corner, zone.floor ?? zone.face.ring)); // the clear floor, as drawn
  const nameWidth = host.textMetrics(label.name, TAG_FONT).width;

  const half = TAG_LINE_PX / 2 / camera.zoom;
  const name: TagLine = { text: label.name, at: { x: at.x, y: at.y + half }, role: "name" };
  const area: TagLine = { text: tagAreaText(zone), at: { x: at.x, y: at.y - half }, role: "area" };
  const width = Math.max(nameWidth, host.textMetrics(area.text, TAG_FONT).width);
  const full = box(width / 2 + TAG_PAD_PX, TAG_LINE_PX + TAG_PAD_PX / 2);
  if (fits(full)) return { labelId, lines: [name, area], ...full };

  const nameOnly = box(nameWidth / 2 + TAG_PAD_PX, TAG_LINE_PX / 2 + TAG_PAD_PX / 2);
  if (fits(nameOnly)) return { labelId, lines: [{ text: label.name, at, role: "name" }], ...nameOnly };
  return null;
}

export function inBox(p: Point, min: Point, max: Point): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

/** The label whose tag contains p. Where tags overlap, the last drawn (highest ID) wins. */
export function tagAt(doc: Document, p: Point, camera: Camera, host: Host): string | null {
  let found: string | null = null;
  for (const id of sortedIds(doc.zoneLabels)) {
    const tag = tagLayout(doc, id, camera, host);
    if (tag && inBox(p, tag.min, tag.max)) found = id;
  }
  return found;
}
