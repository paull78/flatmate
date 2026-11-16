import { assertNever } from "@fm/protocol";
import { breakApartSelection } from "./break-apart";
import { duplicateSelection } from "./duplicate";
import { deleteSelection } from "./keys";
import type { UiAction } from "./ports/events";
import type { Host } from "./ports/host";
import { setField, setWallThickness } from "./properties/edit";
import { pruneSelection, type EditorState, type Step } from "./state";
import { pickTool, selectHole } from "./levels";
import { setColumnSize } from "./tools/column-tool";
import { canCommit, visibleDoc } from "./document/open-document";
import { blockedMessage } from "./commit";
import { showToast } from "./toast";

// The UiActions that act on the selection and its Properties, moved out of update.ts's onUi (straight step 04,
// straight.25) so new selection actions have room.

export type SelectionUiAction = Extract<UiAction, { type: "selectEntity" | "selectHole" | "hoverHole" | "deleteSelection" | "duplicate" | "breakApart" | "split" | "setField" | "setWallThickness" | "setColumnSize" }>;

/** Runs a selection or Properties action. */
export function onSelectionUi(state: EditorState, action: SelectionUiAction, host: Host): Step {
  switch (action.type) {
    case "selectEntity":
      return { state: pruneSelection({ ...pickTool(state, "select"), selection: [action.ref] }), effects: [] };
    case "selectHole":
      return { state: selectHole(state, action.id), effects: [] };
    case "hoverHole":
      return { state: { ...state, hover: action.id === null ? null : { table: "deckHoles", id: action.id } }, effects: [] };
    case "deleteSelection":
      return deleteSelection(state, host);
    case "duplicate":
      return duplicateSelection(state, host);
    case "breakApart":
      return breakApartSelection(state, host);
    case "split":
      return armSplit(state, host);
    case "setField":
      return setField(state, action.fieldId, action.value, host);
    case "setWallThickness":
      return setWallThickness(state, action.value, host);
    case "setColumnSize":
      return setColumnSize(state, action.width, action.depth, host);
    default:
      return assertNever(action);
  }
}

/** Split (straight step 15): arms the gesture on the one selected wall; blocked while an edit is in flight, as Duplicate is. */
function armSplit(state: EditorState, host: Host): Step {
  const ref = state.selection[0];
  const open = state.document;
  const doc = open ? visibleDoc(open) : null;
  if (!open || !doc || !ref || ref.table !== "walls" || state.selection.length !== 1 || doc.walls[ref.id]?.column) return { state, effects: [] };
  if (!canCommit(open)) return showToast(state, blockedMessage(open), host);
  return { state: { ...state, tool: { name: "select", state: { kind: "splitting", wallId: ref.id, tick: null, value: "" } } }, effects: [] };
}
