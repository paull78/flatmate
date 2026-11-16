import { add, cross, dot, footprintQuad, kindOf, lineIntersection, roundMm, scale, sub, wallFrame, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { nearWalls, wallSeenAt, type NearWall } from "./near-walls";

// Shape-aware corner snap (furnish.18, .22; spec: layouts): a corner kind's right angle is the back-left corner of its
// rectangle. When touch to turn leaves one touching two wall faces that meet at a right angle, it takes the one turn
// that puts that corner on the faces' corner: back on face X, left side on face Y. Worked out from the generic result's
// touching faces, never from the start angle, so it stays stateless.
//
//    X (behind the back)
//   ◣BBBBBB          n = unit normal from a wall towards the piece; the pair (X, Y) has nX ⟂ nY and cross(nX, nY) > 0
//   L     .´         r = the rotation whose back faces −nX; at = C + (w/2)(cos r, sin r), C = the face lines' crossing
//   L   .´
//   Y

type Placed = { at: Point; rotation: number; flushWalls: readonly string[] };

const TOUCH_M = 0.001; // a face counts as touching within 1 mm of where touch to turn puts a flush side
const PARALLEL_DEG = 1;
const PERP_SIN = Math.sin(Math.PI / 180);

/** Whole degrees in [0, 360); `+ 0` turns −0 into 0. */
const norm = (r: number): number => (((Math.round(r) % 360) + 360) % 360) + 0;

/** A kind drawn with its right angle at the back-left corner: outline quarter, corner or `ell` (catalog.17). */
export function isCornerKind(kind: string): boolean {
  const o = kindOf(kind)?.outline;
  return o === "quarter" || o === "corner" || o === "ell";
}

/** How far from a face touch to turn lands a flush side: on an axis face exactly, on a slanted one 1 mm off (direct.19). */
const flushGap = (n: Point): number => (Math.abs(n.x) < 1e-9 || Math.abs(n.y) < 1e-9 ? 0 : 0.001);

/** A touching wall's flush line: the joint a moved by half the wall's thickness plus `flushGap` along `n`, along a→b. */
type Face = { wallId: string; n: Point; p: Point; dir: Point };

function faceOf(doc: Document, near: NearWall): Face | null {
  const f = wallFrame(doc, near.wallId);
  if (!f || near.distance > flushGap(near.away) + TOUCH_M) return null;
  return { wallId: near.wallId, n: near.away, p: add(f.a, scale(near.away, f.half + flushGap(near.away))), dir: f.dir };
}

/**
 * The corner turn for a `size.w` × `size.d` corner piece at contactPlace's `generic` result (spec: layouts, furnish.18):
 * of the walls within 1 mm of its footprint (a slanted face 1 mm more, as touch to turn stops 1 mm off it) and parallel
 * to one of its sides, each right-angled pair (X, Y) — the one
 * behind the back first, then nearest — gives a turn and anchor; the first that `fits` wins. Null when none does. Only
 * the walls `level` sees count (levels.19).
 */
export function cornerTurn(doc: Document, size: { w: number; d: number }, generic: Placed, fits: (at: Point, rotation: number) => boolean, level: Level): Placed | null {
  const { w, d } = size;
  const r = generic.rotation;
  const rad = (r * Math.PI) / 180;
  const back = { x: -Math.sin(rad), y: Math.cos(rad) };
  const quad = footprintQuad(generic.at, w, d, r);
  const centre = sub(generic.at, scale(back, d / 2));
  const touching = nearWalls(doc, quad, centre, 2 * TOUCH_M)
    .filter((x) => wallSeenAt(doc, x.wallId, level))
    .filter((x) => {
      const off = (((x.angleDeg - r) % 90) + 90) % 90;
      return Math.min(off, 90 - off) <= PARALLEL_DEG;
    })
    .flatMap((x) => faceOf(doc, x) ?? []);
  const behind = touching.find((f) => dot(f.n, back) < -0.999)?.wallId;
  const pairs: [Face, Face][] = [];
  for (const x of touching) {
    for (const y of touching) {
      if (Math.abs(dot(x.n, y.n)) <= PERP_SIN && cross(x.n, y.n) > 0) pairs.push([x, y]);
    }
  }
  // Array sort is stable, so the rest keep nearWalls order (nearest, then wall id).
  pairs.sort(([a], [b]) => (a.wallId === behind ? 0 : 1) - (b.wallId === behind ? 0 : 1));
  for (const [x, y] of pairs) {
    const c = lineIntersection(x.p, x.dir, y.p, y.dir);
    if (!c) continue;
    const rotation = norm((Math.atan2(x.n.x, -x.n.y) * 180) / Math.PI);
    const t = (rotation * Math.PI) / 180;
    const exact = { x: roundMm(c.x + (w / 2) * Math.cos(t)) + 0, y: roundMm(c.y + (w / 2) * Math.sin(t)) + 0 };
    // Already there at this turn: keep touch to turn's anchor, so a face off the millimetre grid never makes it jump 1 mm.
    const there = rotation === r && Math.abs(exact.x - generic.at.x) <= TOUCH_M + 1e-9 && Math.abs(exact.y - generic.at.y) <= TOUCH_M + 1e-9;
    const at = there ? generic.at : exact;
    if (fits(at, rotation)) return { at, rotation, flushWalls: [x.wallId, y.wallId] };
  }
  return null;
}
