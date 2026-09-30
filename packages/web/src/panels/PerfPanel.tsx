import type { PerfStats, PerfSummary } from "../perf";
import type { RendererKind } from "../renderer-switch";

const ms = (s: PerfStats | null): string => (s === null ? "–" : `${s.avg.toFixed(1)} ms avg · ${s.max.toFixed(1)} max`);

/** The `?perf` readout (spec §6.3): last 120 samples of update and draw, and the Scene's size. */
export function PerfPanel({ summary, renderer }: { summary: PerfSummary; renderer: RendererKind }) {
  const draw = renderer === "webgl" ? "draw (WebGL, waits for the GPU)" : "draw (Canvas2D)";
  const primitives = summary.primitives === null ? "" : ` · ${summary.primitives.toLocaleString("en-US")} primitives`;
  return (
    <div className="perf-panel" data-testid="perf">
      update {ms(summary.update)} · {draw} {ms(summary.draw)}
      {primitives}
    </div>
  );
}
