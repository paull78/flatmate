import type { Event as EditorEvent } from "@fm/editor";

export type Frames = {
  /** One animation frame, then a `frame` event; requests before it fires share it. */
  request(): void;
  dispose(): void;
};

/**
 * The `requestFrame` effect (spec: layouts): the editor animates a flip from frame events and asks for each next one.
 * The frame's time comes from requestAnimationFrame, on the same clock as the Host's `now` (performance.now).
 */
export function createFrames(
  dispatch: (e: EditorEvent) => void,
  raf: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): Frames {
  let pending: number | null = null;
  return {
    request() {
      if (pending !== null) return;
      pending = raf((t) => {
        pending = null;
        dispatch({ type: "frame", now: t });
      });
    },
    dispose() {
      if (pending !== null) caf(pending);
      pending = null;
    },
  };
}
