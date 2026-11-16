import { describe, expect, it } from "vitest";
import { CEILING_ID, ceilingAtPoint, roofPlanes, type Ceiling, type Document } from "@fm/domain";
import { shellBounds } from "../../src/view3d/camera3d";
import { faces3d } from "../../src/view3d/faces";
import { jointCaps } from "../../src/view3d/joint-caps";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, Point3, WallItem } from "../../src/view3d/types";
import { roomDoc, withCommands } from "../builders";
import { normal } from "./visible";

// Sloped walls in 3D (roofs.09, .16, .17; AC-05, AC-09): a full wall's faces rise to the ceiling along it, a gable's end
// walls reach the ridge, joint caps compare tops at the joint, and the camera frames the highest ceiling. roomDoc's
// outer box is −0.1…6.1 × −0.1…4.1.

const roofed = (doc: Document, c: Omit<Ceiling, "id">): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const walls = (doc: Document): WallItem[] => view3dItems(doc, "s0", null, new Set(), false).flatMap((i) => (i.item === "wall" ? [i] : []));
const facesOf = (doc: Document): Face3d[] => walls(doc).flatMap((w) => faces3d(w));
const ceilingAt = (doc: Document, p: Point3): number => Math.min(...roofPlanes(doc).map((q) => q.c + q.gx * p.x + q.gy * p.y));
const all = (f: Face3d): Point3[] => [...f.points, ...f.holes.flat()];

describe("full walls under a slope", () => {
  const shed = (): Document => roofed(roomDoc(), { height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 });
  const gable = (): Document => roofed(roomDoc(), { height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 });

  it("no face rises above the ceiling, and some point of each wall reaches it", () => {
    for (const doc of [shed(), gable()]) {
      for (const w of walls(doc)) {
        const fs = faces3d(w);
        for (const p of fs.flatMap(all)) expect(p.z).toBeLessThanOrEqual(ceilingAt(doc, p) + 1e-6);
        expect(fs.flatMap(all).some((p) => Math.abs(p.z - ceilingAt(doc, p)) < 1e-6)).toBe(true);
      }
    }
  });

  it("the tops lie on the ceiling at each wall's ends (1 mm)", () => {
    const doc = shed();
    const tops = facesOf(doc).filter((f) => f.points.every((p) => Math.abs(p.z - ceilingAt(doc, p)) < 1e-6) && normal(f.points).z > 0.5);
    expect(tops.length).toBeGreaterThanOrEqual(4);
    for (const p of tops.flatMap((f) => f.points)) expect(Math.abs(p.z - ceilingAtPoint(doc, p))).toBeLessThan(0.001);
  });

  it("a gable's end wall reaches the ridge on the ridge line", () => {
    const doc = gable();
    const ridge = Math.max(...facesOf(doc).flatMap(all).map((p) => p.z));
    expect(ridge).toBeCloseTo(2.3 + Math.tan((35 * Math.PI) / 180) * 2.1, 3);
    const apex = facesOf(doc).flatMap(all).filter((p) => Math.abs(p.z - ridge) < 1e-6);
    for (const p of apex) expect(p.y).toBeCloseTo(2, 6);
  });

  it("every face stays wound from outside: its normal points away from the wall's middle", () => {
    for (const doc of [shed(), gable()]) {
      for (const w of walls(doc)) {
        const xs = w.outline.map((p) => p.x);
        const ys = w.outline.map((p) => p.y);
        const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: 1 };
        for (const f of faces3d(w)) {
          const n = normal(f.points);
          const c = f.points.reduce((s, p) => ({ x: s.x + p.x / f.points.length, y: s.y + p.y / f.points.length, z: s.z + p.z / f.points.length }), { x: 0, y: 0, z: 0 });
          expect(n.x * (c.x - mid.x) + n.y * (c.y - mid.y) + n.z * (c.z - mid.z)).toBeGreaterThan(-1e-9);
        }
      }
    }
  });

  it("a window's hole stays whole inside its side face", () => {
    const doc = withCommands(shed(), { type: "addOpening", opId: "w", wall: Object.keys(roomDoc().walls)[0] ?? "", kind: "window", offset: 2, width: 1 });
    const holed = facesOf(doc).filter((f) => f.holes.length > 0);
    expect(holed.length).toBe(2);
    for (const f of holed) expect(f.holes[0]?.length).toBe(4);
  });

  it("a flat drawing's wall faces are unchanged", () => {
    const flat = roomDoc();
    expect(facesOf(roofed(flat, { height: 2.5, shape: "flat" }))).toEqual(facesOf(flat));
  });
});

describe("joint caps and the camera under a slope", () => {
  it("full walls meeting at a T under a slope get no cap", () => {
    const doc = withCommands(roofed(roomDoc(), { height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 }), { type: "addWall", opId: "t", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } });
    expect([...jointCaps(doc).values()].flat()).toEqual([]);
  });

  it("the camera frames the highest ceiling", () => {
    const doc = roofed(roomDoc(), { height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 });
    expect(shellBounds(doc)?.top).toBeCloseTo(2.5 + Math.tan((10 * Math.PI) / 180) * 4.2, 2);
  });
});
