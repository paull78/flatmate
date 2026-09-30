import type { Scene } from "@fm/editor";

// Shell-only speed readout (spec §6.3): `?perf` times the editor's update per event and the renderer's frame.

export const PERF_WINDOW = 120; // samples kept per kind

export type PerfStats = { avg: number; max: number; count: number };
export type PerfSummary = { update: PerfStats | null; draw: PerfStats | null; primitives: number | null };

export type PerfMeter = {
  update(ms: number): void;
  draw(ms: number, primitives: number): void;
  summary(): PerfSummary;
};

export function perfFrom(search: string): boolean {
  return new URLSearchParams(search).has("perf");
}

export function primitiveCount(scene: Scene): number {
  return scene.layers.reduce((n, layer) => n + layer.primitives.length, 0);
}

export function createPerfMeter(): PerfMeter {
  const updates: number[] = [];
  const draws: number[] = [];
  let primitives: number | null = null;
  const push = (samples: number[], ms: number): void => {
    samples.push(ms);
    if (samples.length > PERF_WINDOW) samples.shift();
  };
  const stats = (samples: number[]): PerfStats | null =>
    samples.length === 0
      ? null
      : { avg: samples.reduce((a, b) => a + b, 0) / samples.length, max: Math.max(...samples), count: samples.length };
  return {
    update: (ms) => push(updates, ms),
    draw(ms, count) {
      push(draws, ms);
      primitives = count;
    },
    summary: () => ({ update: stats(updates), draw: stats(draws), primitives }),
  };
}
