import { describe, expect, it } from "vitest";
import { lookScene3d } from "../../src/view3d/look3d";
import { CEILING_ID, roofPlanes, type Ceiling, type Document } from "@fm/domain";
import { roofFaces, ROOF_THICKNESS } from "../../src/view3d/roof-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d } from "../../src/view3d/types";
import { view3dFrame } from "../../src/view3d-state";
import { FakeShell } from "../fake-shell";
import { roomDoc } from "../builders";
import { normal } from "./visible";

// The roof slab and the Roof switch (roofs.13; AC-09). roomDoc's outer box is −0.1…6.1 × −0.1…4.1.

const roofed = (c: Omit<Ceiling, "id">): Document => ({ ...roomDoc(), ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const shed = (): Document => roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 });
const gable = (): Document => roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 });
const xy = (fs: readonly Face3d[]): { minX: number; maxX: number; minY: number; maxY: number } => {
  const ps = fs.flatMap((f) => f.points);
  return { minX: Math.min(...ps.map((p) => p.x)), maxX: Math.max(...ps.map((p) => p.x)), minY: Math.min(...ps.map((p) => p.y)), maxY: Math.max(...ps.map((p) => p.y)) };
};
const ceilingAt = (doc: Document, p: { x: number; y: number }): number => Math.min(...roofPlanes(doc).map((q) => q.c + q.gx * p.x + q.gy * p.y));

describe("the roof slab", () => {
  it("none under a flat ceiling", () => {
    expect(roofFaces(roomDoc(), STYLE_3D, true)).toEqual([]);
  });

  it("a shed's slab covers the box plus the overhang, its underside on the ceiling and its top a slab above", () => {
    const doc = shed();
    const fs = roofFaces(doc, STYLE_3D, true);
    const b = xy(fs);
    expect([b.minX, b.maxX, b.minY, b.maxY].map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.4, 6.4, -0.4, 4.4]);
    for (const p of fs.flatMap((f) => f.points)) {
      const under = ceilingAt(doc, p);
      expect(Math.abs(p.z - under) < 1e-6 || Math.abs(p.z - under - ROOF_THICKNESS) < 1e-6).toBe(true);
    }
  });

  it("a gable's two slopes meet at the ridge with no gap, and no face stands on the ridge between them", () => {
    const fs = roofFaces(gable(), STYLE_3D, true);
    const ridge = 2.3 + Math.tan((35 * Math.PI) / 180) * 2.1;
    const tops = fs.filter((f) => normal(f.points).z > 0.3);
    expect(tops.length).toBe(2);
    for (const t of tops) expect(Math.max(...t.points.map((p) => p.z))).toBeCloseTo(ridge + ROOF_THICKNESS, 6);
    const onRidge = fs.filter((f) => f.points.every((p) => Math.abs(p.y - 2) < 1e-9));
    expect(onRidge).toEqual([]);
  });

  it("every face is wound from outside: away from the slab's middle", () => {
    for (const doc of [shed(), gable()]) {
      for (const f of roofFaces(doc, STYLE_3D, true)) {
        const n = normal(f.points);
        const c = f.points.reduce((s, p) => ({ x: s.x + p.x / f.points.length, y: s.y + p.y / f.points.length, z: s.z + p.z / f.points.length }), { x: 0, y: 0, z: 0 });
        const inside = { x: 3, y: c.y, z: ceilingAt(doc, { x: 3, y: c.y }) + ROOF_THICKNESS / 2 };
        if (Math.abs(n.z) > 0.3) expect(Math.sign(n.z)).toBe(Math.sign(c.z - inside.z));
        else expect(n.x * (c.x - 3) + n.y * (c.y - 2) + n.z * (c.z - inside.z)).toBeGreaterThan(-1e-9);
      }
    }
  });
});

describe("the Roof switch", () => {
  it("is off by default, per viewer, and on draws the roof and hides no wall", () => {
    const s = FakeShell.withDocument(shed());
    s.ui({ type: "toggle3d" });
    const off = view3dFrame(s.state);
    expect(off?.scene.roof ?? []).toEqual([]);
    expect(off?.scene.hidden.size).toBeGreaterThan(0);
    expect(s.view().view3d?.roof).toBe(false);
    s.ui({ type: "toggleRoof3d" });
    const on = view3dFrame(s.state);
    expect(on?.scene.roof?.length).toBeGreaterThan(0);
    expect(on?.scene.hidden.size).toBe(0);
    expect(s.view().view3d?.roof).toBe(true);
    expect(s.state.undo.past.length).toBe(0); // nothing stored: no edit was sent
  });

  it("under a flat ceiling it is the Outside switch: on hides no wall and draws no roof (inherit step 07, AC-09)", () => {
    const s = FakeShell.withDocument(roomDoc());
    s.ui({ type: "toggle3d" });
    expect([s.view().view3d?.roof, s.view().view3d?.outside]).toEqual([false, true]);
    expect(view3dFrame(s.state)?.scene.hidden.size).toBeGreaterThan(0);
    s.ui({ type: "toggleRoof3d" });
    const on = view3dFrame(s.state);
    expect(on?.scene.hidden.size).toBe(0);
    expect(on?.scene.roof ?? []).toEqual([]);
    expect(s.view().view3d?.roof).toBe(true);
  });

  it("under a shed or gable it stays the Roof switch", () => {
    const s = FakeShell.withDocument(shed());
    s.ui({ type: "toggle3d" });
    expect(s.view().view3d?.outside).toBe(false);
  });

  it("look's roof under a flat ceiling hides no wall and draws no roof, saying so", () => {
    const doc = roomDoc();
    const state = Object.keys(doc.states)[0] ?? "";
    const off = lookScene3d(doc, state, { yaw: 225, tilt: 35 });
    const on = lookScene3d(doc, state, { yaw: 225, tilt: 35 }, undefined, true);
    if ("refused" in off || "refused" in on) throw new Error("refused");
    expect(on.faces.length).toBeGreaterThan(off.faces.length);
    expect(on.caption).toContain("every wall shown from outside");
  });
});

describe("look with the roof", () => {
  it("draws the roof only when asked, and never under a flat ceiling", async () => {
    const { lookScene3d } = await import("../../src/view3d/look3d");
    const roofColour = (doc: Document, roof: boolean): number => {
      const scene = lookScene3d(doc, "s0", { yaw: 225, tilt: 35 }, STYLE_3D, roof);
      return "faces" in scene ? scene.faces.filter((f) => f.owner === "roof").length : -1;
    };
    expect(roofColour(shed(), false)).toBe(0);
    expect(roofColour(shed(), true)).toBeGreaterThan(0);
    expect(roofColour(roomDoc(), true)).toBe(0);
  });
});
