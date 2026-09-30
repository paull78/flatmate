import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialState, type Host, type Scene } from "@fm/editor";
import { PerfPanel } from "../src/panels/PerfPanel";
import { PERF_WINDOW, createPerfMeter, perfFrom, primitiveCount } from "../src/perf";
import { createEditorStore } from "../src/store";

const host: Host = {
  textMetrics: (text, font) => ({ width: text.length * font.size * 0.6, ascent: font.size * 0.8, descent: font.size * 0.2 }),
  now: () => 0,
  newId: () => "id",
};

describe("?perf (spec §6.3)", () => {
  it("is on only with ?perf", () => {
    expect(perfFrom("?perf")).toBe(true);
    expect(perfFrom("?renderer=webgl&perf=1")).toBe(true);
    expect(perfFrom("")).toBe(false);
    expect(perfFrom("?renderer=webgl")).toBe(false);
  });

  it("reports average and worst of the last 120 samples per kind, and the last primitive count", () => {
    const meter = createPerfMeter();
    expect(meter.summary()).toEqual({ update: null, draw: null, primitives: null });
    meter.update(1000); // pushed out of the window below
    for (let i = 0; i < PERF_WINDOW; i++) meter.update(i % 2 === 0 ? 2 : 4);
    meter.draw(5, 10);
    meter.draw(7, 12);
    expect(meter.summary()).toEqual({
      update: { avg: 3, max: 4, count: PERF_WINDOW },
      draw: { avg: 6, max: 7, count: 2 },
      primitives: 12,
    });
  });

  it("counts a Scene's primitives across layers", () => {
    const scene: Scene = {
      layers: [
        { name: "grid", primitives: [{ kind: "disc", center: { x: 0, y: 0 }, radius: { px: 1 }, color: "#000000" }] },
        { name: "walls", primitives: [] },
        { name: "annotations", primitives: [
          { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 1 }, color: "#000000" },
          { kind: "disc", center: { x: 1, y: 0 }, radius: { px: 1 }, color: "#000000" },
        ] },
      ],
    };
    expect(primitiveCount(scene)).toBe(3);
  });

  it("the store times each update when given a meter", () => {
    const meter = createPerfMeter();
    const initial = initialState({ mode: "local", me: { clientId: "c1", name: "Alice" }, viewport: { width: 800, height: 600 }, dpr: 1 }, host);
    const store = createEditorStore({ initial, host, onUpdate: meter.update });
    store.dispatch({ type: "key", key: "w", mods: { shift: false, ctrl: false, alt: false, meta: false } });
    store.dispatch({ type: "key", key: "v", mods: { shift: false, ctrl: false, alt: false, meta: false } });
    const update = meter.summary().update;
    expect(update?.count).toBe(2);
    expect(update?.max).toBeGreaterThanOrEqual(0);
  });

  it("the panel shows update, draw with the renderer, and the primitive count", () => {
    const html = renderToStaticMarkup(
      <PerfPanel summary={{ update: { avg: 1.234, max: 5.6, count: 120 }, draw: { avg: 2.5, max: 9, count: 60 }, primitives: 12345 }} renderer="webgl" />,
    );
    expect(html).toContain('data-testid="perf"');
    expect(html).toContain("update 1.2 ms avg · 5.6 max");
    expect(html).toContain("draw (WebGL, waits for the GPU) 2.5 ms avg · 9.0 max");
    expect(html).toContain("12,345 primitives");
    const empty = renderToStaticMarkup(<PerfPanel summary={{ update: null, draw: null, primitives: null }} renderer="canvas2d" />);
    expect(empty).toContain("update – · draw (Canvas2D) –");
  });
});
