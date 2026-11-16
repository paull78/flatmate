import { describe, expect, it } from "vitest";
import type { Renderer } from "../src/adapters/renderer";
import {
  WEBGL_LOST,
  WEBGL_UNAVAILABLE,
  WEBGPU_LOST,
  WEBGPU_UNAVAILABLE,
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
    webgpu: () => {
      throw new Error("the list offers WebGPU only for ?renderer=webgpu");
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

/** Factories with a WebGPU entry whose device can be lost (webgpu.10). */
function gpuFakes(opts: { webgpu: boolean; webgl: boolean }) {
  const made: string[] = [];
  const losers: Record<string, () => void> = {};
  let gpuLost = false;
  const make = (name: string): Renderer => {
    made.push(name);
    return { render: () => {}, dispose: () => {} };
  };
  const factories: RendererFactories = {
    canvas2d: () => make("canvas2d"),
    webgl: (onLost) => {
      if (!opts.webgl) return null;
      losers.webgl = onLost;
      return make("webgl");
    },
    webgpu: (onLost) => {
      if (!opts.webgpu || gpuLost) return null; // a lost device is not reacquired
      losers.webgpu = () => {
        gpuLost = true;
        onLost();
      };
      return make("webgpu");
    },
  };
  const sw = createRendererSwitch("webgpu");
  sw.attach(factories, () => {});
  return { sw, made, lose: (kind: "webgpu" | "webgl") => losers[kind]?.() };
}

describe("the renderer list with WebGPU (webgpu.10, AC-04, AC-05)", () => {
  it("reads ?renderer=webgpu", () => {
    expect(rendererFrom("?renderer=WebGPU")).toBe("webgpu");
  });

  it("creates the first entry that works", () => {
    expect(gpuFakes({ webgpu: true, webgl: true }).sw.getChoice()).toEqual({ kind: "webgpu", notice: null });
    expect(gpuFakes({ webgpu: false, webgl: true }).sw.getChoice()).toEqual({ kind: "webgl", notice: WEBGPU_UNAVAILABLE });
    expect(gpuFakes({ webgpu: false, webgl: false }).sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_UNAVAILABLE });
  });

  it("a loss moves to the next entry with the lost entry's notice", () => {
    const h = gpuFakes({ webgpu: true, webgl: true });
    h.lose("webgpu");
    expect(h.sw.getChoice()).toEqual({ kind: "webgl", notice: WEBGPU_LOST });
    h.lose("webgl");
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_LOST });
    expect(h.made).toEqual(["webgpu", "webgl", "canvas2d"]);
  });

  it("the toggle goes Canvas2D ↔ the first working GPU entry: WebGL after a WebGPU loss", () => {
    const h = gpuFakes({ webgpu: true, webgl: true });
    h.sw.toggle();
    expect(h.sw.getChoice().kind).toBe("canvas2d");
    h.sw.toggle();
    expect(h.sw.getChoice()).toEqual({ kind: "webgpu", notice: null });
    h.lose("webgpu");
    h.sw.toggle();
    h.sw.toggle();
    expect(h.sw.getChoice()).toEqual({ kind: "webgl", notice: WEBGPU_UNAVAILABLE });
  });

  it("without ?renderer=webgpu the list has no WebGPU entry", () => {
    const h = attached("canvas2d");
    h.sw.toggle();
    expect(h.sw.getChoice().kind).toBe("webgl");
  });
});
