import { sortedIds, zones, type Document } from "@fm/domain";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { COLORS } from "./colors";
import { TAG_FONT } from "./fonts";
import type { LayerName, Primitive } from "./scene-types";
import { tagLayout } from "./tags";

/** Room floors (zoneFills) and zone tags (annotations), spec §3.6 and §5.6. */
export function drawZones(state: EditorState, doc: Document, layers: Record<LayerName, Primitive[]>, host: Host): void {
  const selected = new Set(state.selection.filter((r) => r.table === "zoneLabels").map((r) => r.id));
  const zoneTool = state.tool.name === "zone" ? state.tool.state : null;
  for (const z of zones(doc)) {
    const highlighted = z.labelIds.some((id) => selected.has(id)) || zoneTool?.hoverFaceKey === z.face.key;
    const color = highlighted
      ? COLORS.zoneFillSelected
      : z.labelIds.length > 0
        ? COLORS.zoneFill
        : zoneTool
          ? COLORS.zoneHint
          : null;
    // A room whose clear area is unavailable is filled along its centreline ring.
    if (color) layers.zoneFills.push({ kind: "polygon", points: z.floor ?? z.face.ring, color });
  }
  for (const id of sortedIds(doc.zoneLabels)) {
    const tag = tagLayout(doc, id, state.camera, host);
    if (!tag) continue;
    const { min, max } = tag;
    layers.annotations.push({
      kind: "polygon",
      points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }],
      color: COLORS.background,
    });
    for (const line of tag.lines) {
      const color = line.role === "area" ? COLORS.textMuted : selected.has(id) ? COLORS.wallSelected : COLORS.text;
      layers.annotations.push({ kind: "text", text: line.text, at: line.at, size: TAG_FONT.size, color, align: "center", rotation: 0 });
    }
  }
}
