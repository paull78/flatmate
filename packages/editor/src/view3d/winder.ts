import { WINDERS, winderTreads, type StairGeometry } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { prism } from "./prism";
import type { Shades } from "./style";
import { stepsFrom, type Face3d, type PieceItem } from "./types";

// A winder in 3D (steps.04): three winder blocks in the square at its front, each standing on the floor below with the
// tread's outline as its top, at 1, 2 and 3 risers; then the straight blocks up to the back edge, as a solid flight's.
// In the item's frame y runs from −d/2 (the front edge) to d/2; the treads' `a` from the front edge, so y = a − d/2.

/** The winder's blocks; `left` mirrors the winders (Enters from: Left). */
export function winderFaces(owner: string, item: PieceItem, shades: Shades, g: StairGeometry, at: (x: number, y: number) => Point, left: boolean): Face3d[] {
  const { w, d } = item;
  const faces: Face3d[] = [];
  winderTreads(w, left).forEach((ring, i) => {
    faces.push(...prism(owner, ring.map((p) => at(p.x, p.y - d / 2)), item.bottom, stepsFrom(item) + (i + 1) * g.riser, shades));
  });
  for (let k = WINDERS + 1; k <= g.treads; k++) {
    const [y0, y1] = [-d / 2 + g.nosingAt(k), k === g.treads ? d / 2 : -d / 2 + g.nosingAt(k + 1)];
    faces.push(...prism(owner, [at(-w / 2, y0), at(w / 2, y0), at(w / 2, y1), at(-w / 2, y1)], item.bottom, stepsFrom(item) + k * g.riser, shades));
  }
  return faces;
}
