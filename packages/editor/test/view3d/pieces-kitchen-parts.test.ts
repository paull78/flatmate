import { describe, expect, it } from "vitest";
import type { Part } from "../../src/view3d/parts/types";
import { PARTS_KINDS, partsOf, type Size } from "./parts-fixtures";

// The range, cooker hood and tall pantry in 3D (spec pieces, AC-05; the mock-up, pieces.07). The every-kind rules
// (inside the shape and range, filling the box, no overlaps) run on them through PARTS_KINDS.
// Local frame: x across, y from the front (−d/2) to the back (d/2), z up from the bottom.

const size = (w: number, d: number, h: number): Size => ({ config: "standard", w, d, h, label: `${w}×${d}×${h}` });
const boxes = (parts: readonly Part[]) => parts.flatMap((p) => (p.shape === "box" ? [p] : []));
const panels = (parts: readonly Part[]) => parts.flatMap((p) => p.panels ?? []);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("the kitchen pieces in 3D", () => {
  it("are checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toEqual(expect.arrayContaining(["range", "cookerHood", "tallPantry"]));
  });

  it("a range shows four rings on its top and a dark oven door on its front", () => {
    const ps = partsOf("range", size(0.6, 0.6, 0.9));
    expect(panels(ps).filter((q) => q.normal === "+z" && q.slot === "dark")).toHaveLength(4);
    const door = boxes(ps).find((b) => b.slot === "dark" && near(b.at.y0, -0.3) && b.at.z1 - b.at.z0 > 0.3);
    expect(door).toBeDefined();
  });

  it("a chimney hood is a canopy across its width (behind a dark lip) and a chimney at the back reaching its top; a slim one only the canopy", () => {
    const chimney = (h: number) => boxes(partsOf("cookerHood", size(0.6, 0.5, h))).filter((b) => near(b.at.z1, h) && b.at.x1 - b.at.x0 < 0.6 - 1e-9 && near(b.at.y1, 0.25));
    const canopy = (h: number) => boxes(partsOf("cookerHood", size(0.6, 0.5, h))).filter((b) => b.slot === "metal" && near(b.at.z0, 0) && near(b.at.x0, -0.3) && near(b.at.x1, 0.3));
    expect(chimney(0.9)).toHaveLength(1);
    expect(canopy(0.9)).toHaveLength(1);
    expect(chimney(0.15).filter((b) => b.at.x1 - b.at.x0 < 0.5)).toHaveLength(0);
    expect(canopy(0.15)).toHaveLength(1);
  });

  it("a tall pantry has a door per 0.50 m, full height: two at 0.80, one at 0.60", () => {
    const doors = (w: number) => boxes(partsOf("tallPantry", size(w, 0.6, 2.1))).filter((b) => near(b.at.y0, -0.3) && b.at.z1 - b.at.z0 > 1.5);
    expect(doors(0.8)).toHaveLength(2);
    expect(doors(0.6)).toHaveLength(1);
  });
});
