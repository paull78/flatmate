import { floorRings, openBelow, roomFinish, sortedIds, zones, type Document, type Level } from "@fm/domain";
import { floorLookOf } from "./floor-look";
import { COLORS } from "./colors";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { Primitive } from "./scene-types";
import { ringEdges } from "./rings";
import { textWidth } from "./fonts";
import { roomTagLayout, tagLayout } from "./tags";
import { areaTags } from "./area-tags";

/**
 * Room floors (spec: walls-rooms, tools): a pure function of its arguments, so the Scene keeps the same array while they
 * are unchanged (spec: editor). `selectedLabels` is an `idsKey`; `hoverFaceKey` is the Zone tool's hovered face. With
 * `finishes` on, a finished room draws no blue (the floors layer draws it), only the tint while the Zone tool hovers
 * it (finishes.03); selected, it keeps its colours and `selectedFloorsLayer` outlines it (finishes.47).
 */
export const zoneFillsLayer = memoLast(
  (doc: Document, selectedLabels: string, zoneTool: boolean, hoverFaceKey: string | null, finishes: boolean): readonly Primitive[] => {
    const selected = idsOf(selectedLabels);
    const out: Primitive[] = [];
    for (const z of zones(doc)) {
      const hovered = zoneTool && hoverFaceKey === z.face.key;
      const look = floorLookOf(doc, z, finishes); // the floor's own look; hover and selection are this layer's
      const color = look === "finish"
        ? hovered ? COLORS.zoneFinishTint : null // the floors layer draws the room
        : hovered || z.labelIds.some((id) => selected.has(id))
          ? COLORS.zoneFillSelected
          : look === "fill"
            ? COLORS.zoneFill
            : zoneTool
              ? COLORS.zoneHint
              : null;
      // The floor minus each hole's footprint; a room whose clear area is unavailable, its centreline ring minus each hole's outline.
      if (color) {
        const { outer, holes } = floorRings(z);
        out.push({ kind: "polygon", points: outer, holes, color });
      }
    }
    return out;
  },
);

/** A selected finished room's outline width (finishes.47). */
export const SELECTED_FLOOR_PX = 2;

/**
 * A selected finished room's outline (finishes.47): selection-blue edges along its floor's rings, the outer floor and
 * each hole's. The floor's edges are the wall faces, so it is drawn above the walls (the annotations layer); empty
 * with `finishes` off, where the blue fill shows the selection. Reused while its arguments are unchanged.
 */
export const selectedFloorsLayer = memoLast((doc: Document, selectedLabels: string, finishes: boolean): readonly Primitive[] => {
  if (!finishes || selectedLabels === "") return [];
  const selected = idsOf(selectedLabels);
  return zones(doc)
    .filter((z) => z.labelIds.some((id) => selected.has(id)) && roomFinish(doc, z) !== null)
    .flatMap((z) => {
      const { outer, holes } = floorRings(z);
      return [outer, ...holes].flatMap((ring) => ringEdges(ring, COLORS.wallSelected, SELECTED_FLOOR_PX, "round"));
    });
});

/**
 * Zone tags (spec: editor) in a plan style: plates and text, the selected room's or area's name in blue; then the named
 * areas' tags, placed after the room tags (areas.03). Reused while its arguments are unchanged.
 */
export const tagsLayer = memoLast((doc: Document, style: PlanStyle, zoom: number, selectedLabels: string, layout: string | null): readonly Primitive[] => {
  const selected = idsOf(selectedLabels);
  const out: Primitive[] = [];
  const tags = [
    ...sortedIds(doc.zoneLabels).map((id) => tagLayout(doc, id, { zoom }, layout, style)),
    ...zones(doc).map((z) => roomTagLayout(doc, z, { zoom }, layout, style)), // unlabelled rooms with furniture
    ...areaTags(doc, { zoom }, layout, style),
  ];
  for (const tag of tags) {
    if (!tag) continue;
    const id = tag.labelId;
    const { min, max } = tag;
    if (style.tag.plate !== null) out.push({ kind: "polygon", points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }], holes: [], color: style.tag.plate });
    for (const line of tag.lines) {
      const color = line.role === "area" ? style.tag.muted : selected.has(id) ? COLORS.wallSelected : style.tag.text;
      out.push({ kind: "text", text: line.text, at: line.at, size: style.tag.size, color, align: "center", rotation: 0, font: style.font });
    }
  }
  return out;
});

const OPEN = "Open to below";
const OPEN_LINES: readonly (readonly string[])[] = [[OPEN], ["Open to", "below"]];

/**
 * "Open to below" at a loft's level (edges.07, .23): at each spot the domain gives, in the tags' muted ink with no plate,
 * on one line or, where that doesn't fit, two; none where neither fits within the spot's `clear` (the words' box,
 * centred there, must lie within that distance). It is drawn only: nothing selects it. Reused while its arguments are unchanged.
 */
export const openBelowLayer = memoLast((doc: Document, level: Level, style: PlanStyle, zoom: number): readonly Primitive[] => {
  const tag = style.tag;
  return openBelow(doc, level).flatMap((spot): Primitive[] => {
    const lines = OPEN_LINES.find((ls) => {
      const w = Math.max(...ls.map((l) => textWidth(style.font, l, tag.size))) / zoom;
      const h = (tag.size + (ls.length - 1) * tag.line) / zoom;
      return Math.hypot(w / 2, h / 2) <= spot.clear;
    });
    if (lines === undefined) return [];
    return lines.map((text, i): Primitive => ({
      kind: "text", text, at: { x: spot.at.x, y: spot.at.y + (((lines.length - 1) / 2 - i) * tag.line) / zoom },
      size: tag.size, color: tag.muted, align: "center", rotation: 0, font: style.font,
    }));
  });
});
