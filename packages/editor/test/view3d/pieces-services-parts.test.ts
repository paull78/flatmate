import { describe, expect, it } from "vitest";
import type { Part } from "../../src/view3d/parts/types";
import { PARTS_KINDS, partsOf, type Size } from "./parts-fixtures";

// The wall unit and the electric fireplace in 3D (spec pieces, AC-05; pieces.07). The every-kind rules run on them
// through PARTS_KINDS. Local frame: x across, y from the front (−d/2) to the back (d/2), z up from the bottom.

const size = (w: number, d: number, h: number): Size => ({ config: "standard", w, d, h, label: `${w}×${d}×${h}` });
const boxes = (parts: readonly Part[]) => parts.flatMap((p) => (p.shape === "box" ? [p] : []));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("the wall unit and fireplace in 3D", () => {
  it("are checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toEqual(expect.arrayContaining(["wallUnit", "electricFireplace"]));
  });

  it("a wall unit is a white body with a dark vent along the bottom of its front", () => {
    const ps = boxes(partsOf("wallUnit", size(0.8, 0.2, 0.28)));
    expect(ps.some((b) => b.slot === "dark" && near(b.at.y0, -0.1) && near(b.at.z0, 0))).toBe(true);
    expect(ps.some((b) => b.slot === "laminate")).toBe(true);
  });

  it("an electric fireplace is a dark body with flames in its window: tongues of uneven height over a glowing ember strip (pieces.20)", () => {
    const ps = partsOf("electricFireplace", size(1, 0.2, 0.55));
    expect(boxes(ps).every((b) => b.slot === "dark")).toBe(true);
    const front = ps.flatMap((p) => p.panels ?? []).filter((q) => q.normal === "-y");
    const flames = front.filter((q) => q.slot === "flame");
    expect(flames.length).toBeGreaterThanOrEqual(5); // one per about 0.15 m of window
    expect(new Set(flames.map((q) => Math.round((q.at.z1 - q.at.z0) * 1000))).size).toBeGreaterThan(1); // uneven
    const embers = front.filter((q) => q.slot === "linen" && q.at.x1 - q.at.x0 > 0.8); // the strip across the window
    expect(embers).toHaveLength(1);
    // Each tongue tapers: its steps narrow as they rise, so it reads as a flame, not a bar.
    const tongue = flames.filter((q) => Math.abs((q.at.x0 + q.at.x1) / 2 - (flames[0] ? (flames[0].at.x0 + flames[0].at.x1) / 2 : 0)) < 1e-9).sort((a, b) => a.at.z0 - b.at.z0);
    expect(tongue.length).toBe(4);
    expect(tongue.map((q) => q.at.x1 - q.at.x0)).toEqual([...tongue.map((q) => q.at.x1 - q.at.x0)].sort((a, b) => b - a));
    expect(flames.every((q) => q.at.z0 >= (embers[0]?.at.z1 ?? 1) - 1e-9)).toBe(true); // the tongues rise from the embers
  });
});
