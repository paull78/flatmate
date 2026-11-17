import { STYLE_3D, type Style3d } from "./style";
import type { Face3d, Point3 } from "./types";

// Seams on 3D walls (snags.09, .10). A wall split at a joint, or a joint cap over a partition (studio.05, .10), should
// read as one flat wall, but the renderers outline every face. A wall face lying against other wall faces (in its
// plane, facing the other way, wholly covered by them) is inside the solid: its edges lie on the visible wall, where
// they drew the seam, so it draws no outline. Only the wall's own faces take part (owner `wall/…`, in the wall's or
// the selected wall's shades, or in a shade of a finish the scene's walls show, `finished`): a door's or window's
// frame, leaf and glass share the wall's owner but keep every line, as does a piece or deck against a wall. Run once per scene on the faces it shows, so a hidden wall neither covers nor is covered.
//
//   plan at a T-joint                  west half │cap│ east half
//                                      ──────────┴───┴──────────  the inside face
//                                                 ╲ ╱   each half's 45° end lies against the partition (below its
//                                                  ▼    top) and the cap (above): no outline

const EPS = 1e-6;

type Plane = { n: Point3; d: number };
type Flat = { x: number; y: number };

const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Point3): Point3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** A face's plane: its unit normal, as it is wound (Newell), and offset. */
function planeOf(points: readonly Point3[]): Plane {
  let n = { x: 0, y: 0, z: 0 };
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    n = { x: n.x + (p.y - q.y) * (p.z + q.z), y: n.y + (p.z - q.z) * (p.x + q.x), z: n.z + (p.x - q.x) * (p.y + q.y) };
  });
  const u = unit(n);
  return { n: u, d: dot(u, points[0] ?? { x: 0, y: 0, z: 0 }) };
}


function insideRing(ring: readonly Flat[], p: Flat): boolean {
  let hit = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) hit = !hit;
  });
  return hit;
}

/** Whether a point of the plane lies on a face: inside its ring and in none of its holes. */
const onFace = (rings: readonly (readonly Flat[])[], p: Flat): boolean =>
  rings.length > 0 && insideRing(rings[0] ?? [], p) && !rings.slice(1).some((h) => insideRing(h, p));

/**
 * Whether `face` is wholly covered by `covers`, all in its plane: every cell of the grid through all their corners that
 * lies on the face lies on a cover too. Exact for the upright rectangles walls are made of.
 */
function covered(face: Face3d, plane: Plane, covers: readonly Face3d[]): boolean {
  const u = unit(cross(plane.n, Math.abs(plane.n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }));
  const v = cross(plane.n, u);
  const flat = (f: Face3d): Flat[][] => [f.points, ...f.holes].map((ring) => ring.map((p) => ({ x: dot(p, u), y: dot(p, v) })));
  const mine = flat(face);
  const theirs = covers.map(flat);
  const cuts = (pick: (p: Flat) => number): number[] =>
    [...new Set([mine, ...theirs].flat(2).map((p) => Math.round(pick(p) / EPS) * EPS))].sort((a, b) => a - b);
  const [us, vs] = [cuts((p) => p.x), cuts((p) => p.y)];
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < vs.length; j++) {
      const [u0, u1, v0, v1] = [us[i] ?? 0, us[i + 1] ?? 0, vs[j] ?? 0, vs[j + 1] ?? 0];
      if (u1 - u0 < EPS || v1 - v0 < EPS) continue;
      const c = { x: (u0 + u1) / 2, y: (v0 + v1) / 2 };
      if (onFace(mine, c) && !theirs.some((rings) => onFace(rings, c))) return false;
    }
  }
  return true;
}

type Segment = { a: Point3; b: Point3 };

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const along = (a: Point3, b: Point3, t: number): Point3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const segmentsOf = (f: Face3d): Segment[] => [f.points, ...f.holes].flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] ?? a })));

/** What's left of `s` once every stretch it shares with a collinear segment of `others` is taken out. */
function leftOf(s: Segment, others: readonly Segment[]): Segment[] {
  const d = sub(s.b, s.a);
  const length = Math.hypot(d.x, d.y, d.z);
  if (length < EPS) return [];
  const e = { x: d.x / length, y: d.y / length, z: d.z / length };
  const off = (p: Point3): number => {
    const c = cross(sub(p, s.a), e);
    return Math.hypot(c.x, c.y, c.z);
  };
  const shared = others
    .filter((o) => off(o.a) < EPS && off(o.b) < EPS)
    .map((o): [number, number] => {
      const [t0, t1] = [dot(sub(o.a, s.a), e) / length, dot(sub(o.b, s.a), e) / length];
      return [Math.max(0, Math.min(t0, t1)), Math.min(1, Math.max(t0, t1))];
    })
    .filter(([t0, t1]) => (t1 - t0) * length > EPS)
    .sort((p, q) => p[0] - q[0]);
  const out: Segment[] = [];
  const end: [number, number] = [1, 1];
  let at = 0;
  for (const [t0, t1] of [...shared, end]) {
    if ((t0 - at) * length > EPS) out.push({ a: along(s.a, s.b, at), b: along(s.a, s.b, t0) });
    at = Math.max(at, t1);
  }
  return out;
}

/**
 * The scene's faces with the seams of its walls taken out (see above); every other face as it was. Then the stretch of
 * outline two shown wall faces share, in one plane, of one colour, facing the same way (a wall half and the cap beside
 * it), isn't drawn: such a face has no outline and carries what's left of it as lines in the style's edge colour, after its own.
 */
export function wallSeams(faces: readonly Face3d[], style: Style3d = STYLE_3D, finished: readonly string[] = []): Face3d[] {
  const shades = new Set([...Object.values(style.wall), ...Object.values(style.selected), ...finished]);
  const isWall = (f: Face3d): boolean => f.owner.startsWith("wall/") && shades.has(f.color);
  const walls = faces.flatMap((f) => (isWall(f) && f.points.length >= 3 ? [{ face: f, plane: planeOf(f.points) }] : []));
  const inside = new Set<Face3d>();
  for (const { face, plane } of walls) {
    if (face.outline === false) continue;
    const against = walls.filter((w) => w.face !== face && dot(w.plane.n, plane.n) < -1 + EPS && Math.abs(w.plane.d + plane.d) < EPS).map((w) => w.face);
    if (against.length > 0 && covered(face, plane, against)) inside.add(face);
  }
  const shown = walls.filter((w) => w.face.outline !== false && !inside.has(w.face));
  const trimmed = new Map<Face3d, Face3d>();
  for (const { face, plane } of shown) {
    // The offset only narrows the search: a face in another parallel plane never has an edge collinear with this one's.
    const beside = shown.filter((w) => w.face !== face && w.face.color === face.color && dot(w.plane.n, plane.n) > 1 - EPS && Math.abs(w.plane.d - plane.d) < EPS);
    if (beside.length === 0) continue;
    const theirs = beside.flatMap((w) => segmentsOf(w.face));
    const mine = segmentsOf(face);
    const left = mine.flatMap((s) => leftOf(s, theirs));
    const lost = mine.reduce((sum, s) => sum + Math.hypot(...Object.values(sub(s.b, s.a))), 0) - left.reduce((sum, s) => sum + Math.hypot(...Object.values(sub(s.b, s.a))), 0);
    if (lost > EPS) trimmed.set(face, { ...face, outline: false, lines: [...(face.lines ?? []), ...left.map((s) => ({ ...s, color: style.edge }))] });
  }
  return faces.map((f) => trimmed.get(f) ?? (inside.has(f) ? { ...f, outline: false } : f));
}
