import { describe, expect, it } from "vitest";
import { partSolids } from "../../src/view3d/parts/solids";
import { ownFaces } from "../../src/view3d/own-faces";
import { STYLE_3D } from "../../src/view3d/style";
import { tapFaces } from "../../src/view3d/tap-faces";
import type { Face3d, PieceItem } from "../../src/view3d/types";

// The kitchen sink's and the bathtub's taps in 3D (showcase, the user's review): faces of the piece's own over its
// parts, standing on its top (the worktop, the tub's rim) and so above its height, inside its footprint.

function piece(objectKind: string, w: number, d: number, h: number, selected = false): PieceItem {
  const ring = [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }];
  return { item: "piece", placement: "p", object: "o", objectKind, config: "standard", ring, centre: { x: 0, y: 0 }, rotation: 0, w, d, bottom: 0, top: h, selected };
}
const sink = piece("sinkUnit", 0.8, 0.6, 0.9);
const tub = piece("bathtub", 1.7, 0.75, 0.75);
/** The tap's faces: those after the parts' (a panel on the top stands a hair proud of it, so heights don't tell them apart). */
const over = (item: PieceItem): Face3d[] => (tapFaces("piece/p", item, STYLE_3D) ?? []).slice(partSolids("piece/p", item, STYLE_3D).flatMap((p) => p.faces).length);
const zs = (fs: Face3d[]) => fs.flatMap((f) => f.points.map((p) => p.z));
const metal = (f: Face3d) => Object.values(STYLE_3D.slots.metal).includes(f.color);

describe("taps (the user's review)", () => {
  it("draws nothing of its own for another kind", () => {
    expect(tapFaces("piece/p", piece("counter", 0.6, 0.6, 0.9), STYLE_3D)).toBeNull();
    expect(tapFaces("piece/p", piece("toilet", 0.4, 0.65, 0.9), STYLE_3D)).toBeNull();
  });

  it("keeps the piece's parts and adds the tap's faces, all owned by the piece", () => {
    for (const item of [sink, tub]) {
      const parts = partSolids("piece/p", item, STYLE_3D).flatMap((p) => p.faces).length;
      const all = tapFaces("piece/p", item, STYLE_3D) ?? [];
      expect(all.length).toBeGreaterThan(parts);
      expect(all.length - parts).toBeLessThan(40);
      expect(new Set(all.map((f) => f.owner))).toEqual(new Set(["piece/p"]));
    }
  });

  it("a kitchen sink's tap is metal, stands on the worktop behind the bowl and reaches over it, at most 0.30 m high", () => {
    const tap = over(sink);
    expect(tap.length).toBeGreaterThan(0);
    expect(tap.every(metal)).toBe(true);
    expect(Math.min(...zs(tap))).toBeCloseTo(0.9, 9);
    expect(Math.max(...zs(tap))).toBeGreaterThan(1.1);
    expect(Math.max(...zs(tap))).toBeLessThanOrEqual(1.2 + 1e-9);
    const ys = tap.flatMap((f) => f.points.map((p) => p.y));
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.3); // inside the footprint, at the back
    expect(Math.max(...ys)).toBeGreaterThan(0.18); // behind the bowl (0.36 deep)
    expect(Math.min(...ys)).toBeLessThan(0.1); // the spout reaches over the bowl
    expect(Math.min(...ys)).toBeGreaterThan(-0.18);
  });

  it("a bathtub's tap stands on the foot rim (−x, as the plan's), at most 0.10 m over it, its spout over the water", () => {
    const tap = over(tub);
    expect(tap.length).toBeGreaterThan(0);
    expect(tap.every(metal)).toBe(true);
    expect(Math.max(...zs(tap))).toBeLessThanOrEqual(0.85 + 1e-9);
    const xs = tap.flatMap((f) => f.points.map((p) => p.x));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.85);
    expect(Math.min(...xs)).toBeLessThan(-0.78); // on the rim (0.07)
    expect(Math.max(...xs)).toBeGreaterThan(-0.78); // past the rim, over the basin
    expect(Math.max(...xs)).toBeLessThan(-0.6);
  });

  it("shrinks with a small piece, and takes the selection's colour", () => {
    const small = piece("sinkUnit", 0.3, 0.3, 0.4);
    const pts = over(small).flatMap((f) => f.points);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.15);
      expect(p.z).toBeLessThanOrEqual(0.4 + 0.3 * 0.4 + 1e-9);
    }
    const sel = over(piece("sinkUnit", 0.8, 0.6, 0.9, true));
    expect(sel.every((f) => Object.values(STYLE_3D.selected).includes(f.color))).toBe(true);
  });

  it("is what the 3D view draws for both kinds", () => {
    expect(ownFaces("piece/p", sink, STYLE_3D)).toEqual(tapFaces("piece/p", sink, STYLE_3D));
    expect(ownFaces("piece/p", tub, STYLE_3D)).toEqual(tapFaces("piece/p", tub, STYLE_3D));
  });
});
