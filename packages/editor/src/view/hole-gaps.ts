import { add, holeView, scale, shown, type Document, type ResizeSide } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import { holeGaps, type HoleGap } from "../tools/hole-edit";
import { deckLabelBox } from "./deck-label";
import { HELPER_FONT } from "./fonts";
import { drawDimension, drawPlate } from "./helper";
import { boxesOverlap, labelBox } from "./labels";
import { HANDLE_HIT_PX } from "./handles";
import { CANVAS_STYLE } from "./plan-style";
import type { Primitive } from "./scene-types";
import { inBox } from "./tags";

// A selected hole's gaps (stairwell.36): one dimension from each side to its deck's edge, its plate the click target
// that starts typing a new gap, as a door's chain on its wall (helper.ts). Drawn on the scene's document, so a drag or
// a nudge shows them live.

/** A gap's plate, centred on its dimension line; the typed value while it is being edited. */
export type GapBox = { side: ResizeSide; text: string; at: Point; min: Point; max: Point; gap: HoleGap };

/** The hole whose gaps show: the one being edited, or the one selected alone in the Select tool. */
function gapHole(state: EditorState): string | null {
  const tool = state.tool;
  if (tool.name !== "select") return null;
  if (tool.state.kind === "editingGap") return tool.state.holeId;
  const [only, ...more] = state.selection;
  return only?.table === "deckHoles" && more.length === 0 ? only.id : null;
}

function editingValue(state: EditorState, holeId: string, side: ResizeSide): string | null {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "editingGap") return null;
  return tool.state.holeId === holeId && tool.state.side === side ? tool.state.value : null;
}

const OUTSIDE_PX = 4; // between the deck's edge and a plate put beyond it

/**
 * The shown hole's gaps with their plates, in GAP_SIDES order. The one placement function, for drawing and hits. A
 * plate sits on its line's middle when it fits there clear of the hole's side grip, else just beyond the deck's edge,
 * so a press on the grip always resizes. A plate that would cover the deck's label ("Loft +2.15") slides along its line
 * to the hole's end, then to the edge's, then beyond the edge, the first clear of it (stairwell.37).
 */
export function holeGapBoxes(state: EditorState, doc: Document): GapBox[] {
  const holeId = gapHole(state);
  const deck = holeId ? holeView(doc, holeId)?.deck : undefined;
  if (!holeId || !deck) return [];
  const zoom = state.camera.zoom;
  const label = deckLabelBox(deck, CANVAS_STYLE, zoom);
  return holeGaps(doc, holeId).map((gap) => {
    const editing = editingValue(state, holeId, gap.side);
    const text = editing ? editing : shown(gap.length);
    const size = labelBox(text, { x: 0, y: 0 }, HELPER_FONT, state.camera).max;
    const half = Math.abs(gap.normal.x) * size.x + Math.abs(gap.normal.y) * size.y; // the plate's half extent along the line
    const clear = half + HANDLE_HIT_PX / zoom;
    const outside = add(gap.to, scale(gap.normal, half + OUTSIDE_PX / zoom));
    const inside = gap.length / 2 >= clear ? [scale(add(gap.from, gap.to), 0.5), add(gap.from, scale(gap.normal, clear)), add(gap.to, scale(gap.normal, -half))] : [];
    const boxes = [...inside, outside].map((at) => ({ at, ...labelBox(text, at, HELPER_FONT, state.camera) }));
    const box = boxes.find((b) => !boxesOverlap(b, label)) ?? { at: outside, ...labelBox(text, outside, HELPER_FONT, state.camera) };
    return { side: gap.side, text, ...box, gap };
  });
}

/** The gap whose plate is under the point: a click there starts typing into it. */
export function holeGapHit(state: EditorState, world: Point): { holeId: string; side: ResizeSide } | null {
  const holeId = gapHole(state);
  if (!holeId || !state.document) return null;
  const box = holeGapBoxes(state, visibleDoc(state.document)).find((b) => inBox(world, b.min, b.max));
  return box ? { holeId, side: box.side } : null;
}

/** The shown hole's gaps (annotations layer): a dimension line with a tick at each end, and its plate. */
export function drawHoleGaps(state: EditorState, doc: Document, out: Primitive[]): void {
  const holeId = gapHole(state);
  if (!holeId) return;
  for (const box of holeGapBoxes(state, doc)) {
    const { from, to, normal } = box.gap;
    drawDimension(from, to, [from, to], { x: -normal.y, y: normal.x }, box, state.camera.zoom, out);
    drawPlate(box, editingValue(state, holeId, box.side), out);
  }
}
