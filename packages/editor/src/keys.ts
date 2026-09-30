import { assertNever } from "@fm/protocol";
import { runCommand, runHistory } from "./commit";
import { followCamera } from "./pointer";
import type { Host } from "./ports/host";
import { switchTool, type EditorState, type Step } from "./state";
import { selectEscape, selectKey } from "./tools/select-tool";
import { wallEscape, wallKey } from "./tools/wall-tool";
import type { Mods, ToolName } from "./types";

/** Precedence (spec §5.4): (1) the active value field, (2) command codes, (3) global shortcuts. */
export function onKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  const captured = valueField(state, key, host);
  if (captured) return captured;
  const tool = commandCode(key, mods);
  if (tool) return { state: switchTool(state, tool), effects: [] };
  return globalKey(state, key, mods, host);
}

export function commandCode(key: string, mods: Mods): ToolName | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  switch (key.toLowerCase()) {
    case "v":
      return "select";
    case "w":
      return "wall";
    case "z":
      return "zone";
    default:
      return null;
  }
}

function valueField(state: EditorState, key: string, host: Host): Step | null {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallKey(state, tool.state, key, host);
    case "select":
      return selectKey(state, tool.state, key, host);
    case "zone":
      return null;
    default:
      return assertNever(tool);
  }
}

function globalKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  const command = mods.meta || mods.ctrl;
  if (key === "Escape") return { state: escape(state), effects: [] };
  if (command && key.toLowerCase() === "z") return undoRedo(state, mods.shift ? "redo" : "undo", host);
  if (command && key.toLowerCase() === "s") return { state, effects: [] }; // saves a local file with X1; no-op now
  if ((key === "Delete" || key === "Backspace") && !command) return deleteSelection(state, host);
  return { state, effects: [] };
}

/**
 * Undo and redo (keys or toolbar). A refused request only shows its toast. An applied one drops the
 * gesture in progress, since a wall chain's preview or a drag's attempt was built on the document
 * before it and a chain must not continue from an undone joint, then replays the pointer so hover,
 * snap and the idle preview are rebuilt on the new document. Only an applied request replaces the
 * document object.
 */
export function undoRedo(state: EditorState, direction: "undo" | "redo", host: Host): Step {
  const r = runHistory(state, direction, host);
  if (r.state.document === state.document) return r;
  const replay = followCamera(switchTool(r.state, r.state.tool.name), host);
  return { state: replay.state, effects: [...r.effects, ...replay.effects] };
}

/** Esc cancels the current operation; a second Esc returns to Select (spec §5.4). */
function escape(state: EditorState): EditorState {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallEscape(state, tool.state);
    case "select":
      return selectEscape(state, tool.state);
    case "zone":
      return switchTool(state, "select");
    default:
      return assertNever(tool);
  }
}

/** In the Select tool (idle) the selection; in the Zone tool only a selected zone (spec §5.4). */
function deleteSelection(state: EditorState, host: Host): Step {
  const tool = state.tool;
  const ids =
    tool.name === "select" && tool.state.kind === "idle"
      ? state.selection
      : tool.name === "zone"
        ? state.selection.filter((r) => r.table === "zoneLabels")
        : [];
  if (ids.length === 0) return { state, effects: [] };
  const out = runCommand(state, { type: "deleteEntities", ids }, host);
  return { state: out.state, effects: out.effects };
}
