import { showToast } from "./toast";
import { wallGroup } from "./tools/wall-group";
import { assertNever } from "@fm/protocol";
import { openFinishId } from "./properties/open-finish";
import { runCommand, runHistory } from "./commit";
import { visibleDoc } from "./document/open-document";
import { duplicateSelection, turnGhost } from "./duplicate";
import { closeSheetsView } from "./export/report-writing";
import { sheetsViewShowing } from "./export/sheets-view";
import { turnGroup, turnInPlace } from "./tools/turn";
import { pickTool, stepLevel } from "./levels";
import { followCamera } from "./pointer";
import type { Host } from "./ports/host";
import { selectedPlacements, switchTool, type EditorState, type Step } from "./state";
import { columnEscape } from "./tools/column-tool";
import { deckEscape } from "./tools/deck-tool";
import { holeEscape } from "./tools/hole-tool";
import { dimensionEscape } from "./tools/dimension-tool";
import { objectEscape, turnObjectGhost } from "./tools/object-tool";
import { nudgeKey } from "./tools/nudge";
import { scaleEscape, scaleKey } from "./tools/scale-tool";
import { sectionEscape } from "./tools/section-tool";
import { selectEscape, selectKey, turnMoving } from "./tools/select-tool";
import { TOOLS } from "./tools/tool-table";
import { zoneIdle } from "./tools/types";
import { wallEscape, wallKey } from "./tools/wall-tool";
import type { Mods, ToolName } from "./types";
import { view3dKey } from "./view3d-state";

/** Precedence (spec: tools): (1) the active value field, (2) command codes, (3) global shortcuts. */
export function onKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  if (sheetsViewShowing(state)) return sheetsViewKey(state, key, mods, host);
  const chord = mods.ctrl || mods.meta; // Cmd+- zooms the browser, Ctrl+C copies: never typed into a value
  const dragging = state.tool.name === "select" && state.tool.state.kind === "moving"; // a walls drag swallows letters, never chords (straight.20)
  const captured = chord && (typingValue(state) || dragging) ? null : valueField(state, key, host);
  if (captured) return captured;
  const tool = commandCode(key, mods);
  if (tool) return { state: pickTool(state, tool), effects: [] };
  return globalKey(state, key, mods, host);
}

/** With the sheets view over the plan, only undo, redo and leaving it get through: focus on the body would send V and Delete to the plan (sheetset.14). */
function sheetsViewKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  if (key === "Escape") return closeSheetsView(state, host);
  if ((mods.meta || mods.ctrl) && key.toLowerCase() === "z") return undoRedo(state, mods.shift ? "redo" : "undo", host);
  return { state, effects: [] };
}

/** A tool's shortcut key (the tool table), without Ctrl, Cmd or Alt. */
export function commandCode(key: string, mods: Mods): ToolName | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  return TOOLS.find((t) => t.key.toLowerCase() === key.toLowerCase())?.tool ?? null;
}

function valueField(state: EditorState, key: string, host: Host): Step | null {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallKey(state, tool.state, key, host);
    case "select":
      return selectKey(state, tool.state, key, host);
    case "scale":
      return scaleKey(state, tool.state, key, host);
    case "zone":
    case "object":
    case "opening":
    case "dimension":
    case "column":
    case "deck":
    case "hole":
    case "section":
      return null;
    default:
      return assertNever(tool);
  }
}

function globalKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  const command = mods.meta || mods.ctrl;
  if (key === "Escape") {
    if (state.underPointer) return { state: { ...state, underPointer: null }, effects: [] };
    if (openFinishId(state) !== null) return { state: { ...state, openFinish: null }, effects: [] }; // an open finish row first (inherit step 04)
    return { state: escape(state), effects: [] };
  }
  if (command && key.toLowerCase() === "z") return undoRedo(state, mods.shift ? "redo" : "undo", host);
  if (command && key.toLowerCase() === "s") return { state, effects: [] }; // saves a local file with X1; no-op now
  if ((key === "Delete" || key === "Backspace") && !command) return deleteSelection(state, host);
  if (key.toLowerCase() === "r" && !command && !mods.alt) {
    const tool = state.tool; // with a ghost up, R turns the ghost (ghost.03), never the originals
    if (tool.name === "object") return { state: turnObjectGhost(state, tool.state), effects: [] };
    if (tool.name === "select" && tool.state.kind === "moving") return { state: turnMoving(state, tool.state), effects: [] };
    return tool.name === "select" && tool.state.kind === "copying" ? turnGhost(state, tool.state) : rotateSelection(state, host);
  }
  if (key.startsWith("Arrow") && !command && !mods.alt) return nudgeKey(state, key, mods.shift, host);
  if ((key === "PageUp" || key === "PageDown") && !command && !mods.alt && !typingValue(state)) return { state: stepLevel(state, key === "PageUp" ? 1 : -1), effects: [] };
  const v3 = view3dKey(state, key, mods);
  if (v3) return { state: v3, effects: [] };
  if (command && key.toLowerCase() === "d") return duplicateSelection(state, host);
  return { state, effects: [] };
}

/**
 * Whether a typed value field is open: the Wall tool's length, a helper's value or the Scale tool's distance. Page Up,
 * Page Down and the level strip are ignored while one is (levels.40).
 */
export function typingValue(state: EditorState): boolean {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return tool.state.kind === "drawing";
    case "select":
      return tool.state.kind === "editingHelper" || tool.state.kind === "editingGap" || tool.state.kind === "splitting" || (tool.state.kind === "moving" && Boolean(tool.state.value));
    case "scale":
      return tool.state.kind === "typing";
    case "zone":
    case "object":
    case "opening":
    case "dimension":
    case "column":
    case "deck":
    case "hole":
    case "section":
      return false;
    default:
      return assertNever(tool);
  }
}

/**
 * Undo and redo (keys or the floating bar). A refused request only shows its toast. An applied one drops the
 * gesture in progress, since a wall chain's preview or a drag's attempt was built on the document
 * before it and a chain must not continue from an undone joint, then replays the pointer so hover,
 * snap and the idle preview are rebuilt on the new document. Only an applied request replaces the
 * document object.
 */
export function undoRedo(state: EditorState, direction: "undo" | "redo", host: Host): Step {
  const r = runHistory(state, direction, host);
  if (r.state.document === state.document) return r;
  const replay = followCamera(reidle(r.state), host);
  return { state: replay.state, effects: [...r.effects, ...replay.effects] };
}

/** The same tool, idle; the Zone tool keeps its armed motif, so an undo leaves the Floor mode armed (finishes.19). */
function reidle(state: EditorState): EditorState {
  const tool = state.tool;
  const idle = switchTool(state, tool.name);
  return tool.name === "zone" ? { ...idle, tool: zoneIdle(tool.state.motif) } : idle;
}

/** Esc cancels the current operation; a second Esc returns to Select (spec: tools). */
function escape(state: EditorState): EditorState {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallEscape(state, tool.state);
    case "select":
      return selectEscape(state, tool.state);
    case "dimension":
      return dimensionEscape(state, tool.state);
    case "deck":
      return deckEscape(state, tool.state);
    case "hole":
      return holeEscape(state, tool.state);
    case "section":
      return sectionEscape(state, tool.state);
    case "column":
      return columnEscape(state);
    case "scale":
      return scaleEscape(state, tool.state);
    case "object":
      return objectEscape(state, tool.state);
    case "zone": // a press drawing an area drops; with none, Select (areas.06)
      return tool.state.kind === "pressing" ? { ...state, snap: null, tool: zoneIdle(tool.state.motif) } : switchTool(state, "select");
    case "opening":
      return switchTool(state, "select");
    default:
      return assertNever(tool);
  }
}

/** In the Select tool (idle) the selection; in the Zone tool only a selected zone or named area (spec: tools, areas.07). */
export function deleteSelection(state: EditorState, host: Host): Step {
  const tool = state.tool;
  const ids =
    tool.name === "select" && tool.state.kind === "idle"
      ? state.selection
      : tool.name === "zone"
        ? state.selection.filter((r) => r.table === "zoneLabels" || r.table === "areas")
        : [];
  if (ids.length === 0) return { state, effects: [] };
  const out = runCommand(state, { type: "deleteEntities", ids }, host);
  return { state: out.state, effects: out.effects };
}

/**
 * R: the one selected object turns 90° counter-clockwise about its centre in the active layout (spec: layouts); a group
 * turns about the centre of its bounding box (direct.08). Select tool, idle.
 */
function rotateSelection(state: EditorState, host: Host): Step {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "idle" || !state.document) return { state, effects: [] };
  const doc = visibleDoc(state.document);
  if (wallGroup(doc, state.selection)) return showToast(state, "Walls don't turn", host); // a group with walls (straight.24)
  const ids = selectedPlacements(state);
  const [first] = ids;
  const one = ids.length === 1 && first ? doc.placements[first] : undefined;
  const command = ids.length > 1 ? turnGroup(doc, ids) : one ? turnInPlace(doc, one, one.rotation + 90) : null;
  if (!command) return { state, effects: [] };
  const out = runCommand(state, command, host);
  return { state: out.state, effects: out.effects };
}

