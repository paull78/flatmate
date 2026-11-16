import type { EditorState } from "../state";
import type { Field } from "../view/view-model-types";

// Which finish row is open in Properties (inherit step 04, AC-07): one at a time, for the selection it was opened for,
// so selecting something else closes it; Esc closes it before anything else (keys.ts).

const selectionKey = (state: EditorState): string => state.selection.map((r) => `${r.table}:${r.id}`).join(",");

/** The open row's id, or null when none is open for this selection. */
export function openFinishId(state: EditorState): string | null {
  const open = state.openFinish;
  return open !== null && open.selection === selectionKey(state) ? open.id : null;
}

/** Opens the row for this selection, whichever was open. */
export function openFinishRow(state: EditorState, id: string): EditorState {
  return { ...state, openFinish: { id, selection: selectionKey(state) } };
}

/** Opens the row, or closes it when it is the open one. */
export function toggleFinish(state: EditorState, id: string): EditorState {
  return { ...state, openFinish: openFinishId(state) === id ? null : { id, selection: selectionKey(state) } };
}

/** The state with no open row once the selection it was opened for has changed: going back doesn't reopen it. */
export function closeFinishOnSelection(state: EditorState): EditorState {
  return state.openFinish !== null && openFinishId(state) === null ? { ...state, openFinish: null } : state;
}

/** The fields with each summary row marked open or closed; the shell hides a closed row's fields. */
export function withOpenFinish(fields: readonly Field[], open: string | null): Field[] {
  return fields.map((f) => (f.finish ? { ...f, finish: { ...f.finish, open: f.id === open } } : f));
}
