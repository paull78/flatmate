import type { Point } from "@fm/protocol";
import {
  add, boxOf, cross, distanceToSegment, dot, isSimplePolygon, length, lineIntersection, normalize, perpLeft, pointInPolygon, projectOnSegment,
  scale, segmentIntersection, signedArea, sub, type Box,
} from "../geometry";
import { DEFAULT_WALL_THICKNESS, EPS } from "../model";

export const AREA_UNAVAILABLE = "Area unavailable: unsupported geometry";

/**
 * Drops vertices between collinear boundary segments that continue in the same direction and belong to walls of
 * the same thickness; `halves[i]` belongs to the edge from point i to point i + 1. A collinear vertex between
 * walls of different thickness stays: the inset keeps a step there (layout-states.27).
 */
function mergeCollinear(ring: readonly Point[], halves: readonly number[]): { points: Point[]; halves: number[] } | null {
  let points = [...ring];
  let hs = [...halves];
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const before = (i - 1 + points.length) % points.length;
      const prev = points[before];
      const cur = points[i];
      const nxt = points[(i + 1) % points.length];
      const hPrev = hs[before];
      const hCur = hs[i];
      if (!prev || !cur || !nxt || hPrev === undefined || hCur === undefined) return null;
      const u = sub(cur, prev);
      const v = sub(nxt, cur);
      if (Math.abs(cross(u, v)) > 1e-9 * length(u) * length(v)) continue;
      if (dot(u, v) < 0) return null; // the boundary folds back on itself
      if (Math.abs(hPrev - hCur) > 1e-12) continue; // a thickness step: keep the vertex
      points = points.filter((_, k) => k !== i);
      hs = hs.filter((_, k) => k !== i); // the edge before i now runs on to i + 1
      changed = true;
      break;
    }
  }
  return points.length >= 3 ? { points, halves: hs } : null;
}

/**
 * Offsets every boundary line of a centreline ring to its left by half its wall's thickness (`halves[i]` for the
 * edge from point i to point i + 1) and intersects consecutive lines. Where two collinear edges differ in thickness
 * the result takes a step across the vertex instead. Left is inward on a counter-clockwise ring (orientation 1) and
 * outward on a clockwise one (−1); the ring is never reversed. Accepted only when the result is simple, runs the
 * same way as the ring and every offset edge keeps its source direction. `area` is signed.
 */
function offsetRing(ring: readonly Point[], halves: readonly number[], orientation: 1 | -1): { floor: Point[]; area: number } | null {
  if (halves.length !== ring.length) return null;
  const merged = mergeCollinear(ring, halves);
  if (!merged) return null;
  const pts = merged.points;
  const n = pts.length;
  const lines: { p: Point; d: Point; n: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const half = merged.halves[i];
    const d = a && b ? normalize(sub(b, a)) : null;
    if (!a || !d || half === undefined) return null;
    const inward = scale(perpLeft(d), half);
    lines.push({ p: add(a, inward), d, n: inward });
  }
  // Where each line starts (`leave`) and the previous one ends (`enter`): one point at a corner, two at a step.
  const ends: { enter: Point; leave: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const before = lines[(i - 1 + n) % n];
    const here = lines[i];
    const at = pts[i];
    if (!before || !here || !at) return null;
    if (Math.abs(cross(before.d, here.d)) <= 1e-12 && dot(before.d, here.d) > 0) {
      ends.push({ enter: add(at, before.n), leave: add(at, here.n) }); // collinear, different thickness
      continue;
    }
    const q = lineIntersection(before.p, before.d, here.p, here.d);
    if (!q) return null;
    ends.push({ enter: q, leave: q });
  }
  for (let i = 0; i < n; i++) {
    const a = ends[i]?.leave;
    const b = ends[(i + 1) % n]?.enter;
    const src = lines[i];
    if (!a || !b || !src) return null;
    const e = sub(b, a);
    if (length(e) <= 1e-9 || dot(e, src.d) <= 0) return null;
  }
  const floor = ends.flatMap((e) => (e.enter === e.leave ? [e.enter] : [e.enter, e.leave]));
  const area = signedArea(floor);
  if (orientation * area <= 0 || !isSimplePolygon(floor)) return null;
  return { floor, area };
}

/**
 * Clear floor polygon of a counter-clockwise centreline ring (spec: walls-rooms steps 4–5): every boundary line inset by
 * half its wall's thickness (0.10 m each when `halves` is omitted). Null when the inset folds, is not simple or
 * has no positive area.
 */
export function insetFloor(
  ring: readonly Point[],
  halves: readonly number[] = ring.map(() => DEFAULT_WALL_THICKNESS / 2),
): { floor: Point[]; area: number } | null {
  return offsetRing(ring, halves, 1);
}

/**
 * A hole's footprint (holes.04): its clockwise outline pushed out by half of each wall's thickness, the outer face
 * of the group's walls. `footprint` stays clockwise; `area` is its magnitude. Null when the offset fails the same
 * checks as `insetFloor`.
 */
export function holeFootprint(ring: readonly Point[], halves: readonly number[]): { footprint: Point[]; area: number } | null {
  const r = offsetRing(ring, halves, -1);
  return r ? { footprint: r.floor, area: -r.area } : null;
}

type Ring = readonly Readonly<Point>[];

function edgesOf(ring: Ring): [Point, Point][] {
  const out: [Point, Point][] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (b) out.push([a, b]);
  });
  return out;
}

function nearBoundary(p: Point, ring: Ring): boolean {
  return edgesOf(ring).some(([a, b]) => distanceToSegment(p, a, b) <= EPS);
}

/** Inside the ring and more than EPS from its boundary. */
function deepInside(p: Point, ring: Ring): boolean {
  return pointInPolygon(p, ring) && !nearBoundary(p, ring);
}

/** Outside the ring and more than EPS from its boundary. */
function deepOutside(p: Point, ring: Ring): boolean {
  return !pointInPolygon(p, ring) && !nearBoundary(p, ring);
}

/**
 * Points that stand for r's boundary against s: r's vertices, and the middle of each piece of r's edges between
 * the places where s's boundary meets them. Each piece lies wholly inside s, outside it or along its boundary, so
 * its middle tells which; depth is tested at the middle only. Vertices alone miss two footprints of equal height
 * that overlap side by side: every corner of one sits on an edge of the other.
 */
function boundarySamples(r: Ring, s: Ring): Point[] {
  const sEdges = edgesOf(s);
  const out: Point[] = [...r];
  for (const [a, b] of edgesOf(r)) {
    const ts = [0, 1];
    for (const [c, d] of sEdges) {
      const hit = segmentIntersection(a, b, c, d);
      // An overlap cuts at the collinear stretch's ends; s's neighbouring edges usually cut there too, but not when near-parallel.
      if (hit.kind === "point") ts.push(Math.min(1, Math.max(0, hit.t)));
      else if (hit.kind === "overlap") ts.push(projectOnSegment(c, a, b).t, projectOnSegment(d, a, b).t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) out.push(add(a, scale(sub(b, a), ((ts[i - 1] ?? 0) + (ts[i] ?? 0)) / 2)));
  }
  return out;
}

function boxesApart(r: Box, s: Box): boolean {
  return r.minX > s.maxX + EPS || s.minX > r.maxX + EPS || r.minY > s.maxY + EPS || s.minY > r.maxY + EPS;
}

/**
 * Whether hole footprints sit inside a room's clear floor and clear of each other, touching within EPS allowed
 * (holes.06): no point of a footprint's boundary deep outside the floor (this also rejects a footprint that
 * covers the floor), none of the floor's deep inside a footprint (a backstop for the sampling), and no point of
 * one footprint's boundary deep inside another. Sampling at the cuts also catches an edge that bridges a notch of
 * an L or U floor while both its ends sit inside.
 */
export function footprintsFit(floor: Ring, footprints: readonly Ring[]): boolean {
  for (const f of footprints) {
    if (boundarySamples(f, floor).some((v) => deepOutside(v, floor)) || boundarySamples(floor, f).some((v) => deepInside(v, f))) return false;
  }
  const boxes = footprints.map((f) => boxOf(f));
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const f = footprints[i];
      const g = footprints[j];
      const fb = boxes[i];
      const gb = boxes[j];
      if (!f || !g || !fb || !gb || boxesApart(fb, gb)) continue;
      if (boundarySamples(f, g).some((v) => deepInside(v, g)) || boundarySamples(g, f).some((v) => deepInside(v, f))) return false;
    }
  }
  return true;
}
