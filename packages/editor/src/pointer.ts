import { assertNever } from "@fm/protocol";
import { panBy, screenToWorld } from "./camera";
import type { PointerInput } from "./ports/events";
import type { Host } from "./ports/host";
import { pointerPresence } from "./session";
import type { EditorState, Step } from "./state";
import { selectPointer } from "./tools/select-tool";
import { wallPointer } from "./tools/wall-tool";
import { zonePointer } from "./tools/zone-tool";

export function onPointer(state: EditorState, e: PointerInput, host: Host): Step {
  if (e.type === "pointerDown" && e.button === 1) return { state: { ...withPointer(state, e), panDrag: e.screen }, effects: [] };
  if (state.panDrag) {
    // Any pointerUp ends a pan; the tool missed the pan's moves, so it catches up now.
    if (e.type === "pointerUp") return followCamera({ ...withPointer(state, e), panDrag: null }, host);
    // A grab pan keeps the same world point under the cursor, so there is no presence to send.
    const camera = panBy(state.camera, e.screen.x - state.panDrag.x, e.screen.y - state.panDrag.y);
    return { state: withPointer({ ...state, camera, panDrag: e.screen }, e), effects: [] };
  }
  const s = withPointer(state, e);
  const r = e.button === 2 ? { state: s, effects: [] } : toolPointer(s, e, host); // no context menu in the initial build
  return e.type === "pointerMove" ? { state: r.state, effects: [...r.effects, ...pointerPresence(r.state)] } : r;
}

/**
 * After the camera moves under a still cursor, replays the last pointer position (spec §5.3) as a
 * move, so `pointer.world`, the tool's preview, snap and hover, and presence follow the cursor; a
 * typed length then uses the current cursor direction (spec §5.5). During a middle-drag pan only
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
    default:
      return assertNever(tool);
  }
}
