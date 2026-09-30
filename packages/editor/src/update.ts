import { assertNever } from "@fm/protocol";
import { panBy, zoomAt, type Camera } from "./camera";
import { runCommand } from "./commit";
import { onKey, undoRedo } from "./keys";
import { followCamera, onPointer } from "./pointer";
import type { Effect } from "./ports/effects";
import type { Event, UiAction } from "./ports/events";
import type { Host } from "./ports/host";
import { onServerEvent, onWorkspaceEvent, onWorkspaceUi } from "./session";
import { switchTool, type EditorState, type Step } from "./state";
import { TOAST_TIMER, onToastTimer } from "./toast";
import { setField } from "./tools/zone-tool";
import { buildScene } from "./view/scene";
import { buildViewModel } from "./view/view-model";

/** The core loop (spec §5.1): synchronous, pure given the Host, one trailing render effect. */
export function update(state: EditorState, event: Event, host: Host): Step {
  const r = step(state, event, host);
  const render: Effect = {
    type: "render",
    scene: buildScene(r.state, host),
    view: buildViewModel(r.state, host),
    camera: r.state.camera,
  };
  return { state: r.state, effects: [...r.effects, render] };
}

function step(state: EditorState, event: Event, host: Host): Step {
  switch (event.type) {
    case "pointerDown":
    case "pointerMove":
    case "pointerUp":
      return onPointer(state, event, host);
    case "wheel":
      return followCamera({ ...state, camera: wheelCamera(state.camera, event) }, host);
    case "key":
      return onKey(state, event.key, event.mods, host);
    case "ui":
      return onUi(state, event.action, host);
    case "timerFired":
      return event.timerId === TOAST_TIMER ? onToastTimer(state, host) : { state, effects: [] };
    case "workspaceEvent":
      return onWorkspaceEvent(state, event.event, host);
    case "serverEvent":
      return onServerEvent(state, event.event, host);
    case "saveResult":
      return { state, effects: [] }; // X1 local files
    case "viewportResized":
      return followCamera({ ...state, camera: { ...state.camera, viewport: event.size, dpr: event.devicePixelRatio } }, host);
    case "command": {
      const out = runCommand(state, event.command, host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(event);
  }
}

/** Ctrl/⌘ or a pinch zooms at the cursor; otherwise the wheel pans (spec §5.4). */
function wheelCamera(camera: Camera, e: Extract<Event, { type: "wheel" }>): Camera {
  return e.mods.ctrl || e.mods.meta ? zoomAt(camera, e.screen, Math.exp(-e.deltaY * 0.01)) : panBy(camera, -e.deltaX, -e.deltaY);
}

function onUi(state: EditorState, action: UiAction, host: Host): Step {
  switch (action.type) {
    case "pickTool":
      return { state: switchTool(state, action.tool), effects: [] };
    case "undo":
    case "redo":
      return undoRedo(state, action.type, host);
    case "setField":
      return setField(state, action.fieldId, action.value, host);
    case "createProject":
    case "openProject":
    case "showProjectList":
      return onWorkspaceUi(state, action, host);
    default:
      return assertNever(action);
  }
}
