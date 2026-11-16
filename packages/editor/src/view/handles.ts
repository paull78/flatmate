import { SIDE_IDS, add, deckView, distance, holeView, footprints, scale, type Document, type ResizeSide, type Side, type Span, shown } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { armSpot, armSpotWith, ellOutline, ellSideSpot, pieceSideSpot, type Arm, type Spot } from "../snapping/arm-drag";
import { resizedPreview, sideOf, widthSide } from "../snapping/resize";
import { ellStripSpots, zoneFrames, type Strip, type ZoneFrame } from "../snapping/zone-drag";
import { selectedPlacements, type EditorState } from "../state";
import { deckSide } from "../tools/deck-edit";
import { holeSide } from "../tools/hole-edit";
import { sectionFarSpot } from "../tools/section-edit";
import type { DragTarget, DragTry } from "../tools/types";
import { HELPER_FONT } from "./fonts";
import { labelBox } from "./labels";

/**
 * A handle on the canvas: drawn by the scene, hit-tested by the Select tool, from this one list (arch-review R-07),
 * as the helper dimension and tags share one placement function. A joint handle: `fixed` is endpoint a, which stays
 * put when the helper resizes the wall (spec: tools); only the first selected wall's handles can be grabbed. A side grip
 * resizes one dimension of a piece of furniture (`normal` points out of its side); the rotation grip turns it
 * (direct.03, direct.05). A zone handle sits on an active use zone (furnish.15, .20): the depth handle on the middle
 * of its outer line drags across the side (`normal`, outward), an end handle on the middle of each end side along it
 * (`along`, from the side's start corner). A deck's side grip moves that side of one selected deck (decks.06). An arm
 * grip deepens an `L` piece's arm across its inner edge (`normal`, into the empty quarter; catalog.09). A section's end
 * grip moves that end of one selected section; its far grip sets its depth (`normal`, the seen side).
 */
export type Handle =
  | { kind: "joint"; joint: string; at: Point; fixed: boolean; hittable: boolean }
  | { kind: "side"; placementId: string; side: ResizeSide; at: Point; normal: Point; hittable: boolean }
  | { kind: "rotate"; placementId: string; at: Point; hittable: boolean }
  | { kind: "armGrip"; placementId: string; arm: Arm; at: Point; normal: Point; hittable: boolean }
  | { kind: "zoneDepth"; placementId: string; side: Side; strip?: Strip; at: Point; normal: Point; hittable: boolean }
  | { kind: "zoneEnd"; placementId: string; side: Side; strip?: Strip; end: "start" | "end"; at: Point; along: Point; hittable: boolean }
  | { kind: "deckSide"; deckId: string; side: ResizeSide; at: Point; normal: Point; hittable: boolean }
  | { kind: "holeSide"; holeId: string; side: ResizeSide; at: Point; normal: Point; hittable: boolean }
  | { kind: "areaSide"; areaId: string; side: ResizeSide; at: Point; normal: Point; hittable: boolean }
  | { kind: "sectionEnd"; sectionId: string; end: "a" | "b"; at: Point; hittable: boolean }
  | { kind: "sectionFar"; sectionId: string; at: Point; normal: Point; hittable: boolean };

export const HANDLE_HIT_PX = 8;
const GRIP_INSIDE_MIN_PX = 4 * HANDLE_HIT_PX; // a side shorter on screen puts its grips outside the edges
export const ROTATE_GRIP_PX = 24; // the rotation grip's distance beyond the front edge
export const ZONE_HANDLES_MIN_PX = 4 * HANDLE_HIT_PX; // a zone shallower or shorter on screen shows only its chip
const ZONE_FRONT_CLEAR_PX = ROTATE_GRIP_PX + 2 * HANDLE_HIT_PX; // a front zone's handles' least distance out
const SIZE_LABEL_PX = 28; // a resize's size label, beyond the moving side
const SIDES: readonly ResizeSide[] = ["right", "left", "front", "back"];
const ARMS: readonly Arm[] = ["back", "left"];

/**
 * The handles of the selection: a selected wall's joints [a, b], a selected joint's own, one piece's grips, then its
 * zone handles; one deck's side grips; one section's grips.
 */
export function handles(state: EditorState, doc: Document): Handle[] {
  const out: Handle[] = [];
  state.selection.forEach((ref, index) => {
    const isWall = ref.table === "walls" && doc.walls[ref.id]?.column !== true; // a column has no grips (pillars.14)
    const wall = isWall && state.selection.length === 1 ? doc.walls[ref.id] : undefined; // a group's walls show no joint handles (straight.09)
    const joints = wall ? [wall.a, wall.b] : ref.table === "joints" ? [ref.id] : [];
    joints.forEach((id, i) => {
      const j = doc.joints[id];
      if (j) out.push({ kind: "joint", joint: id, at: { x: j.x, y: j.y }, fixed: isWall && i === 0, hittable: isWall && index === 0 });
    });
  });
  const piece = state.selection[0];
  if (piece?.table === "decks" && state.selection.length === 1 && selectIdle(state)) return [...out, ...deckGrips(doc, piece.id, state.camera.zoom)];
  if (piece?.table === "deckHoles" && state.selection.length === 1 && selectIdle(state)) return [...out, ...holeGrips(doc, piece.id, state.camera.zoom)];
  if (piece?.table === "sections" && selectIdle(state)) return [...out, ...sectionGrips(doc, piece.id, state.camera.zoom)];
  if (piece?.table === "areas" && state.selection.length === 1 && selectIdle(state)) return [...out, ...areaGrips(doc, piece.id, state.camera.zoom)];
  return piece && gripsShown(state) ? [...out, ...grips(doc, piece.id, state.camera.zoom), ...zoneHandles(doc, piece.id, state.camera.zoom)] : out;
}

/**
 * Grips show for one selected piece of the active layout, in the Select tool when idle or pressing: never for a
 * group, during a drag, a box, a nudge run or a helper edit (direct.03, AC-01).
 */
export function gripsShown(state: EditorState): boolean {
  return state.selection.length === 1 && selectedPlacements(state).length === 1 && selectIdle(state);
}

/** The Select tool, idle or pressing: when grips show. */
function selectIdle(state: EditorState): boolean {
  if (state.tool.name !== "select") return false;
  const kind = state.tool.state.kind;
  switch (kind) {
    case "idle":
    case "pressing":
      return true;
    case "moving":
    case "box":
    case "nudging":
    case "copying":
    case "splitting":
    case "editingHelper":
    case "editingGap":
      return false;
    default:
      return assertNever(kind);
  }
}

/**
 * Four side grips on the sides' middles and the rotation grip ROTATE_GRIP_PX beyond the front edge. Per axis, a side
 * shorter than GRIP_INSIDE_MIN_PX on screen puts the grips across it HANDLE_HIT_PX outside its edges, so their hit
 * circles stop at the edge and the body stays grabbable (spec "Small objects"). An `L` piece's right and front grips
 * sit at its arm ends, the rotation grip beyond the front one, and an arm grip on each inner edge's middle (catalog.12).
 */
function grips(doc: Document, placementId: string, zoom: number): Handle[] {
  const quad = footprints(doc).get(placementId);
  if (!quad) return [];
  const ell = ellOutline(doc, placementId);
  const spot = (side: ResizeSide): Spot | null => (ell ? ellSideSpot(ell, side) : sideOf(quad, side));
  const out: Handle[] = [];
  for (const side of SIDES) {
    const s = spot(side);
    const outside = gripOutPx(doc, placementId, side, zoom) / zoom;
    if (s) out.push({ kind: "side", placementId, side, at: add(s.mid, scale(s.normal, outside)), normal: s.normal, hittable: true });
  }
  const front = spot("front");
  if (front) out.push({ kind: "rotate", placementId, at: add(front.mid, scale(front.normal, ROTATE_GRIP_PX / zoom)), hittable: true });
  for (const arm of ell ? ARMS : []) {
    const s = ell ? armSpot(ell, arm) : null;
    if (s) out.push({ kind: "armGrip", placementId, arm, at: s.mid, normal: s.normal, hittable: true });
  }
  return out;
}

/** A deck's four side grips, on the sides' middles; outside the edges across a side short on screen, as a piece's. */
function deckGrips(doc: Document, deckId: string, zoom: number): Handle[] {
  const deck = deckView(doc, deckId);
  if (!deck) return [];
  return SIDES.flatMap((side): Handle[] => {
    const s = deckSide(deck, side);
    const across = widthSide(side) ? deck.w : deck.d;
    const outside = across * zoom < GRIP_INSIDE_MIN_PX ? HANDLE_HIT_PX / zoom : 0;
    return s ? [{ kind: "deckSide", deckId, side, at: add(s.mid, scale(s.normal, outside)), normal: s.normal, hittable: true }] : [];
  });
}

/** A hole's four side grips, as a deck's (stairwell.08). */
function holeGrips(doc: Document, holeId: string, zoom: number): Handle[] {
  const hole = holeView(doc, holeId)?.hole;
  if (!hole) return [];
  return SIDES.flatMap((side): Handle[] => {
    const s = holeSide(hole, side);
    const across = widthSide(side) ? hole.w : hole.d;
    const outside = across * zoom < GRIP_INSIDE_MIN_PX ? HANDLE_HIT_PX / zoom : 0;
    return s ? [{ kind: "holeSide", holeId, side, at: add(s.mid, scale(s.normal, outside)), normal: s.normal, hittable: true }] : [];
  });
}

/** A named area's four side grips, as a deck's, square to the page, in the Select tool only (areas.07, .08, .29). */
function areaGrips(doc: Document, areaId: string, zoom: number): Handle[] {
  const a = Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  if (!a) return [];
  const sides: [ResizeSide, Point, number][] = [["right", { x: 1, y: 0 }, a.w], ["left", { x: -1, y: 0 }, a.w], ["back", { x: 0, y: 1 }, a.d], ["front", { x: 0, y: -1 }, a.d]];
  return sides.map(([side, normal, along]): Handle => {
    const half = normal.x !== 0 ? a.w / 2 : a.d / 2;
    const outside = along * zoom < GRIP_INSIDE_MIN_PX ? HANDLE_HIT_PX / zoom : 0;
    return { kind: "areaSide", areaId, side, at: add(a.at, scale(normal, half + outside)), normal, hittable: true };
  });
}

/** A section's two end grips, then its far grip (section-edit.ts). */
function sectionGrips(doc: Document, sectionId: string, zoom: number): Handle[] {
  const row = doc.sections[sectionId];
  const far = row ? sectionFarSpot(row, zoom) : null;
  if (!row || !far) return [];
  return [
    { kind: "sectionEnd", sectionId, end: "a", at: row.a, hittable: true },
    { kind: "sectionEnd", sectionId, end: "b", at: row.b, hittable: true },
    { kind: "sectionFar", sectionId, ...far, hittable: true },
  ];
}

/** How far outside its side a side grip sits, in px: HANDLE_HIT_PX when the piece is short across it on screen, else 0. */
function gripOutPx(doc: Document, placementId: string, side: ResizeSide, zoom: number): number {
  const [q0, q1, , q3] = footprints(doc).get(placementId) ?? [];
  if (!q0 || !q1 || !q3) return 0;
  return (widthSide(side) ? distance(q0, q1) : distance(q0, q3)) * zoom < GRIP_INSIDE_MIN_PX ? HANDLE_HIT_PX : 0;
}

/**
 * How far out a zone's handles sit, in px, for a zone `depthPx` deep on screen: on its outer edge, except a front
 * zone's, at least ZONE_FRONT_CLEAR_PX out, so they keep clear of the rotation grip ROTATE_GRIP_PX beyond the front.
 */
export function zoneLinePx(side: Side, depthPx: number): number {
  return side === "front" ? Math.max(depthPx, ZONE_FRONT_CLEAR_PX) : depthPx;
}

/**
 * Three handles per active zone, in SIDE_IDS order: depth on the middle of the zone's outer line, an end handle on
 * the middle of each end side, halfway out to that line (furnish.20; shapefit AC-02). An end handle within
 * 2·HANDLE_HIT_PX of the side's middle along it, by a grip, goes out clear of the grip, so their hit circles stay
 * apart: a front zone's ZONE_FRONT_CLEAR_PX out (past the rotation grip), another side's at least 2·HANDLE_HIT_PX
 * beyond its side grip, which sits outside a piece narrow on screen (heights.48). A zone less than ZONE_HANDLES_MIN_PX deep or long on screen has none;
 * the 1e-6 forgives float noise (0.4 m at 80 px/m is 31.999999999999993 px). An `L` front's handles are its strips'
 * (`ellZoneHandles`).
 */
function zoneHandles(doc: Document, placementId: string, zoom: number): Handle[] {
  return SIDE_IDS.flatMap((side): Handle[] => {
    const frames = zoneFrames(doc, placementId, side);
    const f = frames[0];
    if (frames.length === 2) return ellZoneHandles(placementId, frames, zoom);
    if (!f) return [];
    const { depth, start, end } = f.extent;
    if (depth * zoom < ZONE_HANDLES_MIN_PX - 1e-6 || (f.length - start - end) * zoom < ZONE_HANDLES_MIN_PX - 1e-6) return [];
    const linePx = zoneLinePx(side, depth * zoom);
    const [a, e] = f.inner;
    const mid = scale(add(a, e), 0.5);
    /** The end handle off `p`, the inner edge's end `along` metres from the side's start corner. */
    const endAt = (p: Point, along: number): Point => {
      const byGrip = Math.abs(along - f.length / 2) * zoom < 2 * HANDLE_HIT_PX - 1e-6;
      const clear = side === "front" ? ZONE_FRONT_CLEAR_PX : Math.max(linePx / 2, gripOutPx(doc, placementId, side, zoom) + 2 * HANDLE_HIT_PX);
      return add(p, scale(f.normal, (byGrip ? clear : linePx / 2) / zoom));
    };
    return [
      { kind: "zoneDepth", placementId, side, at: add(mid, scale(f.normal, linePx / zoom)), normal: f.normal, hittable: true },
      { kind: "zoneEnd", placementId, side, end: "start", at: endAt(a, start), along: f.along, hittable: true },
      { kind: "zoneEnd", placementId, side, end: "end", at: endAt(e, f.length - end), along: f.along, hittable: true },
    ];
  });
}

/** Whether a span is at least ZONE_HANDLES_MIN_PX long on screen. */
const longSpan = (span: Span | null, zoom: number): span is Span => span !== null && (span[1] - span[0]) * zoom >= ZONE_HANDLES_MIN_PX - 1e-6;

/**
 * An `L` front zone's handles (catalog.13), strip by strip, left then back: a depth handle on the middle of the part of
 * the strip's outer line on the zone's outline, an end handle on the middle of the part of its far end on it, each
 * where that part is at least ZONE_HANDLES_MIN_PX long on screen, so a strip inside the other has none; an end handle
 * only on a strip that long, and none at all on a zone shallower than that. So every handle keeps 2·HANDLE_HIT_PX from
 * the arm grips on the inner edges and from the other strip's handles (catalog.38).
 */
function ellZoneHandles(placementId: string, frames: readonly ZoneFrame[], zoom: number): Handle[] {
  const depth = frames[0]?.extent.depth ?? 0;
  if (depth * zoom < ZONE_HANDLES_MIN_PX - 1e-6) return [];
  return ellStripSpots(frames).flatMap(({ frame, length, lines: { outer, end }, at }): Handle[] => {
    const strip = frame.strip ?? 0;
    const out: Handle[] = [];
    if (longSpan(outer, zoom)) out.push({ kind: "zoneDepth", placementId, side: "front", strip, at: at((outer[0] + outer[1]) / 2, depth), normal: frame.normal, hittable: true });
    if (longSpan(end, zoom) && length * zoom >= ZONE_HANDLES_MIN_PX - 1e-6) {
      out.push({ kind: "zoneEnd", placementId, side: "front", strip, end: strip === 0 ? "start" : "end", at: at(length, (end[0] + end[1]) / 2), along: frame.along, hittable: true });
    }
    return out;
  });
}

/**
 * A resize's size label by the moving side (direct.06, AC-04), or an arm drag's depth by the arm's inner edge: its
 * text, centre and box, and whether the tried size fits; null unless such a drag is active. The one placement
 * function: the scene draws it, and the live distances keep clear of its box.
 */
export function resizeLabelBox(state: EditorState): { text: string; at: Point; ok: boolean; min: Point; max: Point } | null {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "moving") return null;
  const { target, attempt, baseDoc } = tool.state;
  const tried = triedSize(baseDoc, target, attempt.tried);
  if (!tried) return null;
  const text = `${shown(tried.size)} m`;
  const at = add(tried.spot.mid, scale(tried.spot.normal, SIZE_LABEL_PX / state.camera.zoom));
  return { text, at, ok: attempt.ok, ...labelBox(text, at, HELPER_FONT, state.camera) };
}

/** A side grip's tried size and its side's spot on the resized piece, or an arm grip's tried depth and its inner edge's spot. */
function triedSize(doc: Document, target: DragTarget, tried: DragTry): { size: number; spot: Spot } | null {
  if (target.kind === "armGrip" && tried.kind === "arms") {
    const spot = armSpotWith(doc, target.placementId, target.arm, tried.arms);
    return spot ? { size: tried.arms[target.arm], spot } : null;
  }
  if (target.kind !== "resize" || tried.kind !== "resize") return null;
  const preview = resizedPreview(doc, target.placementId, tried.side, tried.size);
  const spot = preview ? pieceSideSpot(preview, tried.side) : null;
  return spot ? { size: tried.size, spot } : null;
}
