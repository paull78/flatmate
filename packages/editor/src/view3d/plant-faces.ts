import { placer } from "./local-frame";
import { localFacer } from "./local-faces";
import { prism } from "./prism";
import type { Shades, Style3d } from "./style";
import type { Face3d, PieceItem, Point3 } from "./types";

// The plants in low-poly 3D (hangings, the user's review): a tapered eight-sided terracotta pot with a hollow rim and
// dark soil, and leaves of four triangles folded on their midrib, drawn both ways and shaded by the way each facet
// faces, so they read faceted. Like a stair's (`stairFaces`), a plant's faces are its own, not prisms; its parts
// (`parts/basic.ts`) stay for a section's cut and the parts rules.
//
//   a leaf, from above          a plant, from the side
//          T                       ╲ ╱ ╲╱ ╱     leaves fitted inside the ring and the height
//        ╱ │ ╲                      ╲│╱ │╱
//       L──M──R    fold: L and R     ││ ││       stems (palm, plant)
//        ╲ │ ╱     sit lower        ┌────┐
//          B                         ╲  ╱       the pot, wider at its rim
//                                     ‾‾

/** A leaf's shape: where it starts, which way (degrees from +x), how steeply it rises and how much its tip droops, its length and width. */
type Leaf = { x: number; y: number; z: number; turn: number; rise: number; droop: number; length: number; width: number };
/** A stem: where it stands and how high it reaches, both as shares (of the half width, of the height). */
type Stem = { x: number; y: number; top: number };
type Look = { stems: (r: number, h: number, soil: number) => Stem[]; leaves: (r: number, h: number, soil: number) => Leaf[] };

const GOLDEN = 137.5;
/** A plant's three stems: where round its centre (degrees) and how high, as a share of the crown's height. */
const PLANT_STEMS: readonly (readonly [number, number])[] = [[0, 0.88], [120, 0.96], [240, 0.74]];
const STEM = 0.012; // a stem's half side, m

const LOOKS: Readonly<Record<string, Look>> = {
  // Broad leaves up three stems, spiralling round them from low to the top (the user's first and fourth references).
  plant: {
    stems: (r, h, soil) => PLANT_STEMS.map(([a, t]) => ({ ...polar(0.08 * r, a), top: soil + (h - soil) * t })),
    leaves: (r, h, soil) => Array.from({ length: 15 }, (_, i) => {
      const [a, t] = PLANT_STEMS[i % 3] ?? [0, 0.8];
      return { ...polar(0.08 * r, a), z: soil + (h - soil) * Math.min(t, 0.22 + (0.72 * i) / 14), turn: i * GOLDEN, rise: 38, droop: 50, length: 1.4 * r, width: 0.55 * 1.4 * r };
    }),
  },
  // Two or three thin stems with a fan of leaves at each top (the third reference).
  palm: {
    stems: (r, h, soil) => [[0, 0.72], [130, 0.86], [250, 0.6]].map(([a, t]) => ({ ...polar(0.12 * r, a ?? 0), top: soil + (h - soil) * (t ?? 0.7) })),
    leaves: (r, h, soil) => [[0, 0.72], [130, 0.86], [250, 0.6]].flatMap(([a, t], s) => Array.from({ length: 5 }, (_, j) => ({
      ...polar(0.12 * r, a ?? 0), z: soil + (h - soil) * (t ?? 0.7), turn: j * 72 + s * 24, rise: 18, droop: 40, length: 1.1 * r, width: 0.4 * 1.1 * r,
    }))),
  },
  // Long narrow fronds from the soil, arching out and down at their tips.
  fern: {
    stems: () => [],
    leaves: (r, _h, soil) => Array.from({ length: 12 }, (_, i) => ({
      ...polar(0.1 * r, i * 30 + (i % 2) * 15), z: soil, turn: i * 30 + (i % 2) * 15, rise: 58 + (i % 3) * 9, droop: 100, length: 1.8 * r, width: 0.24 * 1.8 * r,
    })),
  },
  // Upright pointed blades, low (the second reference, kept to a rosette's height).
  rosette: {
    stems: () => [],
    leaves: (r, h, soil) => Array.from({ length: 10 }, (_, i) => ({
      ...polar(0.08 * r, i * 36), z: soil, turn: i * 36, rise: 72 - (i % 2) * 18, droop: 22, length: 1.2 * (h - soil) + r, width: 0.22 * r,
    })),
  },
};

function polar(r: number, degrees: number): { x: number; y: number } {
  const a = (degrees * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/** A plant's faces, or null for a kind that isn't a plant (its parts draw it). */
export function plantFaces(owner: string, item: PieceItem, style: Style3d): Face3d[] | null {
  const look = LOOKS[item.objectKind];
  if (!look) return null;
  const at = placer(item);
  const shades = (s: Shades): Shades => (item.selected ? style.selected : s);
  const [pot, leafShades, soilShades, stemShades] = [shades(style.fabric), shades(style.leaf), shades(style.slots.dark), shades(style.slots.wood)];
  const r = Math.min(item.w, item.d) / 2;
  const h = item.top - item.bottom;
  const potH = Math.min(0.3, 0.3 * h);
  const soil = 0.88 * potH;
  const [footR, rimR, innerR] = [0.42 * r, 0.56 * r, 0.48 * r];
  const octagon = (radius: number, z: number): Point3[] => Array.from({ length: 8 }, (_, k) => ({ ...polar(radius, 22.5 + 45 * k), z }));

  const { face } = localFacer(owner, item);
  /** The local direction out of the pot's centre through the middle of edge a–b (`sign` −1: toward it). */
  const outward = (a: Point3, b: Point3, sign: number): Point3 => ({ x: (sign * (a.x + b.x)) / 2, y: (sign * (a.y + b.y)) / 2, z: 0 });

  // The pot: tapered sides, a rim band, the inner wall down to the soil, and the soil.
  const [foot, rim, inner, ground] = [octagon(footR, 0), octagon(rimR, potH), octagon(innerR, potH), octagon(innerR, soil)];
  const potFaces: Face3d[] = [];
  for (let k = 0; k < 8; k += 1) {
    const j = (k + 1) % 8;
    const q = (ring: Point3[], i: number): Point3 => ring[i] ?? { x: 0, y: 0, z: 0 };
    potFaces.push(face([q(foot, k), q(foot, j), q(rim, j), q(rim, k)], pot, outward(q(rim, k), q(rim, j), 1)));
    potFaces.push(face([q(inner, k), q(inner, j), q(rim, j), q(rim, k)], pot, { x: 0, y: 0, z: 1 }));
    potFaces.push(face([q(ground, k), q(ground, j), q(inner, j), q(inner, k)], pot, outward(q(inner, k), q(inner, j), -1)));
  }
  potFaces.push(face(ground, soilShades, { x: 0, y: 0, z: 1 }));

  const stemFaces = look.stems(r, h, soil).flatMap((s) =>
    prism(owner, [at(s.x - STEM, s.y - STEM), at(s.x + STEM, s.y - STEM), at(s.x + STEM, s.y + STEM), at(s.x - STEM, s.y + STEM)], item.bottom + soil, item.bottom + s.top, stemShades));

  const leafFaces = look.leaves(r, h, soil).flatMap((leaf) => leafTriangles(fitted(leaf, 0.9 * r, h)).flatMap(([a, b, c]) => [face([a, b, c], leafShades), face([a, c, b], leafShades)]));
  return [...potFaces, ...stemFaces, ...leafFaces];
}

/** A leaf's points at its full length: base, the midrib's middle, the tip, and the two sides at its widest. */
function leafPoints(l: Leaf): { b: Point3; m: Point3; t: Point3; left: Point3; right: Point3 } {
  const rad = Math.PI / 180;
  const [u, v] = [polar(1, l.turn), polar(1, l.turn + 90)];
  const dir = (deg: number): Point3 => ({ x: u.x * Math.cos(deg * rad), y: u.y * Math.cos(deg * rad), z: Math.sin(deg * rad) });
  const step = (p: Point3, d: Point3, s: number): Point3 => ({ x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s });
  const b = { x: l.x, y: l.y, z: l.z };
  const m = step(b, dir(l.rise), l.length / 2);
  const t = step(m, dir(l.rise - l.droop), l.length / 2);
  const widest = step(b, dir(l.rise), 0.42 * l.length);
  const fold = 0.15 * l.width;
  return { b, m, t, left: { x: widest.x + (v.x * l.width) / 2, y: widest.y + (v.y * l.width) / 2, z: widest.z - fold }, right: { x: widest.x - (v.x * l.width) / 2, y: widest.y - (v.y * l.width) / 2, z: widest.z - fold } };
}

/** The leaf, its length and width scaled down (never up) until every point lies within `reach` of the centre and from 0 to `h`. */
function fitted(l: Leaf, reach: number, h: number): Leaf {
  const inside = (s: number): boolean => {
    const p = leafPoints({ ...l, length: l.length * s, width: l.width * s });
    return [p.b, p.m, p.t, p.left, p.right].every((q) => Math.hypot(q.x, q.y) <= reach + 1e-9 && q.z >= -1e-9 && q.z <= h + 1e-9);
  };
  if (inside(1)) return l;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return { ...l, length: l.length * lo, width: l.width * lo };
}

/** A leaf's four triangles, folded on its midrib. */
function leafTriangles(l: Leaf): [Point3, Point3, Point3][] {
  const { b, m, t, left, right } = leafPoints(l);
  return [[b, left, m], [m, left, t], [b, m, right], [m, t, right]];
}
