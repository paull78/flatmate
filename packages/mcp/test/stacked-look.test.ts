import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { camera3d, lookScene3d, STYLE_3D, type Angles3d, type Point3 } from "@fm/editor";
import { look3dPixels } from "../src/look3d-png";

// A window stacked over a door in `look` (sills step 05, AC-10): on a 7 × 2.5 shell under 3.05, the south wall holds a
// door 0–2.10 and a window 2.40–2.90 over it. Seen from the north-east, the south wall's inside faces the camera: the
// strip between them reads wall, the window's middle glass, the door's middle what lies beyond (no wall).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
function stacked(): Document {
  const shell = run(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "s"), { type: "setCeiling", height: 3.05 });
  const at = (id: string) => shell.joints[id];
  const south = Object.values(shell.walls).find((w) => Math.abs(at(w.a)?.y ?? 1) < 1e-9 && Math.abs(at(w.b)?.y ?? 1) < 1e-9);
  if (!south) throw new Error("no south wall");
  const offset = (at(south.a)?.x ?? 0) === 0 ? 3 : (at(south.a)?.x ?? 0) - 3.8; // x 3.0–3.8
  return run(shell,
    { type: "addOpening", opId: "d", wall: south.id, kind: "swing", offset, width: 0.8 },
    { type: "addOpening", opId: "w", wall: south.id, kind: "window", offset, width: 0.8, sill: 2.4, head: 2.9 });
}

const rgb = (hex: string): number[] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const WALLS = Object.values(STYLE_3D.wall).map(rgb);
const GLASS = rgb(STYLE_3D.glass);
const dist = (a: readonly number[], b: readonly number[]): number => Math.max(...[0, 1, 2].map((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0))));

describe("a window stacked over a door in look (sills step 05, AC-10)", () => {
  const view: Angles3d = { yaw: 45, tilt: 20 };
  const scene = lookScene3d(stacked(), "s0", view);
  if ("refused" in scene) throw new Error(scene.refused);
  const img = look3dPixels(scene);
  const cam = camera3d(scene.bounds, view);
  /** The colour at a point of the wall's inside face (y 0.1). */
  const at = (p: Point3): number[] => {
    const q = cam.project(p);
    const [px, py] = [Math.floor(((q.x + 1) / 2) * img.width), Math.floor(((1 - q.y) / 2) * img.height)];
    const i = 4 * (py * img.width + px);
    return [0, 1, 2].map((c) => img.pixels[i + c] ?? 0);
  };
  const isWall = (c: number[]): boolean => WALLS.some((w) => dist(c, w) <= 12);

  it("the strip between the door and the window, and the wall above the window, read wall", () => {
    expect(isWall(at({ x: 3.4, y: 0.1, z: 2.25 }))).toBe(true);
    expect(isWall(at({ x: 3.4, y: 0.1, z: 2.98 }))).toBe(true);
  });

  it("the window's middle reads glass and the door's middle no wall", () => {
    expect(dist(at({ x: 3.4, y: 0.1, z: 2.65 }), GLASS)).toBeLessThanOrEqual(24);
    expect(isWall(at({ x: 3.4, y: 0.1, z: 1.1 }))).toBe(false);
  });
});
