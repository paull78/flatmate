import { describe, expect, it } from "vitest";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Box3, Panel, Part } from "../../src/view3d/parts/types";
import { STYLE_3D } from "../../src/view3d/style";
import { PARTS_KINDS, kind, namedSizes, partsOf, pieceOf, type Size } from "./parts-fixtures";

// Storage and living in parts (clarity.05, AC-10, AC-11). The every-kind rules (inside the box, filling it, no overlaps,
// the face cap) run on these kinds through PARTS_KINDS; here is what each kind must show.
// Local frame: y from the front (−d/2) to the back (d/2), z up from the bottom.

const FACE_CAP = 150;
const size = (w: number, d: number, h: number): Size => ({ config: "standard", w, d, h, label: `${w}×${d}×${h}` });
type BoxPart = { at: Box3; slot: Part["slot"]; panels: readonly Panel[] };
const boxes = (parts: readonly Part[]): BoxPart[] => parts.flatMap((p) => (p.shape === "box" ? [{ at: p.at, slot: p.slot, panels: p.panels ?? [] }] : []));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const faces = (id: string, s: Size) => partSolids("o", pieceOf(id, s.config, s.w, s.d, s.h), STYLE_3D).flatMap((p) => p.faces).length;

describe("the kinds of this step", () => {
  it("are checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toEqual(expect.arrayContaining(["shelf", "drawers", "nightstand", "armchair", "tvUnit"]));
  });
});

describe("the shelf", () => {
  const presets = namedSizes(kind("shelf"));
  /** The shelf's sides stand at the box's ends; everything else sits between them. */
  const innerOf = (s: Size) => {
    const sides = boxes(partsOf("shelf", s)).filter((b) => b.slot === "wood" && near(b.at.y1 - b.at.y0, s.d) && near(b.at.z1 - b.at.z0, s.h));
    return { x0: Math.max(...sides.map((b) => b.at.x0 < 0 ? b.at.x1 : -Infinity)), x1: Math.min(...sides.map((b) => b.at.x0 > 0 ? b.at.x0 : Infinity)) };
  };
  /** The horizontal boards, lowest first: wood across the inner width, thin in z (the back is as wide but as tall as the shelf). */
  const boardsOf = (s: Size) => {
    const inner = innerOf(s);
    return boxes(partsOf("shelf", s)).filter((b) => b.slot === "wood" && near(b.at.x0, inner.x0) && near(b.at.x1, inner.x1) && b.at.z1 - b.at.z0 < 0.05).sort((a, b) => a.at.z0 - b.at.z0);
  };
  const booksOf = (s: Size) => boxes(partsOf("shelf", s)).filter((b) => b.slot !== "wood");

  it("the shelf has a horizontal board at its full height", () => {
    expect(presets.some((s) => s.label.includes("Wall shelf"))).toBe(true);
    for (const s of presets) {
      const top = boardsOf(s).filter((b) => near(b.at.z1, s.h));
      expect(top, s.label).toHaveLength(1);
      expect((top[0]?.at.y1 ?? 0) - (top[0]?.at.y0 ?? 0), s.label).toBeGreaterThan(0.8 * s.d);
    }
  });

  it("the shelf has books on its shelves at every preset, Wall shelf included", () => {
    for (const s of presets) {
      const boards = boardsOf(s);
      const books = booksOf(s);
      const top = boards[boards.length - 1];
      for (const [i, board] of boards.slice(0, -1).entries()) {
        const next = boards[i + 1];
        const on = books.filter((b) => near(b.at.z0, board.at.z1));
        expect(on.length, `${s.label} level ${i}`).toBeGreaterThan(0);
        for (const b of on) expect(b.at.z1, `${s.label} level ${i}`).toBeLessThanOrEqual(next?.at.z0 ?? 0);
      }
      for (const b of books) {
        expect(b.at.z0, `${s.label}: nothing on the top board`).toBeLessThan(top?.at.z0 ?? 0);
        expect(b.at.y0, `${s.label}: set back from the front`).toBeGreaterThan(-s.d / 2);
        expect(b.panels.length, s.label).toBeGreaterThan(0);
        for (const q of b.panels) {
          expect(q.normal, s.label).toBe("-y");
          expect(q.at.y0, `${s.label}: a spine lies on its block's front`).toBe(b.at.y0);
          expect(q.slot, `${s.label}: a spine shows on its block`).not.toBe(b.slot);
        }
      }
    }
  });

  it("a very tall shelf at 10 m stays under the cap with fewer books a shelf", () => {
    const tall = size(0.8, 0.4, 10);
    const standard = size(0.8, 0.4, 1.5);
    const perLevel = (s: Size) => booksOf(s).length / (boardsOf(s).length - 1);
    expect(faces("shelf", tall)).toBeLessThanOrEqual(FACE_CAP);
    expect(perLevel(tall)).toBeGreaterThanOrEqual(1);
    expect(perLevel(tall)).toBeLessThan(perLevel(standard));
  });

  it("the shelf's books stay within the shelf's inner width", () => {
    for (const w of [0.1, 0.3, 0.8, 2, 10]) {
      const s = size(w, 0.4, 1.5);
      const inner = innerOf(s);
      expect(booksOf(s).length, `${w} m`).toBeGreaterThan(0);
      for (const b of booksOf(s)) {
        for (const at of [b.at, ...b.panels.map((q) => q.at)]) {
          expect(at.x0, `${w} m`).toBeGreaterThanOrEqual(inner.x0);
          expect(at.x1, `${w} m`).toBeLessThanOrEqual(inner.x1);
        }
      }
    }
  });
});

/** The fronts reaching the box's front face: thin wood boxes, each with its handle. */
const frontsOf = (parts: readonly Part[], d: number) => boxes(parts).filter((b) => b.slot === "wood" && near(b.at.y0, -d / 2) && b.at.y1 - b.at.y0 < 0.05).sort((a, b) => a.at.z0 - b.at.z0);

describe("the chest of drawers", () => {
  it("drawers count one per 0.20 m, 2 to 8", () => {
    for (const [h, n] of [[0.1, 2], [0.4, 2], [0.6, 3], [0.9, 5], [1.2, 6], [1.6, 8], [3, 8]] as const) {
      const fronts = frontsOf(partsOf("drawers", size(1, 0.5, h)), 0.5);
      expect(fronts, `${h} m`).toHaveLength(n);
      for (const f of fronts) expect(f.panels.filter((q) => q.slot === "dark"), `${h} m: a handle`).toHaveLength(1);
    }
  });

  it("stands on a dark plinth, set back, under its carcass", () => {
    const plinth = boxes(partsOf("drawers", size(1, 0.5, 0.9))).filter((b) => b.slot === "dark" && b.at.z0 === 0);
    expect(plinth).toHaveLength(1);
    expect(plinth[0]?.at.y0).toBeGreaterThan(-0.25);
  });
});

describe("the nightstand", () => {
  it("a nightstand is its soft ring in three layers: a plinth, a body with 2 drawers on its front, a top (symbols.05)", () => {
    const [w, d, h] = [0.45, 0.4, 0.6];
    const parts = partsOf("nightstand", size(w, d, h));
    const rings = parts.flatMap((p) => (p.shape === "outline" ? [p] : []));
    expect(rings).toHaveLength(parts.length);
    expect(rings[0]).toMatchObject({ slot: "dark", z0: 0 });
    expect(rings[2]).toMatchObject({ slot: "wood", z1: h });
    expect((rings[2]?.z1 ?? 0) - (rings[2]?.z0 ?? 0)).toBeLessThan(0.05);
    const panels = rings[1]?.panels ?? [];
    expect(panels.filter((q) => q.slot === "wood" && q.normal === "-y")).toHaveLength(2);
    expect(panels.filter((q) => q.slot === "dark" && q.normal === "-y")).toHaveLength(2); // a pull on each drawer
    // On the straight front: the rounded corners start 6 cm in from each side.
    for (const q of panels) expect(Math.abs(q.at.x0)).toBeLessThanOrEqual(w / 2 - 0.06);
  });
});

describe("the armchair", () => {
  it("an armchair has a back, two arms and one cushion", () => {
    for (const w of [0.8, 1.6, 3]) {
      const [d, h] = [0.8, 1];
      const fabric = boxes(partsOf("armchair", size(w, d, h))).filter((b) => b.slot === "fabric");
      const arms = fabric.filter((b) => near(b.at.x0, -w / 2) || near(b.at.x1, w / 2));
      expect(arms, `${w} m`).toHaveLength(2);
      const rest = fabric.filter((b) => !arms.includes(b));
      expect(rest.filter((b) => near(b.at.z1, h) && near(b.at.y1, d / 2)), `${w} m: the back`).toHaveLength(1);
      const cushion = rest.filter((b) => b.at.z0 > 0.2 && b.at.z1 < 0.6);
      expect(cushion, `${w} m: stretched wider it stays one seat`).toHaveLength(1);
      const inner = arms.map((a) => (a.at.x0 < 0 ? a.at.x1 : a.at.x0));
      expect(cushion[0] && [cushion[0].at.x0, cushion[0].at.x1]).toEqual(inner.map((x) => expect.closeTo(x, 9)));
    }
  });
});

describe("the TV unit", () => {
  const screenOf = (parts: readonly Part[], h: number) => boxes(parts).filter((b) => b.slot === "dark" && near(b.at.z1, h));

  it("a TV unit under 0.25 m deep has no cabinet", () => {
    for (const d of [0.1, 0.2, 0.249]) {
      const parts = partsOf("tvUnit", size(1.2, d, 0.6));
      expect(boxes(parts).filter((b) => b.slot === "wood"), `${d} m`).toEqual([]);
      expect(screenOf(parts, 0.6), `${d} m`).toHaveLength(1);
    }
  });

  it("the studio's 1.2 × 0.10 at h 0.60 is a screen across the box, facing the room", () => {
    const parts = partsOf("tvUnit", size(1.2, 0.1, 0.6));
    const [screen] = screenOf(parts, 0.6);
    expect(screen?.at).toMatchObject({ x0: -0.6, x1: 0.6, y0: -0.05, z0: 0, z1: 0.6 });
    expect((screen?.at.y1 ?? 0) - (screen?.at.y0 ?? 0)).toBeLessThan(0.1);
    expect(parts.length).toBeGreaterThan(1); // something holds it to the wall
  });

  it("deeper has a cabinet and a dark screen", () => {
    for (const s of [size(1.2, 0.25, 1.2), size(1.2, 0.4, 1.2), size(2, 0.4, 1.2)]) {
      const parts = partsOf("tvUnit", s);
      const cabinet = boxes(parts).filter((b) => b.slot === "wood");
      expect(cabinet, s.label).toHaveLength(1);
      expect(cabinet[0]?.at).toMatchObject({ x0: -s.w / 2, x1: s.w / 2, y0: -s.d / 2, y1: s.d / 2, z0: 0 });
      expect(cabinet[0]?.at.z1, s.label).toBeLessThan(0.5 * s.h);
      const [screen] = screenOf(parts, s.h);
      expect(screen?.at.z0, s.label).toBeGreaterThanOrEqual(cabinet[0]?.at.z1 ?? 0);
      // As wide as the plan draws it: min(1.40, 0.85·w).
      expect((screen?.at.x1 ?? 0) - (screen?.at.x0 ?? 0), s.label).toBeCloseTo(Math.min(1.4, 0.85 * s.w), 9);
    }
  });
});
