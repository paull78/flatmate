import { isValidId } from "@fm/domain";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { showToast } from "../toast";
import type { SelectToolState } from "./types";

type Editing = Extract<SelectToolState, { kind: "editingHelper" }>;

/** The helper's value field (spec §5.4 precedence 1, §5.6). Returns null for keys it does not capture. */
export function helperKey(state: EditorState, tool: Editing, key: string, host: Host): Step | null {
  const edits = /^[0-9]$/.test(key) || key === "." || key === "Backspace" || key === "Enter" || key === " ";
  if (!edits) return null;
  // The wall may have vanished since the edit began (phase 7: a remote delete): the edit ends.
  if (!wallExists(state, tool.wallId)) return { state: withSelect(state, { kind: "idle" }), effects: [] };
  if (key === "Enter" || key === " ") return applyLength(state, tool, host);
  const value = key === "Backspace" ? tool.value.slice(0, -1) : tool.value + key;
  return { state: withSelect(state, { ...tool, value }), effects: [] };
}

/** setWallLength keeping endpoint a. A bad number keeps editing; any other outcome ends it and keeps the selection. */
function applyLength(state: EditorState, tool: Editing, host: Host): Step {
  const idle = withSelect(state, { kind: "idle" });
  if (tool.value === "") return { state: idle, effects: [] };
  const length = Number(tool.value);
  if (!Number.isFinite(length) || length <= 0) return showToast(state, "Type a length in metres", host);
  const out = runCommand(idle, { type: "setWallLength", wallId: tool.wallId, length, keep: "a" }, host);
  return { state: out.state, effects: out.effects };
}

function wallExists(state: EditorState, wallId: string): boolean {
  return state.document !== null && isValidId(wallId) && visibleDoc(state.document).walls[wallId] !== undefined;
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
