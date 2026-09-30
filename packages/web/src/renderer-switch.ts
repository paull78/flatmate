import type { Renderer } from "./adapters/renderer";

// Shell-only renderer choice (spec §1.4 step 10, §6): the editor never knows which renderer draws its Scene.

export type RendererKind = "canvas2d" | "webgl";
export type RendererChoice = { kind: RendererKind; notice: string | null };

export type RendererFactories = {
  canvas2d(): Renderer;
  /** null when WebGL2 is unavailable. `onLost` is called from the context-lost event, never during creation. */
  webgl(onLost: () => void): Renderer | null;
};

export type RendererSwitch = {
  getChoice(): RendererChoice;
  subscribe(fn: () => void): () => void;
  /** Canvas2D ↔ WebGL. While attached, the new renderer replaces the old one at once. */
  toggle(): void;
  /**
   * Creates the chosen renderer (Canvas2D when WebGL fails) and hands it, and every later one, to `apply`.
   * Returns a function that disposes the current renderer and stops.
   */
  attach(factories: RendererFactories, apply: (renderer: Renderer) => void): () => void;
};

export const WEBGL_UNAVAILABLE = "WebGL2 is unavailable: drawing with Canvas2D";
export const WEBGL_LOST = "WebGL context lost: drawing with Canvas2D";

/** `?renderer=webgl` starts with WebGL; anything else starts with Canvas2D, so the demo never depends on WebGL. */
export function rendererFrom(search: string): RendererKind {
  return new URLSearchParams(search).get("renderer")?.trim().toLowerCase() === "webgl" ? "webgl" : "canvas2d";
}

/** `?sdf=debug` makes the WebGL renderer show its distance field (spec §6.2, "SDF debug view"). */
export function sdfDebugFrom(search: string): boolean {
  return new URLSearchParams(search).get("sdf")?.trim().toLowerCase() === "debug";
}

type Created ={ renderer: Renderer; choice: RendererChoice };
type Attached = { factories: RendererFactories; apply(renderer: Renderer): void; current: Renderer };

export function createRendererSwitch(initial: RendererKind): RendererSwitch {
  let choice: RendererChoice = { kind: initial, notice: null };
  let attached: Attached | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: RendererChoice): void => {
    choice = next;
    for (const fn of listeners) fn();
  };

  const create = (factories: RendererFactories, kind: RendererKind): Created => {
    if (kind === "webgl") {
      const gl: Renderer | null = factories.webgl(() => lost(gl));
      if (gl !== null) return { renderer: gl, choice: { kind: "webgl", notice: null } };
      return { renderer: factories.canvas2d(), choice: { kind: "canvas2d", notice: WEBGL_UNAVAILABLE } };
    }
    return { renderer: factories.canvas2d(), choice: { kind: "canvas2d", notice: null } };
  };

  const install = (next: Created): void => {
    if (attached === null) return;
    attached.current.dispose();
    attached.current = next.renderer;
    attached.apply(next.renderer);
    publish(next.choice);
  };

  /** Only the renderer currently drawing may trigger the fallback; a stale one was already disposed. */
  const lost = (renderer: Renderer | null): void => {
    if (attached === null || renderer === null || attached.current !== renderer) return;
    install({ renderer: attached.factories.canvas2d(), choice: { kind: "canvas2d", notice: WEBGL_LOST } });
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
      const kind: RendererKind = choice.kind === "webgl" ? "canvas2d" : "webgl";
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
