import type { EntityKey, Point } from "@fm/protocol";
import { add, dot, normalize, perpLeft, scale, sub } from "../geometry";
import { EPS, type Document } from "../model";
import { floorWallBodies, footprints, placementKey, placementRug, quadCentre, wallKey } from "./footprints";
import { faceAt } from "./zones";

// Live distances (direct.12, direct.18; AC-12): from each side of a counter-clockwise quad (a footprint, or a
// group's bounding box), the gap to the nearest wall face or footprint of the same layout state, outward. The editor
// draws the result; this module only measures.

export type QuadSide = "front" | "right" | "back" | "left";
export type ObstacleGap = { gap: number; from: Point; to: Point; obstacle: EntityKey };
export type SideGaps = Record<QuadSide, ObstacleGap | null>;

/** A side a→b in its own frame: u runs along it over [0, length], v along its outward normal n. */
type Band = { a: Point; dir: Point; n: Point; length: number };
type Obstacle = { key: EntityKey; quad: readonly Point[] };

function bandOf(a: Point, b: Point): Band | null {
  const dir = normalize(sub(b, a));
  return dir ? { a, dir, n: scale(perpLeft(dir), -1), length: dot(sub(b, a), dir) } : null;
}

/** The part of [0, 1] where f(t) = f0 + t·(f1 − f0) lies in [lo, hi], or null when none does. */
function clip(f0: number, f1: number, lo: number, hi: number): [number, number] | null {
  const df = f1 - f0;
  if (df === 0) return f0 >= lo && f0 <= hi ? [0, 1] : null;
  const ta = (lo - f0) / df;
  const tb = (hi - f0) / df;
  const s0 = Math.max(0, Math.min(ta, tb));
  const s1 = Math.min(1, Math.max(ta, tb));
  return s0 <= s1 ? [s0, s1] : null;
}

/**
 * The edge p→q clipped to the side's band, u trimmed by EPS at each end (a neighbour touching only the side's end is
 * not in front of it, as in convexOverlap): u and v at the clipped part's two ends, or null when none of it is in.
 */
function edgeSpan(band: Band, p: Point, q: Point): { u: [number, number]; v: [number, number] } | null {
  const pu = dot(sub(p, band.a), band.dir);
  const qu = dot(sub(q, band.a), band.dir);
  const pv = dot(sub(p, band.a), band.n);
  const qv = dot(sub(q, band.a), band.n);
  const t = clip(pu, qu, EPS, band.length - EPS);
  return t && { u: [pu + t[0] * (qu - pu), pu + t[1] * (qu - pu)], v: [pv + t[0] * (qv - pv), pv + t[1] * (qv - pv)] };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

/**
 * Where a convex obstacle comes nearest the side, within its band, or null when it lies wholly behind the side
 * (v < −EPS). The obstacle is judged whole: one that straddles the side overlaps the piece and measures 0 at its near
 * face, where clipping each edge to v ≥ −EPS would find its far face. v is linear along each edge, so its minimum is
 * at an end of a clipped edge; an edge parallel to the side is measured nearest the side's middle, and of equally near
 * points the one nearest the side's middle wins (a face's middle, not the corner of the edge beside it).
 */
function obstacleHit(band: Band, quad: readonly Point[]): { u: number; v: number } | null {
  const spans = [];
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % quad.length];
    const span = p && q ? edgeSpan(band, p, q) : null;
    if (span) spans.push(span);
  }
  if (Math.max(...spans.flatMap((s) => s.v)) < -EPS) return null;
  const mid = band.length / 2;
  let best: { u: number; v: number } | null = null;
  for (const { u: [u0, u1], v: [v0, v1] } of spans) {
    const hit = Math.abs(v0 - v1) <= EPS
      ? { u: clamp(mid, Math.min(u0, u1), Math.max(u0, u1)), v: Math.min(v0, v1) }
      : v0 < v1 ? { u: u0, v: v0 } : { u: u1, v: v1 };
    const level = best !== null && Math.abs(hit.v - best.v) <= EPS;
    if (!best || (level ? Math.abs(hit.u - mid) < Math.abs(best.u - mid) : hit.v < best.v)) best = hit;
  }
  return best;
}

/** The nearest obstacle in front of one side; the first found wins a tie, so the order of `obstacles` decides. */
function sideGap(band: Band, obstacles: readonly Obstacle[]): ObstacleGap | null {
  let best: ObstacleGap | null = null;
  for (const o of obstacles) {
    const hit = obstacleHit(band, o.quad);
    if (!hit) continue;
    const gap = Math.max(0, hit.v);
    if (best && gap >= best.gap) continue;
    const from = add(band.a, scale(band.dir, hit.u));
    best = { gap, from, to: add(from, scale(band.n, gap)), obstacle: o.key };
  }
  return best;
}

/**
 * For each side of `quad` (front q0→q1, right q1→q2, back q2→q3, left q3→q0, as `footprints` orders corners), the
 * gap to the nearest wall body not in `excludeWalls` or footprint of `state` not in `exclude`, along the side's
 * outward normal. The caller
 * picks the axes by the quad: a footprint gives the piece's own, a bounding box the screen's. All four sides are
 * null when the quad's centre lies in no supported room. Hits are not filtered by the room: a line from inside a room
 * meets one of its own wall bodies before it leaves. Uses the floor walls' bodies (pillars.24), not `Zone.floor`, which
 * leaves out stub walls.
 * O(walls + footprints) per side, not memoised: its inputs change on every pointer move.
 */
export function nearestObstacles(doc: Document, quad: readonly Point[], state: string, exclude: ReadonlySet<string>, excludeWalls: ReadonlySet<string> = new Set()): SideGaps {
  const centre = quadCentre(quad);
  if (!centre || !faceAt(doc, centre)) return { front: null, right: null, back: null, left: null };
  // Walls before placements, each in ID order (the memoised maps are sorted): ties resolve the same way every time.
  const obstacles: Obstacle[] = [];
  for (const [id, body] of floorWallBodies(doc)) if (!excludeWalls.has(id)) obstacles.push({ key: wallKey(id), quad: body });
  for (const [id, footprint] of footprints(doc)) {
    if (doc.placements[id]?.state === state && !exclude.has(id) && !placementRug(doc, id)) obstacles.push({ key: placementKey(id), quad: footprint });
  }
  const side = (i: number): ObstacleGap | null => {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const band = a && b ? bandOf(a, b) : null;
    return band ? sideGap(band, obstacles) : null;
  };
  return { front: side(0), right: side(1), back: side(2), left: side(3) };
}
