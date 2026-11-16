import { UNDERLAY_ID, underlayRect } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { boxInView, frameBox, screenToWorld } from "./camera";
import { runCommand } from "./commit";
import { canCommit, visibleDoc } from "./document/open-document";
import type { UiAction, UnderlayImport } from "./ports/events";
import { followCamera } from "./pointer";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { idleTool } from "./tools/types";
import type { ViewModel } from "./view/view-model-types";

// The plan underlay's UI (import.06, .15, .16): an import places the picture fresh at the view's top-left as one put,
// replacing any picture, then frames it in the importing view if it doesn't fit (furnish.07); Remove deletes it. Fade and show/hide are this viewer's settings, outside the document and
// history, so they are never synced or undone.

/** Room left around a framed picture: it clears the floating bar at the canvas's top centre. */
export const FRAME_MARGIN_PX = 48;

type UnderlayUi = Extract<UiAction, { type: "importUnderlay" | "removeUnderlay" | "setUnderlayFade" | "toggleUnderlay" }>;

/** The toast for each import refusal (AC-13), chosen by the reason: each names the types the browser can decode. */
export const UNDERLAY_REFUSALS: Readonly<Record<Extract<UnderlayImport, { ok: false }>["reason"], string>> = {
  unsupported: "Not a picture: use a PNG, JPEG, WebP or GIF (export a PDF page as an image)",
  unreadable: "Couldn't read this picture: use a PNG, JPEG, WebP or GIF",
  tooLarge: "This picture is too detailed to fit: crop it or use a smaller PNG, JPEG, WebP or GIF",
};

export function onUnderlayUi(state: EditorState, action: UnderlayUi, host: Host): Step {
  switch (action.type) {
    case "importUnderlay":
      return importUnderlay(resetScale(state), action.result, host);
    case "removeUnderlay": {
      const out = runCommand(resetScale(state), { type: "removeUnderlay" }, host);
      return { state: out.state, effects: out.effects };
    }
    case "setUnderlayFade": {
      if (!Number.isFinite(action.fade)) return { state, effects: [] };
      const fade = Math.min(1, Math.max(0, action.fade));
      return { state: { ...state, underlayView: { ...state.underlayView, fade } }, effects: [] };
    }
    case "toggleUnderlay":
      return { state: { ...state, underlayView: { ...state.underlayView, visible: !state.underlayView.visible } }, effects: [] };
    default:
      return assertNever(action);
  }
}

/**
 * With no drawing open there is nothing to import into, so even a refusal is ignored. The action carries no project
 * id: an import that finishes after a switch lands in the drawing then open (accepted for now). The domain sets
 * the provisional scale and `scaled: false`. A committed picture shows even if the last one was hidden (AC-01).
 * Only this local action frames the picture: remote puts, Undo and Redo leave the camera alone (furnish.07).
 */
function importUnderlay(state: EditorState, result: UnderlayImport, host: Host): Step {
  if (!state.document) return { state, effects: [] };
  if (!result.ok) return showToast(state, UNDERLAY_REFUSALS[result.reason], host);
  const at = screenToWorld(state.camera, { x: 0, y: 0 });
  const pictureId = host.newId();
  const out = runCommand(state, { type: "placeUnderlay", pictureId, data: result.data, width: result.width, height: result.height, at }, host);
  if (out.committed === null || !out.state.document) return { state: out.state, effects: out.effects };
  const shown: EditorState = { ...out.state, underlayView: { ...out.state.underlayView, visible: true } };
  // `committed` can be set when the document refused the commit (commit.ts): frame only if the new picture is there.
  const doc = visibleDoc(out.state.document);
  const rect = underlayRect(doc);
  if (doc.underlays[UNDERLAY_ID]?.pictureId !== pictureId || !rect || boxInView(shown.camera, rect)) return { state: shown, effects: out.effects };
  const framed = followCamera({ ...shown, camera: frameBox(shown.camera, rect, FRAME_MARGIN_PX) }, host);
  return { state: framed.state, effects: [...out.effects, ...framed.effects] };
}

/** A local import or remove, refused or not, drops a half-done scale: its points lie in the old picture's frame. */
function resetScale(state: EditorState): EditorState {
  return state.tool.name === "scale" ? { ...state, tool: idleTool("scale") } : state;
}

/** The Underlay section, shown with nothing selected like the Project section. Never the picture: React gets every view. */
export function underlaySection(state: EditorState): ViewModel["underlay"] {
  const d = state.document;
  if (!d || state.selection.length > 0) return null;
  const { fade, visible } = state.underlayView;
  return { present: visibleDoc(d).underlays[UNDERLAY_ID] !== undefined, canEdit: canCommit(d), fade, visible };
}
