import { describe, expect, it } from "vitest";
import { dividedRoomDoc } from "./builders";
import { FakeShell } from "./fake-shell";
import { PERF } from "./perf-switch";

// The core tsconfig has no DOM or Node lib; vitest runs in Node, where `performance` is a global.
declare const performance: { now(): number };

const WARM_UP = 20;
const MOVES = 200;

describe.skipIf(!PERF)("scene rebuild cost (gate 3 question), with FM_PERF=1", () => {
  // Core cost only: update + scene + ViewModel per move, text measured by the core's font tables (render.15).
  // Canvas2D drawing is the web shell's and is not timed here.
  it("handles 200 pointer moves with a live wall preview on the sample document", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("w");
    shell.click({ x: 1, y: 1 });
    const seen = new Set<string>();
    const move = (i: number): void => {
      shell.moveTo({ x: 1 + (i % 40) * 0.1, y: 2.5 }); // valid and invalid previews
      const tool = shell.state.tool;
      seen.add(tool.name === "wall" && tool.state.kind === "drawing" && tool.state.preview ? String(tool.state.preview.ok) : "none");
    };
    for (let i = 0; i < WARM_UP; i++) move(i); // JIT warm-up, not measured
    const start = performance.now();
    for (let i = 0; i < MOVES; i++) move(i);
    const perMove = (performance.now() - start) / MOVES;
    expect(seen).toEqual(new Set(["true", "false"])); // every move had a live preview, both valid and red
    expect(perMove).toBeLessThan(16); // one 60 Hz frame; the gate report records the measured duration
  });
});
