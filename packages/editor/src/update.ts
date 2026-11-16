import { furnitureSet } from "./furniture-sets";
import { closeFinishOnSelection, toggleFinish } from "./properties/open-finish";
import { assertNever } from "@fm/protocol";
import { panBy, worldToScreen, zoomAt, type Camera } from "./camera";
import { runCommand } from "./commit";
import { onSheetListUi } from "./export/sheet-list";
import { onExportUi, onRasterised } from "./export/panel";
import { ghostGate } from "./duplicate";
import { onKey, typingValue, undoRedo } from "./keys";
import { clearFurnitureOnLayoutChange, dropDimensionOnLayoutChange, onFrame, onStateUi } from "./layout-states";
import { visibleDoc } from "./document/open-document";
import { REST_TIMER, onRestTimer, withPlate } from "./plate";
import { followCamera, onPointer } from "./pointer";
import type { Effect } from "./ports/effects";
import type { Event, UiAction } from "./ports/events";
import type { Host } from "./ports/host";
import { onCardFrame } from "./card-state";
import { onServerEvent, onWorkspaceEvent, onWorkspaceUi, pointerPresence, presenceOnStateChange } from "./session";
import { switchTool, type EditorState, type Step } from "./state";
import { NO_MODS } from "./types";
import { TOAST_TIMER, onToastTimer } from "./toast";
import { NUDGE_TIMER, beforeEvent, onNudgeTimer } from "./tools/nudge";
import { dropColumnGhost } from "./tools/column-tool";
import { objectChip } from "./tools/object-tool";
import { pickPresetStep, setArmedSizeStep } from "./tools/armed-size-events";
import { idleTool, zoneIdle } from "./tools/types";
import { onLogoUi } from "./logo";
import { onUnderlayUi } from "./underlay";
import { pickTool, settleLevel, viewLevel } from "./levels";
import { isUnderPointerAction, underPointerAction } from "./under-pointer";
import { buildScene } from "./view/scene";
import { stripAfter } from "./view/section-strip";
import { buildViewModel } from "./view/view-model";
import { onView3dUi, view3dFrame } from "./view3d-state";
import { framesAfter } from "./frames-state";
import { onSectionUi } from "./section-ui";
import { onSelectionUi } from "./selection-ui";

/** The core loop (spec: editor): synchronous, pure given the Host, one trailing render effect. */
export function update(state: EditorState, event: Event, host: Host): Step {
  const stepped = dropDimensionOnLayoutChange(state, clearFurnitureOnLayoutChange(state, endFlipOnChange(state, withPlate(state, event, (s) => step(s, event, host)))));
  const settled = settleLevel(state, stepped.state);
  const stripSection = stripAfter(settled.stripSection, state.selection, settled.selection, settled.document && visibleDoc(settled.document));
  const kept = stripSection === settled.stripSection ? settled : { ...settled, stripSection };
  const r = presenceOnStateChange(state, { state: closeFinishOnSelection(kept), effects: stepped.effects });
  const render: Effect = { type: "render", scene: buildScene(r.state), view: buildViewModel(r.state, host), camera: r.state.camera, view3d: view3dFrame(r.state) };
  return { state: r.state, effects: [...r.effects, render] };
}

/** A document change during a flip ends it at the final places (spec: layouts): the tween was built on the old document. */
function endFlipOnChange(before: EditorState, r: Step): Step {
  if (!r.state.flip || !before.document || !r.state.document) return r;
  return visibleDoc(before.document) === visibleDoc(r.state.document) ? r : { ...r, state: { ...r.state, flip: null } };
}

/**
 * A nudge run first keeps itself, commits, or cancels and swallows the event: one gate for every event
 * (tools/nudge.ts). The duplicate's ghost then keeps itself, drops, or swallows the event (duplicate.ts).
 */
function step(state: EditorState, event: Event, host: Host): Step {
  const gate = beforeEvent(state, event, host);
  if (gate.consumed) return { state: gate.state, effects: gate.effects };
  const ghost = ghostGate(gate.state, event);
  if (ghost.consumed) return { state: ghost.state, effects: gate.effects };
  const r = route(ghost.state, event, host);
  return gate.effects.length === 0 ? r : { state: r.state, effects: [...gate.effects, ...r.effects] };
}

function route(state: EditorState, event: Event, host: Host): Step {
  switch (event.type) {
    case "pointerDown":
    case "pointerMove":
    case "pointerUp":
      return onPointer(state, event, host);
    case "pointerLeave":
      return { state: pointerLeft(state), effects: [] };
    case "pointAt": {
      const pointed: EditorState = { ...state, pointer: { screen: worldToScreen(state.camera, event.world), world: event.world, mods: NO_MODS } };
      return { state: pointed, effects: pointerPresence(pointed) };
    }
    case "wheel":
      return followCamera({ ...state, underPointer: null, camera: wheelCamera(state.camera, event) }, host);
    case "key":
      return onKey(state, event.key, event.mods, host);
    case "ui":
      return onUi(state, event.action, host);
    case "timerFired":
      return event.timerId === TOAST_TIMER ? onToastTimer(state, host) : event.timerId === NUDGE_TIMER ? onNudgeTimer(state, host) : event.timerId === REST_TIMER ? onRestTimer(state) : { state, effects: [] };
    case "frame":
      return state.workspace.cardFlip !== null ? onCardFrame(state, event.now) : onFrame(state, event.now);
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
    case "rasterised":
      return onRasterised(state, event.requestId, event.image);
    default:
      return assertNever(event);
  }
}

/**
 * The pointer left the canvas: forget it, so no replay (undo, zoom) brings a preview back, and drop the Object
 * ghost and its press, the Opening preview (ux-polish item 1), the Deck tool's press and the Dimension and Section tools' snap mark.
 * A caught stair edge keeps its gesture and ghost, frozen, and a pinned fix offer stays, so its chips can be reached
 * (stairdraw.13, .43, .47). Other tools' gestures keep their state.
 */
function pointerLeft(state: EditorState): EditorState {
  const tool = state.tool;
  switch (tool.name) {
    case "object": { // a press's release then places nothing
      const ghost = tool.state.stair === null ? null : tool.state.ghost;
      return { ...state, pointer: null, tool: { name: "object", state: { ...tool.state, ghost, pressing: null, preview: null } } };
    }
    case "opening":
      return { ...state, pointer: null, tool: { name: "opening", state: { ...tool.state, preview: null } } };
    case "deck": // the press goes, so its release adds nothing
    case "hole":
      return { ...state, pointer: null, snap: null, tool: idleTool(tool.name) };
    case "column": // the ghost goes
      return { ...dropColumnGhost(state, tool.state), pointer: null };
    case "dimension": // the preview and the snap mark go; A and B stay placed
    case "section":
      return { ...state, pointer: null, snap: null };
    case "scale": // the rubber band goes; A and B stay placed
      return { ...state, pointer: null };
    case "select":
    case "wall":
    case "zone":
      return { ...state, pointer: null };
    default:
      return assertNever(tool);
  }
}

/** Ctrl/⌘ or a pinch zooms at the cursor; otherwise the wheel pans (spec: tools). */
function wheelCamera(camera: Camera, e: Extract<Event, { type: "wheel" }>): Camera {
  return e.mods.ctrl || e.mods.meta ? zoomAt(camera, e.screen, Math.exp(-e.deltaY * 0.01)) : panBy(camera, -e.deltaX, -e.deltaY);
}

function onUi(state: EditorState, action: UiAction, host: Host): Step {
  if (isUnderPointerAction(action)) return { state: underPointerAction(state, action), effects: [] };
  switch (action.type) {
    case "pickTool":
      return { state: pickTool(state, action.tool), effects: [] };
    case "pickKind":
      return { state: { ...pickTool(state, "object"), objectKind: action.kind, objectSet: null, sizeDraft: null }, effects: [] };
    case "pickSet": {
      const first = furnitureSet(action.set)?.pieces[0];
      return { state: first ? { ...pickTool(state, "object"), objectKind: first.kind, objectSet: action.set, sizeDraft: null } : state, effects: [] };
    }
    case "pickPreset":
      return pickPresetStep(state, action.kind, action.preset);
    case "setArmedSize":
      return setArmedSizeStep(state, action);
    case "chipHover":
    case "chipClick":
      return objectChip(state, action, host);
    case "pickOpeningKind":
      return { state: { ...pickTool(state, "opening"), openingKind: action.kind }, effects: [] };
    case "pickDeckPreset":
      return { state: { ...pickTool(state, "deck"), deckPreset: action.preset }, effects: [] };
    case "pickMotif": // the Floor mode: the Zone tool, armed (finishes.19), at the viewed level (deck-floors.02); picking any tool disarms it
      return { state: { ...switchTool(state, "zone"), tool: zoneIdle(action.motif) }, effects: [] };
    case "setFinishesOn":
      return { state: { ...state, finishesOn: action.on }, effects: [] };
    case "toggleFinish": return { state: toggleFinish(state, action.id), effects: [] }; // a finish row in Properties (inherit step 04)
    case "openExport":
    case "openSheet":
    case "closeExport":
    case "setExport":
    case "download":
    case "setSheetSetting":
      return onExportUi(state, action, host);
    case "selectSheet":
    case "addSheet":
    case "addMissingSheet":
    case "addMissingSection":
    case "duplicateSheet":
    case "deleteSheet":
    case "moveSheet":
    case "tickSheet":
    case "tickAllSheets":
    case "setSheet":
    case "renameSheet":
    case "setSheetDrawing":
    case "setSheetSection":
    case "toggleSheetPane":
    case "frameSheet":
    case "typeReport":
    case "leaveReport":
      return onSheetListUi(state, action, host);
    case "importUnderlay":
    case "removeUnderlay":
    case "setUnderlayFade":
    case "toggleUnderlay":
      return onUnderlayUi(state, action, host);
    case "importLogo":
    case "removeLogo":
      return onLogoUi(state, action, host);
    case "toggle3d":
    case "set3dSize":
    case "turn3d":
    case "orbit3d":
    case "reset3d":
    case "toggleRoof3d":
      return { state: onView3dUi(state, action), effects: [] };
    case "showSection":
    case "closeSection":
    case "setSectionMarks":
      return { state: onSectionUi(state, action), effects: [] };
    case "setDockHeight":
    case "resetDockHeight":
    case "toggleLargerDock":
    case "setDockShare":
    case "swapFrames":
      return { state: { ...state, frames: framesAfter(state.frames, action) }, effects: [] };
    case "undo":
    case "redo":
      return undoRedo(state, action.type, host);
    case "selectEntity":
    case "selectHole":
    case "hoverHole":
    case "deleteSelection":
    case "duplicate":
    case "breakApart":
    case "split":
    case "setField":
    case "setWallThickness":
    case "setColumnSize":
      return onSelectionUi(state, action, host);
    case "setSnapStep":
      return { state: { ...state, snapSettings: { ...state.snapSettings, step: action.step } }, effects: [] };
    case "setViewedLevel": // ignored while a value is typed, as Page Up and Page Down are
      return { state: typingValue(state) ? state : viewLevel(state, action.deck), effects: [] };
    case "setActiveState":
    case "addState":
    case "renameState":
    case "deleteState":
      return onStateUi(state, action, host);
    case "createProject":
    case "openProject":
    case "showProjectList":
    case "deleteProject":
    case "cardSeen":
    case "cardHover":
    case "cardOrbit":
    case "cardNextLayout":
    case "setCardOrder":
      return onWorkspaceUi(state, action, host);
    default:
      return assertNever(action);
  }
}
