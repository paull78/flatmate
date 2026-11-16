import { doorSpans, dressingOf, geometryOf, openingShown, sortedIds, type DoorSpan, type Document, type Level } from "@fm/domain";
import { FRAME_M, styleLook, type OpeningLook } from "./opening-parts";
import { openingAbove, openingPrimitives } from "./opening-symbols";
import { dressingPrimitives } from "./dressing-symbols";
import { COLORS } from "./colors";
import { roomFinishes, spanFinishes } from "./finish/rooms";
import { finishPrimitives, visibleRooms } from "./finishes-layer";
import { floorLookOf, zonesByKey } from "./floor-look";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { Primitive } from "./scene-types";

// The symbols and their parts live in their own modules (openkinds: one symbol per kind); re-exported for the readers here.
export { FRAME_M, INVALID_LOOK, LEAF_M, PREVIEW_LOOK, parkedBox, spanQuad, styleLook, type OpeningLook } from "./opening-parts";
export { openingAbove, openingPrimitives, openingReach } from "./opening-symbols";

/** Whether a picture at `zoom` (its units per metre) draws frames and outlined leaves: a 6 cm frame is wide enough to read. */
export function openingsDetailed(style: PlanStyle, zoom: number): boolean {
  return FRAME_M * zoom >= style.openingDetailFrom - 1e-6;
}

/**
 * Doors and windows, drawn over the walls (spec: openings): the mitred wall outlines stay as they are. An opening whose
 * range crosses the `level`'s cut is drawn whole; one wholly above it draws its outline dashed over the solid wall
 * (`openingAbove`, sills.05); one below it isn't drawn, as a real cut hides it (levels.05). A door's span
 * shows the floor of the room the door swings away from, as that room's floor looks in the picture (`doorSpans`,
 * `floorLookOf`, thresholds.01, .06), then a threshold line along the door line, then the leaf and swing, then a
 * window's dressing (`dressingPrimitives`, hangings.04). `finishes` is
 * the viewer's switch or the export's With; `visible`, the rooms whose pattern shows at the picture's zoom
 * (`spanVisible`), so a span's pattern shows exactly when its room's does. Reused while its arguments are equal.
 */
export const openingsLayer = memoLast((doc: Document, level: Level, style: PlanStyle, selected: string, finishes: boolean, visible: string, detailed: boolean): readonly Primitive[] => {
  const picked = idsOf(selected);
  const look = styleLook(style);
  const selectedLook: OpeningLook = { ...look, line: COLORS.wallSelected };
  const spans = new Map(doorSpans(doc).map((s) => [s.openingId, s]));
  const out: Primitive[] = [];
  for (const id of sortedIds(doc.openings)) {
    const shown = openingShown(doc, id, level);
    const o = doc.openings[id];
    const g = o && shown !== "hidden" ? geometryOf(doc, o) : null;
    if (!o || !g) continue;
    const l = picked.has(id) ? selectedLook : look;
    const dressing = dressingOf(doc, id); // a window's box and sheer, on its room side (hangings.04)
    if (shown === "above") {
      out.push(...openingAbove(g, l), ...(dressing ? dressingPrimitives(dressing, l, true) : []));
      continue;
    }
    const span = spans.get(id);
    if (span) {
      out.push(...spanFloor(doc, span, style, finishes, visible));
      out.push({ kind: "segment", a: span.line[0], b: span.line[1], width: { px: l.weights.hair }, color: l.line, cap: "butt" }); // the threshold line
    }
    out.push(...openingPrimitives(o, g, l, span === undefined, detailed)); // a door with no span (no clear stretch) keeps the old one
    if (dressing) out.push(...dressingPrimitives(dressing, l, false));
  }
  return out;
});

/** The rooms whose pattern shows in `style` at `zoom` (an `idsKey` of label IDs); none in a style without finishes. */
export function spanVisible(doc: Document, style: PlanStyle, zoom: number): string {
  return style.finish === null ? "" : visibleRooms(doc, zoom, style.finish.minSpacing);
}

/** A door's span as its room's floor looks: its finish (pattern when its room's shows), the room's fill, or the background. */
function spanFloor(doc: Document, span: DoorSpan, style: PlanStyle, finishes: boolean, visible: string): readonly Primitive[] {
  const zone = span.room === null ? undefined : zonesByKey(doc).get(span.room);
  const look = zone ? floorLookOf(doc, zone, finishes && style.finish !== null) : "none";
  if (look === "finish") {
    const geometry = spanFinishes(doc).find((s) => s.id === span.openingId)?.geometry;
    const label = roomFinishes(doc).find((r) => r.room === span.room)?.id; // the label `visible` names the room by
    if (geometry && label !== undefined) return finishPrimitives([{ id: label, geometry }], style, visible);
  }
  return [{ kind: "polygon", points: span.ring, holes: [], color: look === "fill" ? style.openingFloor : style.spanBackground }];
}

/** Whether the level's cut crosses an opening, so the plan draws it and its swing (levels.05). */
export function openingCut(doc: Document, openingId: string, level: Level): boolean {
  return openingShown(doc, openingId, level) === "cut";
}
