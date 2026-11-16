import type { Scene } from "@fm/editor";

// Shell-only speed readout (spec: rendering): `?perf` times the editor's update per event, the renderer's frame, the interval
// between drawn frames and the 3D view's draw (graphics step 01).

export const PERF_WINDOW = 120; // samples kept per kind

/** A row's samples: the average, the median (what the speed targets read, real3d.07), the worst, and how many. */
export type PerfStats = { avg: number; median: number; max: number; count: number };
export type PerfSummary = {
  update: PerfStats | null;
  draw: PerfStats | null;
  frame: PerfStats | null; // ms between two drawn frames
  draw3d: PerfStats | null;
  primitives: number | null;
};

export type PerfMeter = {
  update(ms: number): void;
  draw(ms: number, primitives: number): void;
  /** A frame was drawn at `atMs` (performance.now): records the interval since the previous one. */
  frame(atMs: number): void;
  draw3d(ms: number): void;
  /** Forgets every sample, so the next gesture is measured alone. */
  reset(): void;
  summary(): PerfSummary;
};

/** What a script reads under `?perf`: `window.__fmPerf` (the perf spec, graphics step 02). */
export type PerfHook = { reset(): void; summary(): PerfSummary };

/** Puts the meter's reset and summary on `target.__fmPerf`. */
export function exposePerf(target: object, meter: PerfMeter): void {
  const hook: PerfHook = { reset: () => meter.reset(), summary: () => meter.summary() };
  Object.defineProperty(target, "__fmPerf", { value: hook, configurable: true });
}

export function perfFrom(search: string): boolean {
  return new URLSearchParams(search).has("perf");
}

export function primitiveCount(scene: Scene): number {
  return scene.layers.reduce((n, layer) => n + layer.primitives.length, 0);
}

/** The middle sample, or the mean of the middle two. */
function median(samples: readonly number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export function createPerfMeter(): PerfMeter {
  const updates: number[] = [];
  const draws: number[] = [];
  const frames: number[] = [];
  const draws3d: number[] = [];
  let primitives: number | null = null;
  let lastFrame: number | null = null;
  const push = (samples: number[], ms: number): void => {
    samples.push(ms);
    if (samples.length > PERF_WINDOW) samples.shift();
  };
  const stats = (samples: number[]): PerfStats | null =>
    samples.length === 0
      ? null
      : { avg: samples.reduce((a, b) => a + b, 0) / samples.length, median: median(samples), max: Math.max(...samples), count: samples.length };
  return {
    update: (ms) => push(updates, ms),
    draw(ms, count) {
      push(draws, ms);
      primitives = count;
    },
    frame(atMs) {
      if (lastFrame !== null) push(frames, atMs - lastFrame);
      lastFrame = atMs;
    },
    draw3d: (ms) => push(draws3d, ms),
    reset() {
      for (const samples of [updates, draws, frames, draws3d]) samples.length = 0;
      primitives = null;
      lastFrame = null;
    },
    summary: () => ({ update: stats(updates), draw: stats(draws), frame: stats(frames), draw3d: stats(draws3d), primitives }),
  };
}
