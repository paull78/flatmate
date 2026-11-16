import { assertNever } from "@fm/protocol";
import type { UiAction } from "./ports/events";
import { pruneSelection, type EditorState } from "./state";

type UnderPointerAction = Extract<UiAction, { type: "pickUnderPointer" | "hoverUnderPointer" | "closeUnderPointer" }>;

export const isUnderPointerAction = (action: UiAction): action is UnderPointerAction =>
  action.type === "pickUnderPointer" || action.type === "hoverUnderPointer" || action.type === "closeUnderPointer";

/** A row of the right-click list picked or hovered, or the list closed (AC-06). */
export function underPointerAction(state: EditorState, action: UnderPointerAction): EditorState {
  switch (action.type) {
    case "pickUnderPointer":
      return pruneSelection({ ...state, selection: [action.ref], underPointer: null });
    case "hoverUnderPointer":
      return state.underPointer ? { ...state, underPointer: { ...state.underPointer, hovered: action.ref } } : state;
    case "closeUnderPointer":
      return { ...state, underPointer: null };
    default:
      return assertNever(action);
  }
}
