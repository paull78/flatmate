import { add, cross, distance, normalize, scale, sortedIds, sub, wallFrame, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { SnapResult } from "../types";
import type { ViewBox } from "./across";

// Equal length (straight step 25, spec M4): the end of a wall being drawn or changed snaps to the length of another
// wall parallel to it, for offset walls such as two closets side by side. It only takes a point from the grid or no
// snap, or a plain angle ray (aligned and every exact snap win), runs along the moving wall's direction from its other end, and skips walls
// in line with the moving one, off screen or excluded. The nearest length within the tolerance wins.

/** Walls within 1° of the moving wall's direction count as parallel. */
const PARALLEL_SIN = Math.sin(Math.PI / 180);
/** A wall whose line lies this close to the moving wall's is in line with it, not offset. */
const IN_LINE = 1e-3;

function inBox(p: Point, box: ViewBox): boolean {
  return p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
}

/**
 * `snap` moved to an equal length, when one is in range: for each far end in `from`, the moving wall runs from it to
 * the snapped point. Guides: the matched wall's middle, then the moving wall's (where the "=" marks go).
 */
export function equalLength(snap: SnapResult, from: readonly Point[], doc: Document, exclude: ReadonlySet<string>, tolerance: number, box: ViewBox): SnapResult {
  // A grid or free point, or the Wall tool's plain angle ray (its length is only grid-rounded; the direction stays).
  // An angle snap tied to an aligned line (two guides) is exact and stays.
  const plainRay = snap.kind === "angle" && (snap.guides?.length ?? 0) <= 1;
  if (snap.kind !== "grid" && snap.kind !== "none" && !plainRay) return snap;
  let best: { off: number; point: Point; guides: [Point, Point] } | null = null;
  for (const far of from) {
    const dir = normalize(sub(snap.point, far));
    if (!dir) continue;
    const length = distance(snap.point, far);
    for (const id of sortedIds(doc.walls)) {
      const f = exclude.has(id) || doc.walls[id]?.column ? null : wallFrame(doc, id);
      if (!f || Math.abs(cross(f.dir, dir)) > PARALLEL_SIN) continue;
      if (Math.abs(cross(sub(f.a, far), dir)) < IN_LINE) continue; // in line with the moving wall
      const middle = scale(add(f.a, f.b), 0.5);
      if (!inBox(f.a, box) && !inBox(f.b, box) && !inBox(middle, box)) continue;
      const off = Math.abs(f.length - length);
      if (off > tolerance || (best && off >= best.off)) continue;
      best = { off, point: add(far, scale(dir, f.length)), guides: [middle, add(far, scale(dir, f.length / 2))] };
    }
  }
  return best ? { point: best.point, kind: "equal", guides: best.guides } : snap;
}
