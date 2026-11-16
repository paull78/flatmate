import { wallRoomSides, type Document } from "@fm/domain";
import { toCamera } from "./camera3d";

/**
 * Shell walls hidden at `yaw`, like a dollhouse (heights.19, real3d.05): a wall with a room on one side only is hidden when its
 * outer face looks toward the camera (the outer normal's dot with the camera direction above a hair, so a wall seen
 * edge on stays). Dividers and free walls are always drawn.
 */
export function hiddenWalls(doc: Document, yaw: number): ReadonlySet<string> {
  const d = toCamera(yaw);
  const out = new Set<string>();
  for (const id of Object.keys(doc.walls)) {
    const s = wallRoomSides(doc, id);
    if (!s || s.left === s.right) continue;
    const outer = s.left ? { x: -s.normal.x, y: -s.normal.y } : s.normal;
    if (outer.x * d.x + outer.y * d.y > 1e-9) out.add(id);
  }
  return out;
}
