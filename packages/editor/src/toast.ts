import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";

export const TOAST_MS = 3000;
export const TOAST_TIMER = "toast";

export function showToast(state: EditorState, text: string, host: Host): Step {
  return {
    state: { ...state, toast: { text, until: host.now() + TOAST_MS } },
    effects: [{ type: "startTimer", timerId: TOAST_TIMER, ms: TOAST_MS }],
  };
}

/** A late timer from an earlier toast leaves a newer toast alone; an early one is re-armed. */
export function onToastTimer(state: EditorState, host: Host): Step {
  if (!state.toast) return { state, effects: [] };
  const left = state.toast.until - host.now();
  if (left <= 0) return { state: { ...state, toast: null }, effects: [] };
  return { state, effects: [{ type: "startTimer", timerId: TOAST_TIMER, ms: left }] };
}
