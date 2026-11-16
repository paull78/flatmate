import { assertNever } from "@fm/protocol";
import { panBy, screenToWorld } from "./camera";
import type { PointerInput } from "./ports/events";
import type { Host } from "./ports/host";
import { pointerPresence } from "./session";
import type { EditorState, Step } from "./state";
import { columnPointer } from "./tools/column-tool";
import { deckPointer } from "./tools/deck-tool";
import { holePointer } from "./tools/hole-tool";
import { dimensionPointer } from "./tools/dimension-tool";
import { objectPointer } from "./tools/object-tool";
import { openingPointer } from "./tools/opening-tool";
import { scalePointer } from "./tools/scale-tool";
import { everythingAt } from "./tools/hit-test";
import { sectionPointer } from "./tools/section-tool";
import { selectPointer } from "./tools/select-tool";
import { wallPointer } from "./tools/wall-tool";
import { zonePointer } from "./tools/zone-tool";

export function onPointer(state: EditorState, e: PointerInput, host: Host): Step {
  // A press on the canvas closes the list, and does nothing else (AC-06).
  if (state.underPointer && e.type === "pointerDown") return { state: { ...withPointer(state, e), underPointer: null }, effects: [] };
  if (e.type === "pointerDown" && e.button === 1) return { state: { ...withPointer(state, e), panDrag: e.screen }, effects: [] };
  if (state.panDrag) {
    // Any pointerUp ends a pan; the tool missed the pan's moves, so it catches up now.
    if (e.type === "pointerUp") return followCamera({ ...withPointer(state, e), panDrag: null }, host);
    // A grab pan keeps the same world point under the cursor, so there is no presence to send.
    const camera = panBy(state.camera, e.screen.x - state.panDrag.x, e.screen.y - state.panDrag.y);
    return { state: withPointer({ ...state, camera, panDrag: e.screen }, e), effects: [] };
  }
  const s = withPointer(state, e);
  const listed = opensList(s, e);
  const r = listed ? { state: listed, effects: [] } : e.button === 2 ? { state: s, effects: [] } : toolPointer(s, e, host);
  return e.type === "pointerMove" ? { state: r.state, effects: [...r.effects, ...pointerPresence(r.state)] } : r;
}

/**
 * The list's opening, or null (AC-06): on release, with the Select tool idle, the right button, or a Ctrl-click that never
 * became a drag: a Mac's right-click, and a press with Ctrl stays a drag past the threshold, with its snap bypass. Null
 * with nothing there, so a Ctrl-click on nothing stays a click.
 */
function opensList(state: EditorState, e: PointerInput): EditorState | null {
  if (e.type !== "pointerUp" || state.tool.name !== "select" || !state.pointer) return null;
  const t = state.tool.state;
  const press = e.button === 0 && e.mods.ctrl && (t.kind === "pressing" || (t.kind === "box" && t.corner === null));
  if (!press && !(e.button === 2 && t.kind === "idle")) return null;
  const rows = everythingAt(state, state.pointer.world);
  if (rows.length === 0) return null;
  return { ...state, tool: { name: "select", state: { kind: "idle" } }, underPointer: { at: e.screen, rows, hovered: null } };
}

/**
 * After the camera moves under a still cursor, replays the last pointer position (spec: editor) as a
 * move, so `pointer.world`, the tool's preview, snap and hover, and presence follow the cursor; a
 * typed length then uses the current cursor direction (spec: wall-editing). During a middle-drag pan only
 * `pointer.world` and presence follow; the tool is told when the pan ends. Without a pointer yet,
 * nothing changes. An applied undo or redo also replays, so the tool rebuilds on the new document.
 */
export function followCamera(state: EditorState, host: Host): Step {
  const p = state.pointer;
  if (!p) return { state, effects: [] };
  const e: PointerInput = { type: "pointerMove", screen: p.screen, mods: p.mods, button: 0 };
  if (!state.panDrag) return onPointer(state, e, host);
  const s = withPointer(state, e);
  return { state: s, effects: pointerPresence(s) };
}

/** Records the pointer under the current camera; call it after any camera change. */
function withPointer(state: EditorState, e: PointerInput): EditorState {
  return { ...state, pointer: { screen: e.screen, world: screenToWorld(state.camera, e.screen), mods: e.mods } };
}

function toolPointer(state: EditorState, e: PointerInput, host: Host): Step {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallPointer(state, tool.state, e, host);
    case "select":
      return selectPointer(state, tool.state, e, host);
    case "zone":
      return zonePointer(state, tool.state, e, host);
    case "object":
      return objectPointer(state, tool.state, e, host);
    case "opening":
      return openingPointer(state, tool.state, e, host);
    case "dimension":
      return dimensionPointer(state, tool.state, e, host);
    case "column":
      return columnPointer(state, tool.state, e, host);
    case "deck":
      return deckPointer(state, tool.state, e, host);
    case "hole":
      return holePointer(state, tool.state, e, host);
    case "section":
      return sectionPointer(state, tool.state, e, host);
    case "scale":
      return scalePointer(state, tool.state, e);
    default:
      return assertNever(tool);
  }
}
