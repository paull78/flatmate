import { describe, expect, it } from "vitest";
import { appearanceOf } from "../../src/view3d/parts";
import type { Part } from "../../src/view3d/parts/types";

// The glass cabinets in 3D (the user's request after hangings): a white carcass with shelves; doors as frames whose
// panes stay open, so the shelves and what stands on them show through (no transparency, as the sheer, hangings.13);
// the Half-glass cabinet's doors solid below. One door at 40 cm, two at 80.

const [D, H] = [0.3, 2.02];
const parts = (kind: string, w: number): readonly Part[] => appearanceOf(kind)("standard", w, D, H);
const boxes = (ps: readonly Part[]) => ps.flatMap((p) => (p.shape === "box" ? [p] : []));
/** The parts in the doors' layer at the front. */
const front = (ps: readonly Part[]) => boxes(ps).filter((b) => b.at.y0 === -D / 2);
const covers = (ps: readonly Part[], x: number, z: number) => front(ps).some((b) => b.at.x0 <= x && x <= b.at.x1 && b.at.z0 <= z && z <= b.at.z1);
/** The doors' upright stiles: tall and narrow, in the front layer. */
const stiles = (ps: readonly Part[]) => front(ps).filter((b) => b.at.z1 - b.at.z0 > 0.8 * H && b.at.x1 - b.at.x0 < 0.1);

describe("the glass cabinets in 3D", () => {
  it.each(["glassCabinet", "halfGlassCabinet"])("%s: one door at 40, two at 80", (kind) => {
    expect(stiles(parts(kind, 0.4))).toHaveLength(2);
    expect(stiles(parts(kind, 0.8))).toHaveLength(4);
  });

  it("a Glass cabinet's panes are open top to bottom, and behind them stand shelves, books low and things to show higher up", () => {
    const ps = parts("glassCabinet", 0.8);
    for (const z of [0.4, 1, 1.6]) expect(covers(ps, -0.2, z), `z ${z}`).toBe(false);
    const inside = boxes(ps).filter((b) => b.at.y0 > -D / 2 && b.at.x1 - b.at.x0 < 0.7 && b.at.z1 - b.at.z0 > 0.05);
    expect(inside.filter((b) => (b.panels ?? []).length > 0 && b.at.z1 < H / 2).length).toBeGreaterThanOrEqual(1); // books, spines on
    expect(inside.filter((b) => b.at.z0 > H / 2).length).toBeGreaterThanOrEqual(2); // vases and boxes
  });

  it("a Half-glass cabinet's doors are solid below their middle and open above", () => {
    const ps = parts("halfGlassCabinet", 0.8);
    expect(covers(ps, -0.2, 0.5)).toBe(true);
    expect(covers(ps, -0.2, 1.6)).toBe(false);
  });

  it("each door has a knob near its meeting edge", () => {
    const knobs = front(parts("glassCabinet", 0.8)).flatMap((b) => (b.panels ?? []).filter((p) => p.slot === "metal"));
    expect(knobs).toHaveLength(2);
  });
});
