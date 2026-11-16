import type { Renderer } from "./adapters/renderer";

// Shell-only renderer choice (docs/try-it.md step 10, spec: rendering): the editor never knows which renderer draws its Scene.

export type RendererKind = "canvas2d" | "webgl" | "webgpu";
export type RendererChoice = { kind: RendererKind; notice: string | null };

/** What the chip and the perf panel call each renderer (webgpu.10). */
export const RENDERER_NAME: Readonly<Record<RendererKind, string>> = { canvas2d: "Canvas2D", webgl: "WebGL", webgpu: "WebGPU" };

export type RendererFactories = {
  canvas2d(): Renderer;
  /** null when WebGL2 is unavailable. `onLost` is called from the context-lost event, never during creation. */
  webgl(onLost: () => void): Renderer | null;
  /**
   * null when WebGPU is unavailable or its device was lost (it isn't reacquired). `onLost` runs from `device.lost`, in a
   * later microtask, never during creation. The list tries it only when the URL asks for WebGPU (webgpu.06).
   */
  webgpu(onLost: () => void): Renderer | null;
};

export type RendererSwitch = {
  getChoice(): RendererChoice;
  subscribe(fn: () => void): () => void;
  /** Canvas2D ↔ the first GPU renderer that works. While attached, the new renderer replaces the old one at once. */
  toggle(): void;
  /**
   * Creates the chosen renderer (the next in the list when it fails) and hands it, and every later one, to `apply`.
   * Returns a function that disposes the current renderer and stops.
   */
  attach(factories: RendererFactories, apply: (renderer: Renderer) => void): () => void;
};

export const WEBGL_UNAVAILABLE = "WebGL2 is unavailable: drawing with Canvas2D";
export const WEBGL_LOST = "WebGL context lost: drawing with Canvas2D";
export const WEBGPU_UNAVAILABLE = "WebGPU is unavailable: drawing with WebGL2";
export const WEBGPU_LOST = "WebGPU device lost: drawing with WebGL2";

/** `?renderer=webgl` or `webgpu` starts on that GPU renderer; anything else starts with Canvas2D, so the app never depends on a GPU. */
export function rendererFrom(search: string): RendererKind {
  const asked = new URLSearchParams(search).get("renderer")?.trim().toLowerCase();
  return asked === "webgl" || asked === "webgpu" ? asked : "canvas2d";
}

/** `?sdf=debug` makes the WebGL renderer show its distance field (spec: rendering, "SDF debug view"). */
export function sdfDebugFrom(search: string): boolean {
  return new URLSearchParams(search).get("sdf")?.trim().toLowerCase() === "debug";
}

/** One renderer in the fallback order, and what the notice says when it can't start or is lost. */
type Entry = { kind: RendererKind; create(factories: RendererFactories, onLost: () => void): Renderer | null; unavailable: string | null; lost: string | null };

const ENTRIES: Readonly<Record<RendererKind, Entry>> = {
  webgpu: { kind: "webgpu", create: (f, onLost) => f.webgpu(onLost), unavailable: WEBGPU_UNAVAILABLE, lost: WEBGPU_LOST },
  webgl: { kind: "webgl", create: (f, onLost) => f.webgl(onLost), unavailable: WEBGL_UNAVAILABLE, lost: WEBGL_LOST },
  canvas2d: { kind: "canvas2d", create: (f) => f.canvas2d(), unavailable: null, lost: null },
};

type Created = { renderer: Renderer; choice: RendererChoice };
type Attached = { factories: RendererFactories; apply(renderer: Renderer): void; current: Renderer };

/**
 * The renderer switch (webgpu.10): an ordered list, WebGPU (when the URL asks for it), WebGL, Canvas2D. A renderer
 * starts at the first entry that works, a loss moves to the entries after the lost one, and the toggle goes Canvas2D ↔
 * the first GPU entry that works.
 */
export function createRendererSwitch(initial: RendererKind): RendererSwitch {
  const order: readonly Entry[] = initial === "webgpu" ? [ENTRIES.webgpu, ENTRIES.webgl, ENTRIES.canvas2d] : [ENTRIES.webgl, ENTRIES.canvas2d];
  let choice: RendererChoice = { kind: initial, notice: null };
  let attached: Attached | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: RendererChoice): void => {
    choice = next;
    for (const fn of listeners) fn();
  };

  /**
   * The first entry from `from` on that creates a renderer. The notice names the step that happened: `notice` (a loss)
   * when that entry works at once, else the last skipped entry's ("… drawing with Canvas2D" when WebGL fails too).
   */
  const firstFrom = (factories: RendererFactories, from: number, notice: string | null): Created => {
    let said = notice;
    for (const entry of order.slice(from)) {
      const made: Renderer | null = entry.create(factories, () => lost(entry, made));
      if (made !== null) return { renderer: made, choice: { kind: entry.kind, notice: said } };
      said = entry.unavailable;
    }
    return { renderer: factories.canvas2d(), choice: { kind: "canvas2d", notice: said } }; // Canvas2D always works
  };

  const create = (factories: RendererFactories, kind: RendererKind): Created =>
    kind === "canvas2d" ? firstFrom(factories, order.indexOf(ENTRIES.canvas2d), null) : firstFrom(factories, 0, null);

  const install = (next: Created): void => {
    if (attached === null) return;
    attached.current.dispose();
    attached.current = next.renderer;
    attached.apply(next.renderer);
    publish(next.choice);
  };

  /** Only the renderer currently drawing may trigger the fallback; a stale one was already disposed. */
  const lost = (entry: Entry, renderer: Renderer | null): void => {
    if (attached === null || renderer === null || attached.current !== renderer) return;
    install(firstFrom(attached.factories, order.indexOf(entry) + 1, entry.lost));
  };

  return {
    getChoice: () => choice,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    toggle() {
      const kind: RendererKind = choice.kind === "canvas2d" ? (order[0]?.kind ?? "webgl") : "canvas2d";
      if (attached === null) publish({ kind, notice: null });
      else install(create(attached.factories, kind));
    },
    attach(factories, apply) {
      const first = create(factories, choice.kind);
      attached = { factories, apply, current: first.renderer };
      apply(first.renderer);
      publish(first.choice);
      return () => {
        attached?.current.dispose();
        attached = null;
      };
    },
  };
}
