import type { Point } from "@fm/protocol";
import type { Shades } from "./style";
import type { Face3d, Point3, Ring } from "./types";

// The 3D view's one shading rule (heights.06) and the plain extrusion every box and wall body uses.

/** The light, from the north-west, fixed in the world. */
const LIGHT: Point = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };

/** A side's colour: lit when its outward normal `n` looks toward the light. */
export function sideShade(n: Point, shades: Shades): string {
  return n.x * LIGHT.x + n.y * LIGHT.y > 0 ? shades.lit : shades.shaded;
}

/** A flat ring's Newell normal (not normalised): the side it faces, wound counter-clockwise seen from there. */
export function newell(points: readonly Point3[]): Point3 {
  let [x, y, z] = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    x += (p.y - q.y) * (p.z + q.z);
    y += (p.z - q.z) * (p.x + q.x);
    z += (p.x - q.x) * (p.y + q.y);
  });
  return { x, y, z };
}

/** `points` as given, or reversed when their Newell normal points against `n`: wound from outside (real3d.12). */
export function orient(points: Point3[], n: Point3): Point3[] {
  const m = newell(points);
  return m.x * n.x + m.y * n.y + m.z * n.z < 0 ? [...points].reverse() : points;
}

/** The ring counter-clockwise. */
export function ccw(ring: Ring): Ring {
  let a = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    a += p.x * q.y - q.x * p.y;
  });
  return a < 0 ? [...ring].reverse() : ring;
}

/**
 * A deck's slab extruded from `bottom` to `top` (stairwell.09): a side on every boundary edge (the slab on its left, so
 * its outward normal is on its right, as a counter-clockwise ring's), then the top with the holes cut out.
 */
export function slabPrism(owner: string, slab: { fills: readonly { ring: Ring; holes: readonly Ring[] }[]; edges: readonly { a: Point; b: Point }[]; bottom: number; top: number }, shades: Shades): Face3d[] {
  const sides = slab.edges.flatMap(({ a, b }): Face3d[] => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) return [];
    const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    return [{ points: [{ ...a, z: slab.bottom }, { ...b, z: slab.bottom }, { ...b, z: slab.top }, { ...a, z: slab.top }], holes: [], color: sideShade(n, shades), owner }];
  });
  const tops = slab.fills.map((fill): Face3d => ({ points: ccw(fill.ring).map((p) => ({ ...p, z: slab.top })), holes: fill.holes.map((h) => h.map((p) => ({ ...p, z: slab.top }))), color: shades.top, owner }));
  return [...sides, ...tops];
}

/** A ring extruded from `bottom` to `top`: every side, then the top, in `shades`, wound from outside (real3d.09). */
export function prism(owner: string, ring: Ring, bottom: number, top: number, shades: Shades): Face3d[] {
  const r = ccw(ring);
  const sides: Face3d[] = [];
  r.forEach((a, i) => {
    const b = r[(i + 1) % r.length] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) return;
    const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }; // outward for a counter-clockwise ring
    sides.push({ points: [{ ...a, z: bottom }, { ...b, z: bottom }, { ...b, z: top }, { ...a, z: top }], holes: [], color: sideShade(n, shades), owner });
  });
  return [...sides, { points: r.map((p) => ({ ...p, z: top })), holes: [], color: shades.top, owner }];
}
