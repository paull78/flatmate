import { isValidId, type Command } from "@fm/domain";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import { viewedLevelOn, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import { cantRead, editedValue, readValue } from "../typed-value";
import { chainCommand, clearLengthCommand } from "./chain-edit";
import type { SelectToolState } from "./types";

type Editing = Extract<SelectToolState, { kind: "editingHelper" }>;

/** The helper's value field (spec: tools precedence 1, spec: tools). Returns null for keys it does not capture. */
export function helperKey(state: EditorState, tool: Editing, key: string, host: Host): Step | null {
  const value = editedValue(tool.value, key);
  if (value === null && key !== "Enter") return null;
  // The wall may have vanished since the edit began (phase 7: a remote delete): the edit ends.
  if (!wallExists(state, tool.wallId)) return { state: withSelect(state, { kind: "idle" }), effects: [] };
  return value === null ? apply(state, tool, host) : { state: withSelect(state, { ...tool, value }), effects: [] };
}

/**
 * The total: setWallLength keeping endpoint a, from the clear length (ux-polish.35); a chain piece: its one opening
 * command (ux-polish item 4). A bad number keeps editing; any other outcome ends it and keeps the selection.
 */
function apply(state: EditorState, tool: Editing, host: Host): Step {
  const idle = withSelect(state, { kind: "idle" });
  if (tool.value === "") return { state: idle, effects: [] };
  const value = readValue(tool.value, "metres");
  if (value === null) return showToast(state, cantRead(tool.value), host);
  // A gap may be typed as 0 (an opening flush with a joint or its neighbour); a length may not.
  const bad = value < 0 || (value === 0 && tool.piece === undefined);
  if (bad) return showToast(state, "Type a length in metres", host);
  const doc = state.document && visibleDoc(state.document);
  const command: Command | null = !doc
    ? null
    : tool.piece === undefined
      ? clearLengthCommand(doc, tool.wallId, value)
      : chainCommand(doc, tool.wallId, tool.piece, value, viewedLevelOn(state, doc));
  if (!command) return { state: idle, effects: [] }; // the wall or the piece is gone
  const out = runCommand(idle, command, host);
  return { state: out.state, effects: out.effects };
}

function wallExists(state: EditorState, wallId: string): boolean {
  return state.document !== null && isValidId(wallId) && visibleDoc(state.document).walls[wallId] !== undefined;
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
