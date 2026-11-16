import { describe, expect, it } from "vitest";
import { kindOf } from "@fm/domain";
import { newell } from "../../src/view3d/prism";
import { plantFaces } from "../../src/view3d/plant-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, PieceItem } from "../../src/view3d/types";

// The plants' low-poly faces (hangings, the user's review): a tapered eight-sided pot with soil and a hollow rim, and
// leaves of four triangles folded on their midrib, drawn both sides, shaped per kind; inside the round ring and range.

const PLANTS = ["plant", "palm", "fern", "rosette"] as const;
function itemOf(kind: string, at = { x: 2, y: 3 }, rotation = 0, bottom = 0): PieceItem {
  const c = kindOf(kind)?.configs[0];
  const [w, d, h] = [c?.w ?? 0.5, c?.d ?? 0.5, c?.h ?? 1];
  const ring = Array.from({ length: 32 }, (_, k) => ({ x: at.x + (w / 2) * Math.cos((2 * Math.PI * k) / 32), y: at.y + (d / 2) * Math.sin((2 * Math.PI * k) / 32) }));
  return { item: "piece", placement: "p", object: "o", objectKind: kind, config: "standard", ring, centre: at, rotation, w, d, bottom, top: bottom + h, selected: false };
}
const facesOf = (kind: string, item = itemOf(kind)): Face3d[] => plantFaces("piece/p", item, STYLE_3D) ?? [];
const isLeaf = (f: Face3d) => Object.values(STYLE_3D.leaf).includes(f.color);
const isPot = (f: Face3d) => Object.values(STYLE_3D.fabric).includes(f.color);

describe("the plants' low-poly faces", () => {
  it.each(PLANTS)("%s: every point inside its round ring and its height range; faces owned by the piece", (kind) => {
    const item = itemOf(kind, { x: 2, y: 3 }, 30, 0.45);
    const fs = facesOf(kind, item);
    expect(fs.length).toBeGreaterThan(40);
    expect(fs.length).toBeLessThan(200);
    for (const p of fs.flatMap((f) => f.points)) {
      expect(Math.hypot(p.x - 2, p.y - 3)).toBeLessThanOrEqual(item.w / 2 + 1e-9);
      expect(p.z).toBeGreaterThanOrEqual(item.bottom - 1e-9);
      expect(p.z).toBeLessThanOrEqual(item.top + 1e-9);
    }
    expect(new Set(fs.map((f) => f.owner))).toEqual(new Set(["piece/p"]));
  });

  it.each(PLANTS)("%s: leaves of triangles, each drawn both ways, in the leaf greens", (kind) => {
    const leaves = facesOf(kind).filter(isLeaf);
    expect(leaves.length).toBeGreaterThanOrEqual(32);
    expect(leaves.every((f) => f.points.length === 3)).toBe(true);
    const key = (f: Face3d) => f.points.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`).sort().join(" ");
    const normals = new Map<string, number[]>();
    for (const f of leaves) normals.set(key(f), [...(normals.get(key(f)) ?? []), newell(f.points).z]);
    for (const zs of normals.values()) expect(zs).toHaveLength(2); // a facet and its back
    expect(new Set(leaves.map((f) => f.color)).size).toBeGreaterThan(1); // faceted: shaded by direction
  });

  it.each(PLANTS)("%s: a terracotta pot wider at its rim than at its foot, under dark soil", (kind) => {
    const pot = facesOf(kind).filter(isPot);
    const pts = pot.flatMap((f) => f.points);
    const top = Math.max(...pts.map((p) => p.z));
    const radiusAt = (z: number) => Math.max(...pts.filter((p) => Math.abs(p.z - z) < 1e-9).map((p) => Math.hypot(p.x - 2, p.y - 3)));
    expect(radiusAt(top)).toBeGreaterThan(radiusAt(0));
    expect(facesOf(kind).some((f) => f.color === STYLE_3D.slots.dark.top)).toBe(true);
  });

  it("a palm's stems reach above half its height; a fern's fronds arch down at their tips; a rosette stays low", () => {
    const h = (k: string) => kindOf(k)?.configs[0]?.h ?? 0;
    const stems = facesOf("palm").filter((f) => Object.values(STYLE_3D.slots.wood).includes(f.color));
    expect(Math.max(...stems.flatMap((f) => f.points.map((p) => p.z)))).toBeGreaterThan(0.5 * h("palm"));
    const fern = facesOf("fern").filter(isLeaf).flatMap((f) => f.points);
    const highest = Math.max(...fern.map((p) => p.z));
    const outermost = fern.reduce((a, p) => (Math.hypot(p.x - 2, p.y - 3) > Math.hypot(a.x - 2, a.y - 3) ? p : a));
    expect(outermost.z).toBeLessThan(highest - 0.1); // the far tips hang below the crown's top
    expect(Math.max(...facesOf("rosette").flatMap((f) => f.points.map((p) => p.z)))).toBeLessThanOrEqual(h("rosette") + 1e-9);
  });

  it("a selected plant is all in the selection's shades; another kind has no plant faces", () => {
    const selected = facesOf("plant", { ...itemOf("plant"), selected: true });
    expect(selected.every((f) => Object.values(STYLE_3D.selected).includes(f.color))).toBe(true);
    expect(plantFaces("piece/p", { ...itemOf("plant"), objectKind: "bed" }, STYLE_3D)).toBeNull();
  });

  it("the leaf green is at least 30 off the walls, the floor and the slots' sage in some channel", () => {
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const apart = (a: string, b: string) => Math.max(...rgb(a).map((v, i) => Math.abs(v - (rgb(b)[i] ?? 0))));
    for (const s of Object.values(STYLE_3D.leaf)) for (const o of [STYLE_3D.wall.lit, STYLE_3D.wall.shaded, STYLE_3D.floor, STYLE_3D.slots.fabric.lit]) expect(apart(s, o), `${s} vs ${o}`).toBeGreaterThanOrEqual(30);
  });
});
