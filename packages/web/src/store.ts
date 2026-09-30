import {
  buildViewModel,
  update,
  type EditorState,
  type Effect,
  type Event as EditorEvent,
  type Host,
  type ViewModel,
} from "@fm/editor";

export type EditorStore = {
  dispatch(e: EditorEvent): void;
  getView(): ViewModel;
  getState(): EditorState;
  publishView(view: ViewModel): void;
  subscribe(fn: () => void): () => void;
  setRunner(run: (effects: Effect[]) => void): void;
};

/** Holds the editor state; the shell's only mutable copy of it. */
/** `onUpdate` receives the time of each `update` call in ms (the `?perf` readout, spec §6.3). */
export function createEditorStore(opts: { initial: EditorState; host: Host; onUpdate?: (ms: number) => void }): EditorStore {
  let state = opts.initial;
  let view = buildViewModel(state, opts.host);
  let run: (effects: Effect[]) => void = () => {};
  const listeners = new Set<() => void>();
  const queue: EditorEvent[] = [];
  let draining = false;

  function dispatch(e: EditorEvent): void {
    queue.push(e);
    if (draining) return; // dispatched by an effect: the loop below handles it after the current batch
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const started = opts.onUpdate ? performance.now() : 0;
        const result = update(state, next, opts.host);
        opts.onUpdate?.(performance.now() - started);
        state = result.state;
        run(result.effects);
      }
    } catch (error) {
      queue.length = 0; // fail fast: never replay events queued behind a failed update
      throw error;
    } finally {
      draining = false;
    }
  }

  return {
    dispatch,
    getView: () => view,
    getState: () => state,
    publishView(next) {
      view = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setRunner(next) {
      run = next;
    },
  };
}
