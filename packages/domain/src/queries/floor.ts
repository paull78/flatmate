import type { Point } from "@fm/protocol";
import { distanceToSegment, pointInPolygon, signedArea } from "../geometry";
import { EPS } from "../model";
import type { Zone } from "./zones";

type Ring = readonly Readonly<Point>[];

/** A later span must be wider than the best by more than this, so of equal spans the first (leftmost or lowest) wins. */
const SPAN_TIE = 1e-9;

/** The rings that bound the floor: the outer floor and hole footprints, or centreline rings when the area is unavailable. */
export function floorRings(zone: Zone): { outer: Ring; holes: Ring[] } {
  return {
    outer: zone.floor ?? zone.face.ring,
    holes: zone.holes.map((h) => (zone.floor === null ? h.outline : (h.footprint ?? h.outline))),
  };
}

function inside(p: Point, outer: Ring, holes: readonly Ring[]): boolean {
  return pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
}

/** Inside, and at least EPS from every ring's edges, so a candidate never sits on a wall face. */
function clearlyInside(p: Point, outer: Ring, holes: readonly Ring[]): boolean {
  const nearEdge = (ring: Ring): boolean =>
    ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length];
      return b !== undefined && distanceToSegment(p, a, b) < EPS;
    });
  return inside(p, outer, holes) && !nearEdge(outer) && !holes.some(nearEdge);
}

/**
 * Whether p is on the room's floor (holes.04): inside its outer floor and in no hole footprint. When the area is
 * unavailable, the room's centreline ring and the holes' outlines stand in. Boundary points may go either way.
 */
export function onFloor(zone: Zone, p: Point): boolean {
  const { outer, holes } = floorRings(zone);
  return inside(p, outer, holes);
}

/**
 * A point on the room's floor (holes.04), the first of: the floor's centroid, the midpoint of the widest horizontal
 * span through it, the midpoint of the widest vertical span through it (spans split at holes). A candidate within EPS
 * of the floor's or a footprint's edge doesn't count. Null if none is.
 */
export function interiorPoint(zone: Zone): Point | null {
  const { outer, holes } = floorRings(zone);
  const c = centroid(outer);
  if (!c) return null;
  if (clearlyInside(c, outer, holes)) return c;
  const rings = [outer, ...holes];
  for (const line of ["horizontal", "vertical"] as const) {
    const p = widestSpanMidpoint(rings, line, c);
    if (p && clearlyInside(p, outer, holes)) return p;
  }
  return null;
}

/** The area centroid of a simple ring; null for a ring with no area. */
export function centroid(ring: Ring): Point | null {
  const a = signedArea(ring);
  if (a === 0) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (!p || !q) continue;
    const c = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/**
 * The midpoint of the widest interior span of the horizontal (or vertical) line through `through`, crossing every
 * ring's edges. Spans no wider than 2·EPS (slivers where a footprint touches the floor) don't count.
 */
function widestSpanMidpoint(rings: readonly Ring[], line: "horizontal" | "vertical", through: Point): Point | null {
  const along = (p: Readonly<Point>): number => (line === "horizontal" ? p.x : p.y);
  const across = (p: Readonly<Point>): number => (line === "horizontal" ? p.y : p.x);
  const at = across(through);
  const cuts: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (p && q && across(p) > at !== across(q) > at) cuts.push(along(p) + ((at - across(p)) * (along(q) - along(p))) / (across(q) - across(p)));
    }
  }
  cuts.sort((u, v) => u - v);
  let best: number | null = null;
  let widest = 0;
  for (let i = 0; i + 1 < cuts.length; i += 2) {
    const u = cuts[i];
    const v = cuts[i + 1];
    if (u === undefined || v === undefined || v - u <= 2 * EPS) continue;
    if (best === null || v - u > widest + SPAN_TIE) {
      widest = v - u;
      best = (u + v) / 2;
    }
  }
  if (best === null) return null;
  return line === "horizontal" ? { x: best, y: at } : { x: at, y: best };
}
