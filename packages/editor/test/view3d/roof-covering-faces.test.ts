import { describe, expect, it } from "vitest";
import { CEILING_ID, motifDefaults, type Ceiling, type Document, type Finish } from "@fm/domain";
import { roofFaces } from "../../src/view3d/roof-faces";
import { STYLE_3D, finishShades } from "../../src/view3d/style";
import type { Face3d } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { normal } from "./visible";

// The roof's covering in 3D (surfaces step 12, AC-06): the slab's top and edges in the covering, its pattern laid from
// the eave along it and up the slope; the underside stays slate. roomDoc's box is 6.2 × 4.2 with a 0.30 m overhang.

const roofed = (c: Omit<Ceiling, "id">): Document => ({ ...roomDoc(), ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const gable = (covering?: Finish): Document => roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3, ...(covering ? { covering } : {}) });
const tops = (faces: readonly Face3d[]) => faces.filter((f) => f.outline !== false && normal(f.points).z > 0.5);
const unders = (faces: readonly Face3d[]) => faces.filter((f) => normal(f.points).z < -0.5);

describe("the roof's covering in 3D (step 12)", () => {
  it("standing seam on a gable: the tops in its colour, seams running down each slope 0.45 apart", () => {
    const seam = motifDefaults("standingSeam");
    const faces = roofFaces(gable(seam), STYLE_3D, true);
    const top = tops(faces);
    expect(top).toHaveLength(2);
    for (const f of top) expect(f.color).toBe(seam.colour);
    const lines = top.flatMap((f) => f.lines ?? []);
    expect(lines.length).toBeGreaterThan(10);
    // Falling toward ±y, each seam runs straight down its slope: constant x along the line.
    for (const l of lines) expect(Math.abs(l.a.x - l.b.x)).toBeLessThan(1e-6);
    const xs = [...new Set(lines.map((l) => Math.round(l.a.x * 1e6) / 1e6))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeCloseTo(0.45, 6);
  });

  it("roof tiles' courses run along the eave, measured up the slope from it", () => {
    const tiles = motifDefaults("roofTiles");
    const lines = tops(roofFaces(gable(tiles), STYLE_3D, true)).flatMap((f) => f.lines ?? []);
    const along = lines.filter((l) => Math.abs(l.a.y - l.b.y) < 1e-6); // courses: constant y, along the eave
    expect(along.length).toBeGreaterThan(5);
    // Up the slope a course every 0.25 m: in plan that is 0.25 · cos 35° apart.
    const ys = [...new Set(along.filter((l) => l.a.y < 2).map((l) => Math.round(l.a.y * 1e6) / 1e6))].sort((a, b) => a - b);
    expect((ys[1] ?? 0) - (ys[0] ?? 0)).toBeCloseTo(0.25 * Math.cos((35 * Math.PI) / 180), 6);
  });

  it("the underside keeps slate; edges take the covering's shades", () => {
    const seam = motifDefaults("standingSeam");
    const faces = roofFaces(gable(seam), STYLE_3D, true);
    for (const f of unders(faces)) expect(f.color).toBe(STYLE_3D.roof.shaded);
    const edges = faces.filter((f) => Math.abs(normal(f.points).z) < 0.5);
    expect(edges.length).toBeGreaterThan(0);
    const shades = finishShades(seam.colour);
    for (const f of edges) expect([shades.lit, shades.shaded]).toContain(f.color);
  });

  it("no covering, or the Finishes switch off: today's slab", () => {
    const bare = roofFaces(gable(), STYLE_3D, true);
    for (const f of tops(bare)) expect(f.color).toBe(STYLE_3D.roof.top);
    const off = roofFaces(gable(motifDefaults("standingSeam")), STYLE_3D, false);
    expect(off).toEqual(bare);
  });

  it("corrugated (0.076) draws its ribs in 3D", () => {
    const lines = tops(roofFaces(gable(motifDefaults("corrugated")), STYLE_3D, true)).flatMap((f) => f.lines ?? []);
    expect(lines.length).toBeGreaterThan(50);
  });
});
