import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialState, type Host, type Scene } from "@fm/editor";
import { PerfPanel } from "../src/panels/PerfPanel";
import { PERF_WINDOW, createPerfMeter, exposePerf, perfFrom, primitiveCount, type PerfSummary } from "../src/perf";
import { createEditorStore } from "../src/store";

const host: Host = {
  now: () => 0,
  today: () => "2026-10-13",
  newId: () => "id",
};

const EMPTY: PerfSummary = { update: null, draw: null, frame: null, draw3d: null, primitives: null };

describe("?perf (spec: rendering)", () => {
  it("is on only with ?perf", () => {
    expect(perfFrom("?perf")).toBe(true);
    expect(perfFrom("?renderer=webgl&perf=1")).toBe(true);
    expect(perfFrom("")).toBe(false);
    expect(perfFrom("?renderer=webgl")).toBe(false);
  });

  it("reports average and worst of the last 120 samples per kind, and the last primitive count", () => {
    const meter = createPerfMeter();
    expect(meter.summary()).toEqual({ update: null, draw: null, frame: null, draw3d: null, primitives: null });
    meter.update(1000); // pushed out of the window below
    for (let i = 0; i < PERF_WINDOW; i++) meter.update(i % 2 === 0 ? 2 : 4);
    meter.draw(5, 10);
    meter.draw(7, 12);
    expect(meter.summary()).toEqual({
      update: { avg: 3, median: 3, max: 4, count: PERF_WINDOW },
      draw: { avg: 6, median: 6, max: 7, count: 2 },
      frame: null,
      draw3d: null,
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
      underlay: null,
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
      <PerfPanel summary={{ update: { avg: 1.234, median: 1.234, max: 5.6, count: 120 }, draw: { avg: 2.5, median: 2.5, max: 9, count: 60 }, frame: null, draw3d: null, primitives: 12345 }} renderer="webgl" open3d={false} />,
    );
    expect(html).toContain('data-testid="perf"');
    expect(html).toContain("update 1.2 ms avg · 1.2 median · 5.6 max");
    expect(html).toContain("draw (WebGL, waits for the GPU) 2.5 ms avg · 2.5 median · 9.0 max");
    expect(html).toContain("12,345 primitives");
    const empty = renderToStaticMarkup(<PerfPanel summary={EMPTY} renderer="canvas2d" open3d={false} />);
    expect(empty).toContain("update – · draw (Canvas2D) –");
    const webgpu = renderToStaticMarkup(<PerfPanel summary={EMPTY} renderer="webgpu" open3d={false} />);
    expect(webgpu).toContain("draw (WebGPU, waits for the GPU) –"); // webgpu.10
  });

  it("frame records the intervals between drawn frames, none after a reset (graphics step 01)", () => {
    const meter = createPerfMeter();
    meter.frame(0);
    meter.frame(16);
    meter.frame(40);
    expect(meter.summary().frame).toEqual({ avg: 20, median: 20, max: 24, count: 2 });
    meter.reset();
    meter.frame(100);
    expect(meter.summary().frame).toBeNull();
    meter.frame(116);
    expect(meter.summary().frame).toEqual({ avg: 16, median: 16, max: 16, count: 1 });
  });

  it("the median is the middle sample, or the mean of the middle two (real3d.07)", () => {
    const meter = createPerfMeter();
    for (const ms of [5, 1, 3, 2, 4]) meter.draw3d(ms);
    expect(meter.summary().draw3d?.median).toBe(3);
    meter.draw3d(100); // an outlier moves the average, not the median much
    expect(meter.summary().draw3d?.median).toBe(3.5);
    expect(meter.summary().draw3d?.avg).toBeCloseTo(115 / 6, 9);
  });

  it("draw3d keeps its own window of 120 samples", () => {
    const meter = createPerfMeter();
    for (let i = 0; i < PERF_WINDOW + 10; i++) meter.draw3d(3);
    expect(meter.summary().draw3d).toEqual({ avg: 3, median: 3, max: 3, count: PERF_WINDOW });
    expect(meter.summary().draw).toBeNull();
  });

  it("reset clears every row", () => {
    const meter = createPerfMeter();
    meter.update(1);
    meter.draw(2, 10);
    meter.frame(0);
    meter.frame(16);
    meter.draw3d(4);
    meter.reset();
    expect(meter.summary()).toEqual(EMPTY);
  });

  it("the panel shows the frame row, and the 3D row only while the 3D view is open", () => {
    const summary: PerfSummary = { ...EMPTY, frame: { avg: 16.7, median: 16.7, max: 33.4, count: 10 }, draw3d: { avg: 918.25, median: 918.25, max: 950, count: 3 } };
    const closed = renderToStaticMarkup(<PerfPanel summary={summary} renderer="canvas2d" open3d={false} />);
    expect(closed).toContain("frame 16.7 ms avg · 16.7 median · 33.4 max");
    expect(closed).not.toContain("3D");
    const open = renderToStaticMarkup(<PerfPanel summary={summary} renderer="canvas2d" open3d={true} />);
    expect(open).toContain("3D 918.3 ms avg · 918.3 median · 950.0 max (3 draws)");
    const noDraws = renderToStaticMarkup(<PerfPanel summary={EMPTY} renderer="canvas2d" open3d={true} />);
    expect(noDraws).toContain("3D – (0 draws)");
  });

  it("exposes reset and summary on the target as __fmPerf", () => {
    const meter = createPerfMeter();
    const target = {};
    exposePerf(target, meter);
    meter.update(5);
    const hook: unknown = Reflect.get(target, "__fmPerf");
    if (typeof hook !== "object" || hook === null) throw new Error("no hook");
    const summary: unknown = Reflect.get(hook, "summary");
    const reset: unknown = Reflect.get(hook, "reset");
    if (typeof summary !== "function" || typeof reset !== "function") throw new Error("hook shape");
    expect(summary()).toMatchObject({ update: { avg: 5, median: 5, max: 5, count: 1 } });
    reset();
    expect(summary()).toEqual(EMPTY);
  });
});
