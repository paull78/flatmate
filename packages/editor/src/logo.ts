import { LOGO_ID } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { runCommand } from "./commit";
import { canCommit, visibleDoc } from "./document/open-document";
import type { UiAction } from "./ports/events";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { UNDERLAY_REFUSALS } from "./underlay";
import type { ViewModel } from "./view/view-model-types";

// The studio's logo (sheetset.21), chosen from Project in Properties. It reads like the underlay's import (import.15),
// with nothing for the camera to do, as it never shows on the plan.

type LogoUi = Extract<UiAction, { type: "importLogo" | "removeLogo" }>;

export function onLogoUi(state: EditorState, action: LogoUi, host: Host): Step {
  switch (action.type) {
    case "importLogo": {
      const { result } = action;
      if (!state.document) return { state, effects: [] };
      if (!result.ok) return showToast(state, UNDERLAY_REFUSALS[result.reason], host);
      const out = runCommand(state, { type: "setLogo", data: result.data, width: result.width, height: result.height }, host);
      return { state: out.state, effects: out.effects };
    }
    case "removeLogo": {
      const out = runCommand(state, { type: "removeLogo" }, host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(action);
  }
}

/** With nothing selected, as the Project fields it sits beside. */
export function logoSection(state: EditorState): ViewModel["logo"] {
  const d = state.document;
  if (!d || state.selection.length > 0) return null;
  return { present: visibleDoc(d).logos[LOGO_ID] !== undefined, canEdit: canCommit(d) };
}
