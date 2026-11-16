import { placer } from "./local-frame";
import { newell, orient, sideShade } from "./prism";
import type { Shades } from "./style";
import type { Face3d, PieceItem, Point3 } from "./types";

// A piece's own faces (plants, the clock: hangings), built in the piece's local frame (x across, y from its front at
// −d/2 to its back, z up from its bottom) and placed in the world, each coloured by the way it faces: its top shade
// facing up, its shaded one facing down, else lit or shaded by the one light (`sideShade`).

/** Builds a face from local `points`, wound to face local direction `n` when given. */
export type LocalFace = (points: readonly Point3[], shades: Shades, n?: Point3) => Face3d;

export function localFacer(owner: string, item: PieceItem): { face: LocalFace; world: (p: Point3) => Point3 } {
  const at = placer(item);
  const world = (p: Point3): Point3 => ({ ...at(p.x, p.y), z: item.bottom + p.z });
  const centre = at(0, 0);
  const face: LocalFace = (points, shades, n) => {
    const w = points.map(world);
    const dir = n && { ...at(n.x, n.y), z: n.z };
    const pts = dir ? orient(w, { x: dir.x - centre.x, y: dir.y - centre.y, z: dir.z }) : w;
    const m = newell(pts);
    const len = Math.hypot(m.x, m.y, m.z) || 1;
    const color = m.z / len > 0.7 ? shades.top : m.z / len < -0.3 ? shades.shaded : sideShade({ x: m.x, y: m.y }, shades);
    return { points: pts, holes: [], color, owner };
  };
  return { face, world };
}
