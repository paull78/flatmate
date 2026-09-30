import type { Event as EditorEvent } from "@fm/editor";

export type Timers = {
  start(id: string, ms: number): void;
  cancel(id: string): void;
  dispose(): void;
};

/** startTimer / cancelTimer effects → setTimeout; expiry comes back as a timerFired event (spec §5.2). */
export function createTimers(dispatch: (e: EditorEvent) => void): Timers {
  const handles = new Map<string, ReturnType<typeof setTimeout>>();

  function cancel(id: string): void {
    const handle = handles.get(id);
    if (handle === undefined) return;
    clearTimeout(handle);
    handles.delete(id);
  }

  return {
    start(id, ms) {
      cancel(id);
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id);
          dispatch({ type: "timerFired", timerId: id });
        }, ms),
      );
    },
    cancel,
    dispose() {
      for (const handle of handles.values()) clearTimeout(handle);
      handles.clear();
    },
  };
}
