import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, pieceShape, placedPiece, type Arms } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { appearanceOf } from "../../src/view3d/parts";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Part } from "../../src/view3d/parts/types";
import { STYLE_3D } from "../../src/view3d/style";
import { shapedFill } from "../../src/view/shapes";
import { pieceOf, stream } from "./parts-fixtures";

// The `L` kinds in 3D (catalog.17, .19, .34, AC-08): every part inside the `L` outline with the object's arms, nothing
// in the empty quarter, no "outline" part, under the face cap; the corner desk's two top boxes over its arms and legs
// at the outer corners and the arm ends.

const MM = 0.001;
const FACE_CAP = 150;
const H = 0.75;
/** Every `L` kind with its default height. */
const ELL = OBJECT_KINDS.filter((k) => k.outline === "ell").map((k) => ({ id: k.id, h: k.configs[0]?.h ?? 1 }));

const partsAt = (w: number, d: number, arms?: Arms, kind = "cornerDesk", h = H): readonly Part[] => appearanceOf(kind)("standard", w, d, h, undefined, arms);

/** Whether `p` lies in the polygon `ring` or within MM of its boundary (even-odd, then distance to each edge). */
function inOutline(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  });
  if (inside) return true;
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= MM;
  });
}

/** A part's plan corners in the parts' local frame (y from the front −d/2 to the back d/2). */
function cornersOf(p: Part): Point[] {
  if (p.shape === "box" || p.shape === "cylinder") return [{ x: p.at.x0, y: p.at.y0 }, { x: p.at.x1, y: p.at.y0 }, { x: p.at.x1, y: p.at.y1 }, { x: p.at.x0, y: p.at.y1 }];
  if (p.shape === "ring") return [...p.ring];
  throw new Error("an L piece never draws its outline as one prism");
}

/** The domain's `L` outline (back edge at y 0) moved into the parts' frame. */
const outlineAt = (w: number, d: number, arms?: Arms, kind = "cornerDesk"): Point[] => pieceShape(kind, w, d, arms).outline.map((q) => ({ x: q.x, y: q.y + d / 2 }));

/** Sizes and arms: the default, resized arms, and random ones from 0.10 to 10 m with arms anywhere in their range. */
function cases(): { w: number; d: number; arms?: Arms; label: string }[] {
  const out: { w: number; d: number; arms?: Arms; label: string }[] = [
    { w: 1.6, d: 1.2, label: "default" },
    { w: 1.6, d: 1.2, arms: { back: 0.8, left: 0.4 }, label: "deep back, narrow left" },
    { w: 1.6, d: 1.2, arms: { back: 0.3, left: 1.2 }, label: "narrow back, wide left" },
    { w: 0.1, d: 0.1, label: "smallest" },
    { w: 10, d: 10, arms: { back: 9.9, left: 0.1 }, label: "10 m, extreme arms" },
  ];
  const random = stream(42);
  for (let i = 0; i < 200; i++) {
    const w = 0.1 + random() * 9.9;
    const d = 0.1 + random() * 9.9;
    const arms = random() < 0.2 ? undefined : { back: 0.1 + random() * Math.max(0, d - 0.2), left: 0.1 + random() * Math.max(0, w - 0.2) };
    out.push({ w, d, ...(arms ? { arms } : {}), label: `${w.toFixed(3)}×${d.toFixed(3)} arms ${arms ? `${arms.back.toFixed(3)}/${arms.left.toFixed(3)}` : "default"}` });
  }
  return out;
}

describe("the L kinds' parts (AC-08)", () => {
  it("there are the corner desk, wardrobe, counter and sofa", () => {
    expect(ELL.map((k) => k.id)).toEqual(expect.arrayContaining(["cornerDesk", "cornerWardrobe", "cornerCounter", "cornerSofa"]));
  });

  it("every part's corners lie inside the L outline, at the default and resized arms", () => {
    const bad: string[] = [];
    for (const k of ELL) {
      for (const c of cases()) {
        const outline = outlineAt(c.w, c.d, c.arms, k.id);
        for (const p of partsAt(c.w, c.d, c.arms, k.id, k.h)) for (const q of cornersOf(p)) if (!inOutline(outline, q)) bad.push(`${k.id} ${c.label}: (${q.x.toFixed(3)}, ${q.y.toFixed(3)})`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("no part covers the empty quarter's centre", () => {
    const bad: string[] = [];
    for (const k of ELL) for (const c of cases()) {
      const outline = outlineAt(c.w, c.d, c.arms, k.id);
      // The empty quarter: from the inner corner (outline point 3) to the footprint's front-right corner.
      const corner = outline[2];
      if (!corner) throw new Error("an L has six corners");
      const centre = { x: (corner.x + c.w / 2) / 2, y: (corner.y - c.d / 2) / 2 };
      for (const p of partsAt(c.w, c.d, c.arms, k.id, k.h)) {
        const [xs, ys] = [cornersOf(p).map((q) => q.x), cornersOf(p).map((q) => q.y)];
        if (Math.min(...xs) < centre.x && centre.x < Math.max(...xs) && Math.min(...ys) < centre.y && centre.y < Math.max(...ys)) bad.push(`${k.id} ${c.label}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("the corner desk draws two tops, one per arm, the left below the back one, and legs at the outer corners and the arm ends", () => {
    const [w, d] = [1.6, 1.2];
    const arms = { back: 0.8, left: 0.4 };
    const parts = partsAt(w, d, arms);
    const boxes = parts.flatMap((p) => (p.shape === "box" ? [p.at] : []));
    expect(boxes).toHaveLength(parts.length);
    const tops = boxes.filter((b) => Math.abs(b.z1 - H) < 1e-9);
    const seam = d / 2 - arms.back;
    const r6 = (vs: number[]) => vs.map((v) => +v.toFixed(6));
    expect(tops.map((b) => r6([b.x0, b.x1, b.y0, b.y1]))).toEqual([r6([-w / 2, w / 2, seam, d / 2]), r6([-w / 2, -w / 2 + arms.left, -d / 2, seam])]);
    const legs = boxes.filter((b) => b.z0 === 0);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const touches = (x: number, y: number) => legs.some((b) => [b.x0, b.x1].some((v) => near(v, x)) && [b.y0, b.y1].some((v) => near(v, y)));
    const wanted: [number, number][] = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, seam], [-w / 2, -d / 2], [-w / 2 + arms.left, -d / 2]];
    for (const [x, y] of wanted) expect(touches(x, y), `a leg at (${x}, ${y})`).toBe(true);
    expect(legs).toHaveLength(wanted.length);
  });

  it("never uses the outline part, which extrudes one convex ring", () => {
    for (const k of ELL) for (const c of cases()) expect(partsAt(c.w, c.d, c.arms, k.id, k.h).filter((p) => p.shape === "outline"), `${k.id} ${c.label}`).toEqual([]);
  });

  it("a placed piece takes its item's arms: every face lies inside the arms placed with them", () => {
    const bad: string[] = [];
    for (const k of ELL) for (const c of cases().slice(0, 60)) {
      if (!c.arms) continue;
      const rotation = 37;
      const at = { x: 5, y: 5 };
      const base = pieceOf(k.id, "standard", c.w, c.d, k.h, rotation, at);
      const item = { ...base, ring: shapedFill(k.id, c.w, c.d, at, rotation, base.ring, c.arms), arms: c.arms };
      const rings = placedPiece(k.id, at, c.w, c.d, rotation, c.arms).parts;
      for (const f of partSolids("o", item, STYLE_3D).flatMap((s) => s.faces)) {
        for (const p of f.points) {
          if (!rings.some((r) => inOutline(r, p))) bad.push(`${k.id} ${c.label}: (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("stays under the face cap at the default, the presets' sizes and 10 m with any arms (AC-09)", () => {
    for (const k of ELL) for (const c of cases()) {
      const item = { ...pieceOf(k.id, "standard", c.w, c.d, k.h), ...(c.arms ? { arms: c.arms } : {}) };
      expect(partSolids("o", item, STYLE_3D).flatMap((s) => s.faces).length, `${k.id} ${c.label}`).toBeLessThanOrEqual(FACE_CAP);
    }
  });
});
