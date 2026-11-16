import { SIDE_IDS, add, configOf, footprints, normalize, scale, sub, zoneRings, type Document, type Side } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { ellOutline, ellSideSpot } from "../snapping/arm-drag";
import { sideOf } from "../snapping/resize";
import type { EditorState } from "../state";
import { COLORS } from "./colors";
import { ellStripSpots, zoneFrames, type ZoneFrame } from "../snapping/zone-drag";
import { HANDLE_HIT_PX, ZONE_HANDLES_MIN_PX, gripsShown, zoneLinePx } from "./handles";
import type { Primitive } from "./scene-types";

// Use zones on the canvas (smart.09, smart.24): the selection's dashed zone outlines, and the chips that toggle one
// side of one piece. The scene draws the chips and the Select tool hit-tests them from this one list (arch-review R-07).

const ZONE_CHIP_OUT_PX = 24; // a "+" chip's distance beyond its side, and a "×" chip's least
const ZONE_CHIP_FRONT_SHIFT_PX = 2 * HANDLE_HIT_PX; // front "+" chips slide along the edge, clear of the rotation grip
const ZONE_CHIP_BEYOND_PX = 2 * HANDLE_HIT_PX; // a "×" chip's distance beyond its zone's depth handle
export const ZONE_CHIP_RADIUS_PX = 6.5; // drawn about a grip's size, hit within HANDLE_HIT_PX (furnish.09)
export const ZONE_CHIP_INNER_PX = 5; // the fill disc inside the ring: a 1.5 px ring, as on the grips
export const ZONE_CHIP_GLYPH_PX = 9;

/** One chip: "×" on an active zone (`on`), "+" by an inactive side. */
export type ZoneChip = { placementId: string; side: Side; on: boolean; at: Point };

/**
 * The chips of one selected piece, in SIDE_IDS order, whenever its grips show and its current configuration has a
 * zone: a "×" on the line through each active zone's depth handle, ZONE_CHIP_BEYOND_PX beyond it and at least
 * ZONE_CHIP_OUT_PX from the side (so a thin zone seen from afar keeps its chip off the side grip), whether the handles
 * show or not (furnish.20); a "+" ZONE_CHIP_OUT_PX beyond each inactive side's grip (an `L`'s right and front at its arm
 * ends, catalog.12), and an `L` front's "×" by `ellChipAt`. A front "+" shifts
 * ZONE_CHIP_FRONT_SHIFT_PX towards the front-right corner, so its hit circle keeps clear of the rotation grip
 * ROTATE_GRIP_PX beyond the front edge.
 */
export function zoneChips(state: EditorState, doc: Document): ZoneChip[] {
  const ref = state.selection[0];
  if (!ref || !gripsShown(state)) return [];
  const p = doc.placements[ref.id];
  const object = p ? doc.objects[p.object] : undefined;
  const zone = p && object ? configOf(object, p.config)?.zone : null;
  const quad = footprints(doc).get(ref.id);
  const [q0, q1] = quad ?? [];
  const along = q0 && q1 ? normalize(sub(q1, q0)) : null;
  if (!p || zone === null || zone === undefined || !quad || !along) return [];
  const zoom = state.camera.zoom;
  const ell = ellOutline(doc, ref.id);
  return SIDE_IDS.flatMap((side): ZoneChip[] => {
    const s = ell ? ellSideSpot(ell, side) : sideOf(quad, side); // an `L`'s "+" by its side grip, at an arm end (catalog.12)
    if (!s) return [];
    if (p.sides[side]) {
      const frames = zoneFrames(doc, p.id, side);
      const f = frames[0];
      if (frames.length === 2) return [{ placementId: p.id, side, on: true, at: ellChipAt(frames, zoom) }];
      if (!f) return [];
      const [a, e] = f.inner;
      const px = Math.max(zoneLinePx(side, f.extent.depth * zoom) + ZONE_CHIP_BEYOND_PX, ZONE_CHIP_OUT_PX);
      return [{ placementId: p.id, side, on: true, at: add(scale(add(a, e), 0.5), scale(f.normal, px / zoom)) }];
    }
    const out = add(s.mid, scale(s.normal, ZONE_CHIP_OUT_PX / zoom));
    const at = side === "front" ? add(out, scale(along, ZONE_CHIP_FRONT_SHIFT_PX / zoom)) : out;
    return [{ placementId: p.id, side, on: false, at }];
  });
}

/**
 * An `L` front zone's "×" (catalog.13): on the line through the back strip's depth handle, else the left one's, where
 * that handle shows (ZONE_HANDLES_MIN_PX of outline), else the back strip's line when it has one; out as a straight
 * zone's chip, and at least 2·HANDLE_HIT_PX along from the inner corner, clear of the other arm's grip.
 */
function ellChipAt(frames: readonly ZoneFrame[], zoom: number): Point {
  const spots = ellStripSpots(frames);
  const long = (strip: number) => spots.find((s) => s.frame.strip === strip && s.lines.outer && (s.lines.outer[1] - s.lines.outer[0]) * zoom >= ZONE_HANDLES_MIN_PX - 1e-6);
  const pick = long(1) ?? long(0) ?? spots.find((s) => s.frame.strip === 1 && s.lines.outer) ?? spots.find((s) => s.lines.outer);
  const outer = pick?.lines.outer;
  if (!pick || !outer) return frames[0]?.inner[0] ?? { x: 0, y: 0 }; // never: one strip always draws its outer line
  const depth = pick.frame.extent.depth;
  const px = Math.max(depth * zoom + ZONE_CHIP_BEYOND_PX, ZONE_CHIP_OUT_PX);
  return pick.at(Math.max((outer[0] + outer[1]) / 2, (2 * HANDLE_HIT_PX) / zoom), px / zoom);
}

/** The use zones of the given placements of `layout`, each as faint dashed segments: a band's four, an `L` front's union once. */
export function zoneOutlines(doc: Document, placementIds: readonly string[], layout: string | null): Primitive[] {
  const zones = zoneRings(doc);
  return placementIds.flatMap((id) => {
    if (layout === null || doc.placements[id]?.state !== layout) return [];
    return (zones.get(id) ?? []).flatMap(({ ring }) => ring.map((a, i): Primitive => ({
      kind: "segment", a, b: ring[(i + 1) % ring.length] ?? a, width: { px: 1.5 }, color: COLORS.zoneOutline, cap: "butt", dash: [6, 4],
    })));
  });
}
