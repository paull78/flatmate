import type { Point } from "@fm/protocol";
import { orient } from "./prism";
import { STYLE_3D, type Shades } from "./style";
import type { Face3d, Point3 } from "./types";

// Storage steps' drawers (steps.03, .09): a drawer front in the riser of every step, inset like a storage stair's cubby
// doors and a hair proud of the riser, so the depth buffer never ties it with the block's face, and a round finger pull
// in its middle, a hair prouder again (steps.30): a hole to hook a finger in, not a knob a toe would catch. Drawn at any
// riser height: a low step still has its drawer.

const DRAWER_INSET = 0.03; // m: the front's margin from the step's sides
const DRAWER_GAP = 0.02; // m: above and below the front
const DRAWER_PROUD = 0.002; // m: off the riser
const PULL_RADIUS = 0.035; // m: a finger hole's
const PULL_SIDES = 16;

/**
 * The drawer front of the step whose riser stands on the plane y = `y0` (local, the step's front), from `z0` to `z1`,
 * across a step `w` wide, wound to face `n` (toward the front edge).
 */
export function drawerFront(owner: string, at: (x: number, y: number) => Point, w: number, y0: number, z0: number, z1: number, n: Point3, shades: Shades): Face3d {
  const y = y0 - DRAWER_PROUD;
  const p = (x: number, z: number): Point3 => ({ ...at(x, y), z });
  const [x0, x1] = [-w / 2 + DRAWER_INSET, w / 2 - DRAWER_INSET];
  const [b, t] = [z0 + DRAWER_GAP, z1 - DRAWER_GAP];
  return { points: orient([p(x0, b), p(x1, b), p(x1, t), p(x0, t)], n), holes: [], color: shades.shaded, owner };
}

/**
 * The finger pull in the middle of the drawer front `drawerFront` draws for the same arguments: a dark 16-gon, no wider
 * than 0.07 m and never taller than 60 % of the front, a hair in front of it.
 */
export function drawerPull(owner: string, at: (x: number, y: number) => Point, y0: number, z0: number, z1: number, n: Point3): Face3d {
  const y = y0 - 2 * DRAWER_PROUD;
  const [b, t] = [z0 + DRAWER_GAP, z1 - DRAWER_GAP];
  const r = Math.min(PULL_RADIUS, 0.3 * (t - b));
  const zc = (b + t) / 2;
  const points = Array.from({ length: PULL_SIDES }, (_, i): Point3 => {
    const angle = (2 * Math.PI * i) / PULL_SIDES;
    return { ...at(r * Math.cos(angle), y), z: zc + r * Math.sin(angle) };
  });
  return { points: orient(points, n), holes: [], color: STYLE_3D.slots.dark.shaded, owner };
}
