import { UNDERLAY_ID, distance } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import { hasEntry } from "../history/history";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { switchTool, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import { COLORS } from "../view/colors";
import type { Primitive } from "../view/scene-types";
import { DRAG_THRESHOLD_PX } from "./hit-test";
import type { ScaleToolState } from "./types";
import { cantRead, editedValue, readValue } from "../typed-value";

/** Whether the open drawing has a picture to scale; the tool reads the row, so it also works while this viewer hides it. */
export function hasUnderlay(state: EditorState): boolean {
  return state.document !== null && visibleDoc(state.document).underlays[UNDERLAY_ID] !== undefined;
}

/**
 * Import.13: a press sets A, then B, at the raw pointer (no snap); then the distance is typed. Releases are ignored,
 * and so is every press with no picture. A second press within the drag threshold of A is ignored, before the domain
 * refuses coincident points; a press while typing is ignored too.
 */
export function scalePointer(state: EditorState, tool: ScaleToolState, e: PointerInput): Step {
  const p = state.pointer;
  if (e.type !== "pointerDown" || !p || !hasUnderlay(state)) return { state, effects: [] };
  switch (tool.kind) {
    case "idle":
      return { state: withScale(state, { kind: "second", a: p.world }), effects: [] };
    case "second":
      if (distance(p.world, tool.a) * state.camera.zoom <= DRAG_THRESHOLD_PX) return { state, effects: [] };
      return { state: withScale(state, { kind: "typing", a: tool.a, b: p.world, value: "" }), effects: [] };
    case "typing":
      return { state, effects: [] };
    default:
      return assertNever(tool);
  }
}

/**
 * The value field while typing, as the Wall tool's (spec: tools precedence 1): typed keys append, Backspace trims,
 * Enter sends the scale; an empty Enter is swallowed. Null outside typing, so Ctrl+Z still reaches Undo.
 */
export function scaleKey(state: EditorState, tool: ScaleToolState, key: string, host: Host): Step | null {
  switch (tool.kind) {
    case "idle":
    case "second":
      return null;
    case "typing": {
      const value = editedValue(tool.value, key);
      if (value !== null) return { state: withScale(state, { ...tool, value }), effects: [] };
      if (key === "Enter") return tool.value === "" ? { state, effects: [] } : sendScale(state, tool, host);
      return null;
    }
    default:
      return assertNever(tool);
  }
}

/** Esc drops both points; with nothing placed it picks the Select tool (spec: tools). Unlike Dimension, no step back. */
export function scaleEscape(state: EditorState, tool: ScaleToolState): EditorState {
  switch (tool.kind) {
    case "idle":
      return switchTool(state, "select");
    case "second":
    case "typing":
      return withScale(state, { kind: "idle" });
    default:
      return assertNever(tool);
  }
}

/** The dashed line from A to the raw cursor, then to B, with a mark at each point; nothing at A while the pointer is off the canvas. */
export function scaleOverlay(state: EditorState): Primitive[] {
  const tool = state.tool;
  if (tool.name !== "scale") return [];
  const t = tool.state;
  switch (t.kind) {
    case "idle":
      return [];
    case "second":
      return state.pointer ? [band(t.a, state.pointer.world), mark(t.a)] : [];
    case "typing":
      return [band(t.a, t.b), mark(t.a), mark(t.b)];
    default:
      return assertNever(t);
  }
}

/**
 * The domain does the maths (import.13): the tool only sends the points and the distance. Refused, or rejected by the
 * document in the same step (the ~870 KB put can hit the size guard): A and B stay and the toast says why. An accepted
 * scale returns to Select, since scaling is a one-off before tracing; so does one that changes nothing, which
 * runCommand returns untouched (every refusal toasts, so it returns a new state).
 */
function sendScale(state: EditorState, tool: Extract<ScaleToolState, { kind: "typing" }>, host: Host): Step {
  const d = readValue(tool.value, "metres");
  if (d === null) return showToast(state, cantRead(tool.value), host);
  if (d <= 0) return showToast(state, "Type a distance in metres", host);
  const out = runCommand(state, { type: "scaleUnderlay", a: tool.a, b: tool.b, distance: d }, host);
  if (out.committed === null && out.state === state) return { state: switchTool(state, "select"), effects: out.effects };
  if (out.committed === null || !hasEntry(out.state.undo, out.committed)) return { state: out.state, effects: out.effects };
  return { state: switchTool(out.state, "select"), effects: out.effects };
}

function band(a: Point, b: Point): Primitive {
  return { kind: "segment", a, b, width: { px: 1 }, color: COLORS.wallSelected, cap: "butt", dash: [4, 3] };
}

function mark(at: Point): Primitive {
  return { kind: "disc", center: at, radius: { px: 3 }, color: COLORS.wallSelected };
}

/** Never snaps, so the snap mark stays off. */
function withScale(state: EditorState, tool: ScaleToolState): EditorState {
  return { ...state, tool: { name: "scale", state: tool }, snap: null };
}
