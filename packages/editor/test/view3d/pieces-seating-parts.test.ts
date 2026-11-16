import { describe, expect, it } from "vitest";
import type { Part } from "../../src/view3d/parts/types";
import { PARTS_KINDS, partsOf, type Size } from "./parts-fixtures";

// The stool, bar table, bench and storage chest in 3D (spec pieces, AC-05; the mock-up, pieces.07). The every-kind
// rules run on them through PARTS_KINDS. Local frame: x across, y from the front (−d/2) to the back (d/2), z up.

const size = (w: number, d: number, h: number): Size => ({ config: "standard", w, d, h, label: `${w}×${d}×${h}` });
const rangeOf = (p: Part): [number, number] => (p.shape === "outline" || p.shape === "ring" ? [p.z0, p.z1] : [p.at.z0, p.at.z1]);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("the seating and storage pieces in 3D", () => {
  it("are checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toEqual(expect.arrayContaining(["stool", "barTable", "bench", "storageChest"]));
  });

  it("a stool is a foot, a post and a round wood seat at its top", () => {
    const ps = partsOf("stool", size(0.4, 0.4, 0.75));
    expect(ps.map((p) => p.shape)).toEqual(["cylinder", "cylinder", "outline"]);
    expect(ps.some((p) => p.slot === "wood" && near(rangeOf(p)[1], 0.75))).toBe(true);
    expect(ps.some((p) => near(rangeOf(p)[0], 0))).toBe(true);
  });

  it("a bar table has a wood top at its height and a footrest bar low between its front legs; a wall ledge is a top on two brackets", () => {
    const ps = partsOf("barTable", size(1.2, 0.6, 1.05));
    expect(ps.some((p) => p.slot === "wood" && near(rangeOf(p)[1], 1.05))).toBe(true);
    expect(ps.some((p) => p.shape === "box" && p.at.z0 > 0.15 && p.at.z1 < 0.4 && p.at.x1 - p.at.x0 > 0.6)).toBe(true);
    const ledge = partsOf("barTable", size(1.2, 0.3, 0.05));
    expect(ledge.filter((p) => p.slot === "metal")).toHaveLength(2);
    expect(ledge.some((p) => p.slot === "wood" && near(rangeOf(p)[1], 0.05))).toBe(true);
  });

  it("a bench is a wood box with fabric cushions on top, one per about 0.60 m", () => {
    const cushions = (w: number) => partsOf("bench", size(w, 0.45, 0.45)).filter((p) => p.slot === "fabric");
    expect(cushions(1.2)).toHaveLength(2);
    expect(cushions(0.6)).toHaveLength(1);
  });

  it("a storage chest is a wood body under a lid, with a handle on its front", () => {
    const ps = partsOf("storageChest", size(0.8, 0.45, 0.5));
    expect(ps.filter((p) => p.shape === "box" && p.slot === "wood")).toHaveLength(2);
    expect(ps.flatMap((p) => p.panels ?? []).some((q) => q.normal === "-y")).toBe(true);
  });
});
