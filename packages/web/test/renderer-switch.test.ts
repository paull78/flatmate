import { describe, expect, it } from "vitest";
import type { Renderer } from "../src/adapters/renderer";
import {
  WEBGL_LOST,
  WEBGL_UNAVAILABLE,
  createRendererSwitch,
  rendererFrom,
  sdfDebugFrom,
  type RendererFactories,
  type RendererKind,
} from "../src/renderer-switch";

type FakeRenderer = Renderer & { name: string; disposed: boolean };

function fakes(webglAvailable = true) {
  const made: FakeRenderer[] = [];
  const applied: string[] = [];
  let loseContext: (() => void) | null = null;
  const make = (name: string): FakeRenderer => {
    const r: FakeRenderer = {
      name,
      disposed: false,
      render: () => {},
      dispose: () => {
        r.disposed = true;
      },
    };
    made.push(r);
    return r;
  };
  const factories: RendererFactories = {
    canvas2d: () => make(`canvas2d#${made.length}`),
    webgl: (onLost) => {
      if (!webglAvailable) return null;
      loseContext = onLost;
      return make(`webgl#${made.length}`);
    },
  };
  const apply = (r: Renderer): void => {
    const found = made.find((m) => m === r);
    applied.push(found?.name ?? "unknown");
  };
  return { made, applied, factories, apply, lose: () => loseContext?.() };
}

function attached(kind: RendererKind, webglAvailable = true) {
  const f = fakes(webglAvailable);
  const sw = createRendererSwitch(kind);
  let notified = 0;
  sw.subscribe(() => {
    notified += 1;
  });
  const detach = sw.attach(f.factories, f.apply);
  return { ...f, sw, detach, notified: () => notified };
}

describe("rendererFrom", () => {
  it("reads ?renderer=webgl, case-insensitively", () => {
    expect(rendererFrom("?renderer=webgl")).toBe("webgl");
    expect(rendererFrom("?name=Alice&renderer=WebGL")).toBe("webgl");
  });

  it("defaults to Canvas2D for anything else", () => {
    expect(rendererFrom("")).toBe("canvas2d");
    expect(rendererFrom("?renderer=canvas2d")).toBe("canvas2d");
    expect(rendererFrom("?renderer=gl")).toBe("canvas2d");
  });
});

describe("sdfDebugFrom", () => {
  it("is on only for ?sdf=debug, trimmed and case-insensitive", () => {
    expect(sdfDebugFrom("?sdf=debug")).toBe(true);
    expect(sdfDebugFrom("?name=Alice&sdf=DEBUG ")).toBe(true);
    expect(sdfDebugFrom("")).toBe(false);
    expect(sdfDebugFrom("?sdf=")).toBe(false);
    expect(sdfDebugFrom("?sdf=on")).toBe(false);
  });
});

describe("renderer switch", () => {
  it("starts with the chosen renderer and hands it to apply", () => {
    const c = attached("canvas2d");
    expect(c.applied).toEqual(["canvas2d#0"]);
    expect(c.sw.getChoice()).toEqual({ kind: "canvas2d", notice: null });
    const w = attached("webgl");
    expect(w.applied).toEqual(["webgl#0"]);
    expect(w.sw.getChoice()).toEqual({ kind: "webgl", notice: null });
  });

  it("falls back to Canvas2D with a notice when WebGL2 is unavailable", () => {
    const h = attached("webgl", false);
    expect(h.applied).toEqual(["canvas2d#0"]);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_UNAVAILABLE });
  });

  it("toggles: disposes the old renderer, applies the new one and notifies", () => {
    const h = attached("canvas2d");
    const before = h.notified();
    h.sw.toggle();
    expect(h.applied).toEqual(["canvas2d#0", "webgl#1"]);
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.sw.getChoice()).toEqual({ kind: "webgl", notice: null });
    expect(h.notified()).toBe(before + 1);
    h.sw.toggle();
    expect(h.applied).toEqual(["canvas2d#0", "webgl#1", "canvas2d#2"]);
    expect(h.made[1]?.disposed).toBe(true);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: null });
  });

  it("stays on Canvas2D with a notice when a toggle to WebGL fails", () => {
    const h = attached("canvas2d", false);
    h.sw.toggle();
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_UNAVAILABLE });
    expect(h.applied).toEqual(["canvas2d#0", "canvas2d#1"]);
  });

  it("falls back to Canvas2D when the WebGL context is lost", () => {
    const h = attached("webgl");
    h.lose();
    expect(h.applied).toEqual(["webgl#0", "canvas2d#1"]);
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_LOST });
  });

  it("ignores a context loss from a renderer that is no longer drawing", () => {
    const h = attached("webgl");
    h.sw.toggle(); // back to Canvas2D; the WebGL renderer is disposed
    h.lose();
    expect(h.applied).toEqual(["webgl#0", "canvas2d#1"]);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: null });
  });

  it("before attach, a toggle only records the choice", () => {
    const f = fakes();
    const sw = createRendererSwitch("canvas2d");
    sw.toggle();
    expect(sw.getChoice()).toEqual({ kind: "webgl", notice: null });
    sw.attach(f.factories, f.apply);
    expect(f.applied).toEqual(["webgl#0"]);
  });

  it("detach disposes the current renderer; later toggles apply nothing", () => {
    const h = attached("canvas2d");
    h.detach();
    expect(h.made[0]?.disposed).toBe(true);
    h.sw.toggle();
    expect(h.applied).toEqual(["canvas2d#0"]);
    expect(h.sw.getChoice().kind).toBe("webgl");
  });

  it("keeps the same choice object until it changes (useSyncExternalStore)", () => {
    const h = attached("canvas2d");
    expect(h.sw.getChoice()).toBe(h.sw.getChoice());
  });
});
