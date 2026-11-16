import type { UiAction } from "../ports/events";
import type { EditorState, Step } from "../state";
import { pickPreset, setArmedSize } from "./armed-size";
import { rebuildObjectGhost } from "./object-tool";

// The armed size's two actions with the ghost worked out again at once (sizing.23 c): split from armed-size.ts, which
// object-tool.ts imports, so the rebuild can't live there.

/** The ghost under a still pointer, rebuilt for the armed size just changed. */
function rebuilt(state: EditorState): Step {
  return { state: state.tool.name === "object" ? rebuildObjectGhost(state, state.tool.state) : state, effects: [] };
}

/** A pick from the size picker (furnish.05). */
export function pickPresetStep(state: EditorState, kind: string, label: string): Step {
  const next = pickPreset(state, kind, label);
  return next === state ? { state, effects: [] } : rebuilt(next);
}

/** A typed width or depth from the hint line (sizing.06). */
export function setArmedSizeStep(state: EditorState, action: Extract<UiAction, { type: "setArmedSize" }>): Step {
  const { width, depth, height } = action;
  const texts = { ...(width === undefined ? {} : { width }), ...(depth === undefined ? {} : { depth }), ...(height === undefined ? {} : { height }) };
  const next = setArmedSize(state, action.kind, texts);
  return next === state ? { state, effects: [] } : rebuilt(next);
}
