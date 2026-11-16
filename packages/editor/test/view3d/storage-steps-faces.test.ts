import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { visibleFrom } from "./visible";

// Storage steps in 3D (steps.03, .09, AC-02): step blocks with a drawer front in the riser of every step, a hair proud
// of it; the last riser is the platform's own face, so 3 risers give 2 steps and 2 drawers. The sides stay plain.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
/** Its back edge's middle at (3, 2), front toward −y: steps 0.70 deep from y 1.30 to 2.00, 0.60 wide (x 2.70–3.30). */
const steps: Command = { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "storageSteps" }, at: { x: 3, y: 2 }, rotation: 0 };
const pieceOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  const body = { ...item };
  delete body.handrails;
  return body;
};
const PROUD = 0.002;
/** Faces lying in the plane y = `y` (all corners), standing up. */
const inPlaneY = (faces: readonly Face3d[], y: number): Face3d[] => faces.filter((f) => f.points.every((p) => Math.abs(p.y - y) < 1e-9) && new Set(f.points.map((p) => p.z)).size > 1);
const inPlaneX = (faces: readonly Face3d[], x: number): Face3d[] => faces.filter((f) => f.points.every((p) => Math.abs(p.x - x) < 1e-9));
const zBand = (f: Face3d | undefined): [number, number] => (f ? [Math.min(...f.points.map((p) => p.z)), Math.max(...f.points.map((p) => p.z))] : [Number.NaN, Number.NaN]);

describe("storage steps' faces (AC-02)", () => {
  it("at 0.45 m: 3 risers of 0.150, two steps, a drawer front proud of each step's riser, inside its band", () => {
    const faces = faces3d(pieceOf(ok(roomDoc(), steps)));
    const first = inPlaneY(faces, 1.3 - PROUD);
    const second = inPlaneY(faces, 1.65 - PROUD);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    const [a0, a1] = zBand(first[0]);
    const [b0, b1] = zBand(second[0]);
    expect(a0).toBeGreaterThan(0);
    expect(a1).toBeLessThan(0.15);
    expect(b0).toBeGreaterThan(0.15);
    expect(b1).toBeLessThan(0.3);
    for (const f of [...first, ...second]) for (const p of f.points) expect(Math.abs(p.x - 3)).toBeLessThan(0.3);
    // Wound toward the front edge: seen from in front, both show; from behind, neither does.
    expect(inPlaneY(visibleFrom(faces, { x: 0.6, y: -0.8 }), 1.3 - PROUD)).toHaveLength(1);
    expect(inPlaneY(visibleFrom(faces, { x: 0.6, y: 0.8 }), 1.3 - PROUD)).toHaveLength(0);
  });

  it("gives every drawer front a round finger pull in its middle, darker than the front and a hair nearer the viewer (steps.30)", () => {
    const faces = faces3d(pieceOf(ok(roomDoc(), steps)));
    for (const [y, band] of [[1.3, [0, 0.15]], [1.65, [0.15, 0.3]]] as const) {
      const [front] = inPlaneY(faces, y - PROUD);
      const pulls = inPlaneY(faces, y - 2 * PROUD);
      expect(pulls).toHaveLength(1);
      const pull = pulls[0];
      expect(pull?.points).toHaveLength(16);
      const xs = pull?.points.map((p) => p.x) ?? [];
      const zs = pull?.points.map((p) => p.z) ?? [];
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(3, 9);
      expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo((band[0] + band[1]) / 2, 9);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.07, 2);
      const lum = (hex: string): number => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
      expect(lum(pull?.color ?? "#ffffff")).toBeLessThan(lum(front?.color ?? "#000000") - 200);
      expect(inPlaneY(visibleFrom(faces, { x: 0.6, y: -0.8 }), y - 2 * PROUD)).toHaveLength(1);
    }
  });

  it("puts nothing proud of the long sides: no cubby doors", () => {
    const faces = faces3d(pieceOf(ok(roomDoc(), steps)));
    expect(inPlaneX(faces, 3.3 + PROUD)).toEqual([]);
    expect(inPlaneX(faces, 2.7 - PROUD)).toEqual([]);
  });

  it("at 0.30 m (two risers of 0.150): one step, still with its drawer", () => {
    const low = ok(roomDoc(), steps, { type: "setObjectSize", objectId: "s/o0", w: 0.6, d: { standard: 0.35 }, h: { standard: 0.3 } });
    const faces = faces3d(pieceOf(low));
    const front = 2 - 0.35;
    expect(inPlaneY(faces, front - PROUD)).toHaveLength(1);
  });
});
