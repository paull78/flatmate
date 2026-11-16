import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { camera3d, lookScene3d, STYLE_3D, type Angles3d, type Point3 } from "@fm/editor";
import { look3dPixels } from "../src/look3d-png";

// Seams on 3D walls in `look` (snags.10, AC-05): the studio's T-joint, a 2.03 partition across a 7 × 2.5 shell under
// 3.05. Above the partition the south wall's inside reads as one flat wall, with no line at x 1.4 or 1.6; below it the
// partition's corner keeps its line. Seen from the north-east, so the south wall is shown and the partition's east side
// faces the camera.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
function partitioned(): Document {
  const shell = run(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "s"), { type: "setCeiling", height: 3.05 });
  const doc = run(shell, { type: "addWall", opId: "part", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 2.5 } } });
  const at = (id: string) => doc.joints[id];
  const part = Object.values(doc.walls).find((w) => Math.abs((at(w.a)?.x ?? 0) - 1.5) < 1e-9 && Math.abs((at(w.b)?.x ?? 0) - 1.5) < 1e-9);
  if (!part) throw new Error("no partition");
  return run(doc, { type: "setWallTop", wallId: part.id, top: 2.03 });
}

const EDGE = [1, 3, 5].map((k) => parseInt(STYLE_3D.edge.slice(k, k + 2), 16));
const NEAR_EDGE = 30; // per channel: an edge pixel, against walls 70 and more lighter

describe("look on the studio's T-joint (snags step 05, AC-05)", () => {
  const view: Angles3d = { yaw: 45, tilt: 35 };
  const scene = lookScene3d(partitioned(), "s0", view);
  if ("refused" in scene) throw new Error(scene.refused);
  const img = look3dPixels(scene);
  const cam = camera3d(scene.bounds, view);
  /** How near the edge colour the pixels within 2 of a point come: 0 is exactly the edge colour. */
  const nearestToEdge = (p: Point3): number => {
    const q = cam.project(p);
    const [px, py] = [Math.floor(((q.x + 1) / 2) * img.width), Math.floor(((1 - q.y) / 2) * img.height)];
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const i = 4 * ((py + dy) * img.width + (px + dx));
        best = Math.min(best, Math.max(...[0, 1, 2].map((c) => Math.abs((img.pixels[i + c] ?? 0) - (EDGE[c] ?? 0)))));
      }
    }
    return best;
  };

  it("no line above the partition at x 1.4 or 1.6, on the south wall's inside", () => {
    for (const p of [{ x: 1.4, y: 0.1, z: 2.6 }, { x: 1.6, y: 0.1, z: 2.6 }, { x: 1.4, y: 0.1, z: 2.9 }, { x: 1.6, y: 0.1, z: 2.3 }]) {
      expect(nearestToEdge(p), JSON.stringify(p)).toBeGreaterThan(NEAR_EDGE);
    }
  });

  it("the partition's corner with the south wall, below 2.03, keeps its line", () => {
    for (const z of [0.6, 1.2, 1.8]) expect(nearestToEdge({ x: 1.6, y: 0.1, z }), `z ${z}`).toBeLessThanOrEqual(NEAR_EDGE);
  });
});
