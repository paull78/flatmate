import { FLIP_MS } from "./flip-clock";
import { FIRST_STATE, type Document } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { runCommand } from "./commit";
import { visibleDoc } from "./document/open-document";
import type { UiAction } from "./ports/events";
import type { Host } from "./ports/host";
import { activeStateId, switchTool, type EditorState, type Step } from "./state";

type StateAction = Extract<UiAction, { type: "setActiveState" | "addState" | "renameState" | "deleteState" }>;

/** The first "Layout N" not yet used, N counting from the number of states plus one; the first is "Layout" (cleanup.09). */
function nextStateName(doc: Document): string {
  const names = new Set(Object.values(doc.states).map((s) => s.name));
  let n = Object.keys(doc.states).length + 1;
  while (names.has(`${FIRST_STATE.name} ${n}`)) n++;
  return `${FIRST_STATE.name} ${n}`;
}

/**
 * The state switcher (spec: layouts). Picking a state is local: the active state is a per-user preference, like
 * the camera: it sends no edit, only presence (layout-states.55). Adding, renaming and deleting states are ordinary
 * edits through the commit path.
 */
export function onStateUi(state: EditorState, action: StateAction, host: Host): Step {
  const d = state.document;
  if (!d) return { state, effects: [] };
  switch (action.type) {
    case "setActiveState": {
      const from = activeStateId(state);
      if (!visibleDoc(d).states[action.id] || from === action.id) return { state, effects: [] };
      // A flip animates from the layout shown now (the target of a flip in progress) to the new one.
      const flip = from === null ? null : { from, to: action.id, startedAt: host.now(), t: 0 };
      return { state: { ...state, activeState: action.id, flip }, effects: flip ? [{ type: "requestFrame" }] : [] };
    }
    case "addState": {
      const from = activeStateId(state);
      if (from === null) return { state, effects: [] };
      const opId = host.newId();
      const out = runCommand(state, { type: "copyState", opId, from, name: nextStateName(visibleDoc(d)) }, host);
      const created = out.patch?.puts.find((p) => p.table === "states")?.entity.id;
      const visible = out.state.document ? visibleDoc(out.state.document) : null;
      return { state: created !== undefined && visible?.states[created] ? { ...out.state, activeState: created } : out.state, effects: out.effects };
    }
    case "renameState": {
      const out = runCommand(state, { type: "renameState", stateId: action.id, name: action.name }, host);
      return { state: out.state, effects: out.effects };
    }
    case "deleteState": {
      const out = runCommand(state, { type: "deleteState", stateId: action.id }, host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(action);
  }
}

/**
 * A change of the active layout drops the furniture from the selection (direct.07): its placements belong to the
 * layout left. Walls, joints, openings and labels stay, since every layout shares them.
 */
export function clearFurnitureOnLayoutChange(before: EditorState, r: Step): Step {
  if (activeStateId(before) === activeStateId(r.state) || !r.state.selection.some((ref) => ref.table === "placements")) return r;
  return { ...r, state: { ...r.state, selection: r.state.selection.filter((ref) => ref.table !== "placements") } };
}

/** A change of the active layout drops a half-placed dimension (spec §Placing), as switching tools does. */
export function dropDimensionOnLayoutChange(before: EditorState, r: Step): Step {
  const tool = r.state.tool;
  if (activeStateId(before) === activeStateId(r.state) || tool.name !== "dimension" || tool.state.kind === "idle") return r;
  return { ...r, state: switchTool(r.state, "dimension") };
}


/** A frame during a flip: advances it, asks for the next frame, or ends it after FLIP_MS (spec: layouts). */
export function onFrame(state: EditorState, now: number): Step {
  const flip = state.flip;
  if (!flip) return { state, effects: [] };
  const t = Math.min(1, Math.max(0, (now - flip.startedAt) / FLIP_MS));
  if (t >= 1) return { state: { ...state, flip: null }, effects: [] };
  return { state: { ...state, flip: { ...flip, t } }, effects: [{ type: "requestFrame" }] };
}

