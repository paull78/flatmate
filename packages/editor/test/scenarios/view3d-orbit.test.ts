import { describe, expect, it } from "vitest";
import { roomDoc } from "../builders";
import { FakeShell } from "../fake-shell";

// Orbiting the 3D view (real3d.04, AC-01 to AC-04): the panel forwards pointer deltas in pixels; the editor turns them
// into degrees, 0.4° a pixel: right lowers the yaw (the model's near side follows the hand, real3d.26), down raises the tilt,
// held to 10°…90°. [ and ] and the header turn 90° from wherever the yaw is; a double-click resets. Per viewer only.

function opened(): FakeShell {
  const shell = FakeShell.withDocument(roomDoc());
  shell.key("3");
  return shell;
}

const angles = (shell: FakeShell) => ({ yaw: shell.state.view3d.yaw, tilt: shell.state.view3d.tilt });

describe("orbiting the 3D view", () => {
  it("100 px right turns the yaw by 40° and keeps the tilt; 100 px down raises the tilt by 40°, 100 px up lowers it (AC-01)", () => {
    const shell = opened();
    shell.ui({ type: "orbit3d", dx: 100, dy: 0 });
    expect(angles(shell)).toEqual({ yaw: 185, tilt: 35 });
    shell.ui({ type: "orbit3d", dx: 0, dy: 100 });
    expect(angles(shell)).toEqual({ yaw: 185, tilt: 75 });
    shell.ui({ type: "orbit3d", dx: 0, dy: -100 });
    expect(angles(shell)).toEqual({ yaw: 185, tilt: 35 });
    shell.ui({ type: "orbit3d", dx: 500, dy: 0 }); // the yaw wraps round
    expect(angles(shell).yaw).toBeCloseTo(345, 9);
  });

  it("the tilt never leaves 10°…90°, whatever the drags; the yaw stays in 0°…360° (AC-01)", () => {
    const shell = opened();
    let seed = 5;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      shell.ui({ type: "orbit3d", dx: (random() - 0.5) * 800, dy: (random() - 0.5) * 800 });
      const { yaw, tilt } = angles(shell);
      expect(tilt).toBeGreaterThanOrEqual(10);
      expect(tilt).toBeLessThanOrEqual(90);
      expect(yaw).toBeGreaterThanOrEqual(0);
      expect(yaw).toBeLessThan(360);
    }
    shell.ui({ type: "orbit3d", dx: 0, dy: -10_000 });
    expect(angles(shell).tilt).toBe(10);
    shell.ui({ type: "orbit3d", dx: 0, dy: 10_000 });
    expect(angles(shell).tilt).toBe(90);
  });

  it("] and [ and the turn buttons turn the yaw by 90° from an orbited angle and keep the tilt (AC-02)", () => {
    const shell = opened();
    shell.ui({ type: "orbit3d", dx: 37, dy: 20 }); // yaw 239.8, tilt 43
    const { yaw, tilt } = angles(shell);
    shell.key("]");
    expect(angles(shell).yaw).toBeCloseTo((yaw + 90) % 360, 9);
    shell.key("[");
    shell.key("[");
    expect(angles(shell).yaw).toBeCloseTo((yaw - 90 + 360) % 360, 9);
    shell.ui({ type: "turn3d", by: 1 });
    expect(angles(shell).yaw).toBeCloseTo(yaw, 9);
    expect(angles(shell).tilt).toBe(tilt);
  });

  it("reset3d goes back to the south-west, 35° down, from any angles (AC-03)", () => {
    const shell = opened();
    shell.ui({ type: "orbit3d", dx: 123, dy: 77 });
    shell.ui({ type: "reset3d" });
    expect(angles(shell)).toEqual({ yaw: 225, tilt: 35 });
  });

  it("a yaw summed from many 0.4° steps reads back clean", () => {
    const shell = opened();
    for (let i = 0; i < 15; i++) shell.ui({ type: "orbit3d", dx: 10, dy: 0 });
    expect(angles(shell).yaw).toBe(165);
  });

  it("orbiting sends no edit, leaves undo alone and touches no other viewer (AC-04)", () => {
    const shell = opened();
    const other = opened();
    const undo = shell.state.undo;
    const document = shell.state.document;
    const before = shell.effects.length;
    shell.ui({ type: "orbit3d", dx: 50, dy: 30 });
    shell.ui({ type: "reset3d" });
    shell.ui({ type: "orbit3d", dx: -20, dy: 0 });
    expect(shell.effects.slice(before).length).toBeGreaterThan(0);
    expect(shell.effects.slice(before).every((e) => e.type === "render")).toBe(true);
    expect(shell.state.undo).toBe(undo);
    expect(shell.state.document).toBe(document);
    expect(angles(other)).toEqual({ yaw: 225, tilt: 35 });
  });
});
