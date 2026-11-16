import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { toCamera } from "../../src/view3d/camera3d";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Part } from "../../src/view3d/parts/types";
import { sideShade } from "../../src/view3d/prism";
import { STYLE_3D } from "../../src/view3d/style";
import type { PieceItem } from "../../src/view3d/types";
import { turnAngles, visible } from "./visible";

// Placing parts in the world (parts.09): the piece's pose, the slot's shades by the light (AC-05), panels after their
// part and only facing the camera, and the selection blue on every face (AC-06).

const TURNS: readonly number[] = [0, 1, 2, 3];
const item = (rotation: number, selected = false): PieceItem => ({
  item: "piece", placement: "p", object: "o", objectKind: "test", config: "standard", ring: [], centre: { x: 3, y: 3 }, rotation, w: 1, d: 0.6, bottom: 0, top: 0.8, selected,
});
/** A thin box along the front edge with a door panel on its front, and a seat behind it. */
const front: Part = { shape: "box", at: { x0: -0.5, x1: 0.5, y0: -0.3, y1: -0.2, z0: 0, z1: 0.8 }, slot: "wood", panels: [{ normal: "-y", at: { x0: -0.4, x1: 0.4, y0: -0.3, y1: -0.3, z0: 0.1, z1: 0.7 }, slot: "dark" }] };
const seat: Part = { shape: "box", at: { x0: -0.5, x1: 0.5, y0: -0.2, y1: 0.3, z0: 0, z1: 0.4 }, slot: "fabric" };
const centroid = (ps: readonly Point[]): Point => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });

describe("part solids", () => {
  it("places a part by the piece's pose: the local front faces −y at rotation 0 and turns with it", () => {
    const sides: Record<number, Point> = { 0: { x: 0, y: -1 }, 90: { x: 1, y: 0 }, 180: { x: 0, y: 1 }, 270: { x: -1, y: 0 } };
    for (const [rotation, dir] of Object.entries(sides)) {
      const [solid] = partSolids("o", item(Number(rotation)), STYLE_3D, [front]);
      const c = centroid(solid?.ring ?? []);
      expect((c.x - 3) * dir.x + (c.y - 3) * dir.y).toBeCloseTo(0.25, 6);
    }
  });

  it("colours a part by its slot: the top its top shade, each side lit or shaded by the light (AC-05)", () => {
    {
      const [solid] = partSolids("o", item(30), STYLE_3D, [seat]);
      const faces = solid?.faces ?? [];
      expect(faces.at(-1)?.color).toBe(STYLE_3D.slots.fabric.top);
      for (const f of faces.slice(0, -1)) {
        const [a, b] = [f.points[0], f.points[1]];
        if (!a || !b) throw new Error("a side has points");
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        expect(f.color).toBe(sideShade({ x: (b.y - a.y) / len, y: -(b.x - a.x) / len }, STYLE_3D.slots.fabric));
      }
    }
  });

  it("draws a panel after its part, seen exactly when its face looks toward the camera (culled by winding, real3d.09)", () => {
    for (const turn of TURNS) {
      const faces = partSolids("o", item(0), STYLE_3D, [front])[0]?.faces ?? [];
      const isPanel = (f: { color: string }) => f.color === STYLE_3D.slots.dark.lit || f.color === STYLE_3D.slots.dark.shaded;
      const panel = faces.find(isPanel);
      expect(panel && faces.indexOf(panel)).toBe(faces.length - 1);
      expect(visible(faces, turnAngles(turn)).some(isPanel)).toBe(-toCamera(turnAngles(turn).yaw).y > 1e-9); // the front's outward normal is −y
    }
    const top: Part = { ...seat, panels: [{ normal: "+z", at: { x0: -0.2, x1: 0.2, y0: -0.1, y1: 0.1, z0: 0.4, z1: 0.4 }, slot: "dark" }] };
    {
      const faces = partSolids("o", item(0), STYLE_3D, [top])[0]?.faces ?? [];
      expect(faces.at(-1)?.color).toBe(STYLE_3D.slots.dark.top);
      expect(faces.at(-1)?.points.every((p) => Math.abs(p.z - 0.4005) < 1e-9)).toBe(true); // 0.5 mm proud, so WebGL never ties it with the top (parts.31)
    }
  });

  it("a side panel stands 0.5 mm off its face toward its normal, inside AC-01's 1 mm", () => {
    const [solid] = partSolids("o", item(0), STYLE_3D, [front]);
    const panel = solid?.faces.at(-1);
    expect(panel?.points.every((p) => Math.abs(p.y - (3 - 0.3 - 0.0005)) < 1e-9)).toBe(true);
  });

  it("a panel lying on an earlier panel of the same face stands one step prouder; side by side, they share a step (real3d.16)", () => {
    const panels = [
      { normal: "-y", at: { x0: -0.4, x1: 0.4, y0: -0.3, y1: -0.3, z0: 0.1, z1: 0.7 }, slot: "metal" }, // a door's surround
      { normal: "-y", at: { x0: -0.3, x1: 0.3, y0: -0.3, y1: -0.3, z0: 0.2, z1: 0.6 }, slot: "dark" }, // the window in it
      { normal: "+z", at: { x0: -0.4, x1: -0.1, y0: -0.3, y1: -0.2, z0: 0.8, z1: 0.8 }, slot: "dark" }, // two rings side by side
      { normal: "+z", at: { x0: 0.1, x1: 0.4, y0: -0.3, y1: -0.2, z0: 0.8, z1: 0.8 }, slot: "dark" },
    ] as const;
    const [solid] = partSolids("o", item(0), STYLE_3D, [{ ...front, panels }]);
    const [surround, window, ringA, ringB] = solid?.faces.slice(-4) ?? [];
    expect(surround?.points.every((p) => Math.abs(p.y - (3 - 0.3 - 0.0005)) < 1e-9)).toBe(true);
    expect(window?.points.every((p) => Math.abs(p.y - (3 - 0.3 - 0.00075)) < 1e-9)).toBe(true);
    for (const ring of [ringA, ringB]) expect(ring?.points.every((p) => Math.abs(p.z - 0.8005) < 1e-9)).toBe(true);
  });

  it("a selected piece is blue on every part and panel (AC-06)", () => {
    const blue = new Set(Object.values(STYLE_3D.selected));
    const faces = partSolids("o", item(45, true), STYLE_3D, [front, seat]).flatMap((s) => s.faces);
    expect(faces.length).toBeGreaterThanOrEqual(10); // two boxes, four sides and a top each, and the front's panel
    expect(faces.every((f) => blue.has(f.color))).toBe(true);
  });

  it("a cylinder is a 12-gon inside its box", () => {
    const leg: Part = { shape: "cylinder", at: { x0: -0.1, x1: 0.1, y0: -0.05, y1: 0.05, z0: 0, z1: 0.4 }, slot: "metal" };
    const [solid] = partSolids("o", item(0), STYLE_3D, [leg]);
    expect(solid?.ring).toHaveLength(12);
    for (const p of solid?.ring ?? []) {
      expect(Math.abs(p.x - 3)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(Math.abs(p.y - 3)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});
