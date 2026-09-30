import { sortedIds, zones, type Document } from "@fm/domain";
import type { Host } from "../ports/host";
import { COLORS } from "./colors";
import { TAG_FONT } from "./fonts";
import { idsOf, memoLast } from "./memo";
import type { Primitive } from "./scene-types";
import { tagLayout } from "./tags";

/**
 * Room floors (spec §3.6, §5.6): a pure function of its arguments, so the Scene keeps the same array while they
 * are unchanged (§5.9). `selectedLabels` is an `idsKey`; `hoverFaceKey` is the Zone tool's hovered face.
 */
export const zoneFillsLayer = memoLast(
  (doc: Document, selectedLabels: string, zoneTool: boolean, hoverFaceKey: string | null): readonly Primitive[] => {
    const selected = idsOf(selectedLabels);
    const out: Primitive[] = [];
    for (const z of zones(doc)) {
      const highlighted = z.labelIds.some((id) => selected.has(id)) || (zoneTool && hoverFaceKey === z.face.key);
      const color = highlighted
        ? COLORS.zoneFillSelected
        : z.labelIds.length > 0
          ? COLORS.zoneFill
          : zoneTool
            ? COLORS.zoneHint
            : null;
      // A room whose clear area is unavailable is filled along its centreline ring.
      if (color) out.push({ kind: "polygon", points: z.floor ?? z.face.ring, color });
    }
    return out;
  },
);

/** Zone tags (spec §5.9): plates and text, the selected room's name in blue. Reused while its arguments are unchanged. */
export const tagsLayer = memoLast((doc: Document, zoom: number, host: Host, selectedLabels: string): readonly Primitive[] => {
  const selected = idsOf(selectedLabels);
  const out: Primitive[] = [];
  for (const id of sortedIds(doc.zoneLabels)) {
    const tag = tagLayout(doc, id, { zoom }, host);
    if (!tag) continue;
    const { min, max } = tag;
    out.push({ kind: "polygon", points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }], color: COLORS.background });
    for (const line of tag.lines) {
      const color = line.role === "area" ? COLORS.textMuted : selected.has(id) ? COLORS.wallSelected : COLORS.text;
      out.push({ kind: "text", text: line.text, at: line.at, size: TAG_FONT.size, color, align: "center", rotation: 0 });
    }
  }
  return out;
});
