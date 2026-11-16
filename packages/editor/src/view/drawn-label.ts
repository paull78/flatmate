import { shown } from "@fm/domain";
import { screenToWorld } from "../camera";
import type { EditorState } from "../state";
import { typedHeight } from "../tools/armed-size";
import type { ObjectGhost } from "../tools/types";
import { COLORS } from "./colors";
import { CHROME_FONT, HELPER_FONT, textWidth } from "./fonts";
import { textBox } from "./labels";
import type { Primitive } from "./scene-types";

// The size of a footprint being drawn (sizing.07, .12, .31): one label above and right of the pointer, width (the
// back's length) then depth, and a typed height after them; red when the ghost is.

const RIGHT_PX = 12; // from the pointer to the label's near edge
const ABOVE_PX = 18; // from the pointer up to the label's middle
const MARGIN_PX = 4;

/** The drawn ghost's words: `W 1.20 × D 0.60 m`, or `W 1.20 × D 0.60 × H 1.40 m` with a typed height armed. */
export function drawnWords(ghost: ObjectGhost, typed: number | null): string {
  return `W ${shown(ghost.w)} × D ${shown(ghost.d)}${typed === null ? "" : ` × H ${shown(typed)}`} m`;
}

/** The label of a footprint being drawn, on a backing like a resize's size label; none unless the ghost is drawn. */
export function drawnLabel(state: EditorState, ghost: ObjectGhost): Primitive[] {
  const pointer = state.pointer?.screen;
  const drawing = state.tool.name === "object" && !!state.tool.state.pressing?.corner;
  if (!ghost.drawn || !drawing || !pointer) return [];
  const text = drawnWords(ghost, typedHeight(state));
  const half = textWidth(CHROME_FONT, text, HELPER_FONT.size) / 2;
  const { width } = state.camera.viewport;
  const right = pointer.x + RIGHT_PX + half;
  const x = right + half <= width - MARGIN_PX ? right : pointer.x - RIGHT_PX - half; // left of the pointer at the view's right edge
  const y = Math.max(pointer.y - ABOVE_PX, MARGIN_PX + HELPER_FONT.size);
  const at = screenToWorld(state.camera, { x, y });
  return [
    textBox(text, at, HELPER_FONT, state.camera),
    { kind: "text", text, at, size: HELPER_FONT.size, color: ghost.fits ? COLORS.text : COLORS.invalid, align: "center", rotation: 0, font: CHROME_FONT },
  ];
}
