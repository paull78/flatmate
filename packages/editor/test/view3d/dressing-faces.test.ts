import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { view3dItems } from "../../src/view3d/items";
import { openingFaces } from "../../src/view3d/opening-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, WallItem } from "../../src/view3d/types";
import { roomDoc, wallBetween } from "../builders";

// A window's dressing in 3D (hangings step 05, AC-08): the shutter box a joinery block above the head on the room side,
// the sheer pale strips with gaps (no transparency, hangings.05), all owned by the wall so they hide with it. The window
// sits at x 2.5–3.5 on the bottom wall (y 0, inner face 0.1), sill 0.9, head 2.1.

const withWindow = (extra: Partial<Extract<Command, { type: "addOpening" }>> = {}): { doc: Document; wall: string } => {
  const doc = roomDoc();
  const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
  const a = doc.joints[doc.walls[wall]?.a ?? ""]?.x ?? 0;
  const cmd: Command = { type: "addOpening", opId: "w", wall, kind: "window", offset: a === 0 ? 2.5 : a - 3.5, width: 1, sill: 0.9, head: 2.1, ...extra };
  return { doc: unwrap(execute(doc, cmd)).doc, wall };
};
const facesOf = ({ doc, wall }: { doc: Document; wall: string }): Face3d[] => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall" && i.wall === wall);
  return item ? openingFaces(`wall/${wall}`, item, STYLE_3D) : [];
};
const sheer = (f: Face3d) => Object.values(STYLE_3D.sheer).includes(f.color);
const added = (x: { doc: Document; wall: string }) => {
  const plain = facesOf(withWindow()).length;
  return facesOf(x).slice(plain);
};
const pts = (fs: readonly Face3d[]) => fs.flatMap((f) => f.points);

describe("a window's dressing in 3D (step 05, AC-08)", () => {
  it("the box is a joinery block above the head on the room side, the window's width", () => {
    const box = added(withWindow({ shutterBox: true }));
    expect(box.length).toBeGreaterThan(0);
    const ps = pts(box);
    const range = (vs: number[]) => [Math.min(...vs), Math.max(...vs)].map((v) => Math.round(v * 1e6) / 1e6);
    expect([range(ps.map((p) => p.x)), range(ps.map((p) => p.y)), range(ps.map((p) => p.z))]).toEqual([[2.5, 3.5], [0.1, 0.22], [2.1, 2.35]]);
    expect(box.every((f) => Object.values(STYLE_3D.joinery).includes(f.color))).toBe(true);
  });

  it("the sheer is strips with gaps, 0.06 off the face, from its rail to the floor", () => {
    const curtain = added(withWindow({ sheer: "floor" })).filter(sheer);
    const ps = pts(curtain);
    expect(Math.min(...ps.map((p) => p.z))).toBeLessThan(0.05);
    expect(Math.max(...ps.map((p) => p.z))).toBeCloseTo(2.15, 6);
    expect(ps.every((p) => Math.abs(p.y - 0.16) < 1e-6)).toBe(true);
    // the strips' spans along x leave gaps: some x inside the window that no strip covers
    const spans = curtain.map((f) => [Math.min(...f.points.map((p) => p.x)), Math.max(...f.points.map((p) => p.x))] as const);
    const covered = (x: number) => spans.some(([a, b]) => x > a + 1e-9 && x < b - 1e-9);
    const samples = Array.from({ length: 99 }, (_, i) => 2.5 + (i + 1) / 100);
    expect(samples.some((x) => !covered(x))).toBe(true);
    expect(samples.filter(covered).length).toBeGreaterThan(40);
  });

  it("every dressing face belongs to the wall, so it hides with the wall", () => {
    const fs = added(withWindow({ sheer: "glass", shutterBox: true }));
    expect(fs.length).toBeGreaterThan(0);
    expect(new Set(fs.map((f) => f.owner)).size).toBe(1);
    expect(fs[0]?.owner.startsWith("wall/")).toBe(true);
  });

  it("STYLE_3D.sheer is at least 30 off the wall's sides, the joinery and the glass in some channel", () => {
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const apart = (a: string, b: string) => Math.max(...rgb(a).map((v, i) => Math.abs(v - (rgb(b)[i] ?? 0))));
    for (const s of [STYLE_3D.sheer.lit, STYLE_3D.sheer.shaded]) {
      for (const other of [STYLE_3D.wall.lit, STYLE_3D.wall.shaded, STYLE_3D.joinery.lit, STYLE_3D.joinery.shaded, STYLE_3D.glass]) expect(apart(s, other), `${s} vs ${other}`).toBeGreaterThanOrEqual(30);
    }
  });
});
