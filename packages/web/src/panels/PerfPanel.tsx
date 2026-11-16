import type { PerfStats, PerfSummary } from "../perf";
import { RENDERER_NAME, type RendererKind } from "../renderer-switch";

const ms = (s: PerfStats | null): string => (s === null ? "–" : `${s.avg.toFixed(1)} ms avg · ${s.median.toFixed(1)} median · ${s.max.toFixed(1)} max`);

/**
 * The `?perf` readout (spec: rendering): last 120 samples of update, draw and the frame interval, the Scene's size, and the 3D
 * view's draws while it is open (graphics step 01).
 */
export function PerfPanel({ summary, renderer, open3d }: { summary: PerfSummary; renderer: RendererKind; open3d: boolean }) {
  const draw = renderer === "canvas2d" ? "draw (Canvas2D)" : `draw (${RENDERER_NAME[renderer]}, waits for the GPU)`;
  const primitives = summary.primitives === null ? "" : ` · ${summary.primitives.toLocaleString("en-US")} primitives`;
  return (
    <div className="perf-panel" data-testid="perf">
      update {ms(summary.update)} · {draw} {ms(summary.draw)}
      {primitives} · frame {ms(summary.frame)}
      {open3d ? ` · 3D ${ms(summary.draw3d)} (${summary.draw3d?.count ?? 0} draws)` : null}
    </div>
  );
}
