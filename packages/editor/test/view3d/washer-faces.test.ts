import { describe, expect, it } from "vitest";
import { appearanceOf } from "../../src/view3d/parts";
import type { Part } from "../../src/view3d/parts/types";
import { ownFaces } from "../../src/view3d/own-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, PieceItem } from "../../src/view3d/types";

// The washing machine in 3D (hangings, the user's review): a white body, a control strip with a drawer, a dial and a
// display, and a round door (a silver ring round dark glass); its Washer-dryer preset (1.70 tall) a washer under a
// dryer on a stacking strip, each with its own controls and door.

const parts = (h: number): readonly Part[] => appearanceOf("washingMachine")("standard", 0.6, 0.6, h);
const boxes = (ps: readonly Part[]) => ps.flatMap((p) => (p.shape === "box" ? [p] : []));
function item(h: number, selected = false): PieceItem {
  const ring = [{ x: -0.3, y: -0.3 }, { x: 0.3, y: -0.3 }, { x: 0.3, y: 0.3 }, { x: -0.3, y: 0.3 }];
  return { item: "piece", placement: "p", object: "o", objectKind: "washingMachine", config: "standard", ring, centre: { x: 0, y: 0 }, rotation: 0, w: 0.6, d: 0.6, bottom: 0, top: h, selected };
}
const faces = (h: number, selected = false): Face3d[] => ownFaces("piece/p", item(h, selected), STYLE_3D) ?? [];
const metal = (f: Face3d) => Object.values(STYLE_3D.slots.metal).includes(f.color);
const dark = (f: Face3d) => Object.values(STYLE_3D.slots.dark).includes(f.color);
/** The round glass windows: dark faces of 32 points. */
const windows = (fs: readonly Face3d[]) => fs.filter((f) => dark(f) && f.points.length === 32);

describe("the washing machine in 3D (the user's review)", () => {
  it("a white body with a control strip at the top front: a drawer, a dial and a dark display", () => {
    const strips = boxes(parts(0.85)).filter((b) => b.at.y0 === -0.3);
    expect(strips).toHaveLength(1);
    const strip = strips[0];
    expect(strip?.at.z1).toBe(0.85);
    expect(strip?.slot).toBe("laminate");
    expect((strip?.panels ?? []).map((p) => p.slot).sort()).toEqual(["dark", "metal", "plain"]);
  });

  it("a round door: a silver ring round dark glass, in front, inside the box", () => {
    const fs = faces(0.85);
    const glass = windows(fs);
    expect(glass).toHaveLength(1);
    const ring = fs.filter((f) => metal(f) && f.points.length === 4 && f.points.every((p) => Math.abs(p.y + 0.3) < 1e-9));
    expect(ring.length).toBeGreaterThanOrEqual(32);
    for (const p of [...glass, ...ring].flatMap((f) => f.points)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-0.3 - 1e-9);
      expect(p.z).toBeGreaterThanOrEqual(-1e-9);
      expect(p.z).toBeLessThanOrEqual(0.85 + 1e-9);
    }
  });

  it("the Washer-dryer preset (1.70): two machines on a dark stacking strip, each with its controls and its door", () => {
    expect(boxes(parts(1.7)).filter((b) => b.at.y0 === -0.3)).toHaveLength(2);
    expect(boxes(parts(1.7)).some((b) => b.slot === "dark" && b.at.z0 < 0.85 && b.at.z1 > 0.85)).toBe(true);
    const glass = windows(faces(1.7));
    expect(glass).toHaveLength(2);
    const zs = glass.map((g) => g.points.reduce((s, p) => s + p.z, 0) / g.points.length).sort((a, b) => a - b);
    expect(zs[0] ?? 1).toBeLessThan(0.85);
    expect(zs[1] ?? 0).toBeGreaterThan(0.85);
  });

  it("selected, the door turns the selection's blue too", () => {
    expect(windows(faces(0.85, true))).toHaveLength(0);
    expect(faces(0.85, true).every((f) => Object.values(STYLE_3D.selected).includes(f.color))).toBe(true);
  });
});
