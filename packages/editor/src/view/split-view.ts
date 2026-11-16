import { add, scale, shown, sub, wallFrame, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { EditorState } from "../state";
import { splitFace, type SplitTick } from "../tools/split-gesture";
import { COLORS } from "./colors";
import { HELPER_FONT } from "./fonts";
import { HELPER_OFFSET_PX, drawDimension, drawPlate } from "./helper";
import { labelBox } from "./labels";
import type { Primitive } from "./scene-types";

// The Split gesture's picture (annotations layer): a tick across the wall where the split would land, and the clear
// distance from each end of the room-side face to it, as the opening chain draws its pieces. The snap mark and its
// word come from state.snap (scene-marks.ts).

/** Draws the tick and the two distances for `tick` on `wallId`; `typed` is the value being typed, shown on the plate it changes. */
export function drawSplit(state: EditorState, doc: Document, wallId: string, tick: SplitTick, typed: string, out: Primitive[]): void {
  const f = wallFrame(doc, wallId);
  const face = splitFace(doc, wallId);
  if (!f || !face) return;
  const half = scale(f.left, f.half + 4 / state.camera.zoom);
  out.push({ kind: "segment", a: sub(tick.point, half), b: add(tick.point, half), width: { px: 2 }, color: COLORS.snap, cap: "butt" });
  const side = state.selection[0]; // the face's normal: towards the room side, as the helper's frame has it
  void side;
  const normal = scale(f.left, 1);
  const lift = scale(normal, (f.half * state.camera.zoom + HELPER_OFFSET_PX) / state.camera.zoom);
  const at = (t: number): Point => add(f.a, scale(f.dir, t));
  const pieces: [number, number, string][] = [
    [face.start, face.start + tick.offset, typed === "" ? shown(tick.offset) : typed],
    [face.start + tick.offset, face.end, shown(face.end - face.start - tick.offset)],
  ];
  pieces.forEach(([from, to, text], i) => {
    if (to - from <= 0) return;
    const p = add(at(from), lift);
    const q = add(at(to), lift);
    const mid = scale(add(p, q), 0.5);
    const plate = { text, at: mid, ...labelBox(text, mid, HELPER_FONT, state.camera) };
    drawDimension(p, q, i === 0 ? [p, q] : [q], normal, plate, state.camera.zoom, out);
    drawPlate(plate, i === 0 && typed !== "" ? typed : null, out);
  });
}
