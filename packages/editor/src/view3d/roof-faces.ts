import { roofCovering, roofOf, roofPlanes } from "@fm/domain";
import type { Document, Finish, Plane } from "@fm/domain";
import { finishGeometry, patternShows } from "../view/finish/geometry";
import { MIN_SPACING_3D } from "./pattern-faces";
import type { Point } from "@fm/protocol";
import { clipRing, heightOn, mix2 } from "./ceiling-clip";
import { sideShade } from "./prism";
import { finishShades, type Style3d } from "./style";
import type { Face3d, Line3d, Point3 } from "./types";
import { roofEdge } from "../view/roof-layer";

// The roof slab (roofs.13), drawn when this viewer's Roof switch is on: over the walls' box plus the overhang, its
// underside on the ceiling's planes and its top ROOF_THICKNESS above, one slab per plane (a gable's two meet at the
// ridge, where neither draws a side). Wound from outside like every solid (real3d.09).

/** The slab's thickness, measured up: a drawing value, not a build-up. */
export const ROOF_THICKNESS = 0.15;
const OWNER = "roof";
const EPS = 1e-9;

/** The part of the roof's outline under plane `i`: where it is the lowest of the planes. */
function partOf(outline: readonly Point[], planes: readonly Plane[], i: number): Point[] {
  const q = planes[i];
  if (!q) return [];
  return planes.filter((_, k) => k !== i).reduce<Point[]>((r, o) => clipRing(r, (p) => heightOn(q, p) - heightOn(o, p), mix2), [...outline]);
}

const ccw = (ring: readonly Point[]): Point[] => {
  const a = ring.reduce((s, p, i) => { const n = ring[(i + 1) % ring.length] ?? p; return s + p.x * n.y - n.x * p.y; }, 0);
  return a >= 0 ? [...ring] : [...ring].reverse();
};

/**
 * The covering's pattern on a slab's top (surfaces step 12): laid in the plane's own frame, u along the eave from the
 * part's lowest-left corner and v up the slope in true length from the eave, so courses keep their size on any pitch
 * (angle 0 along the eave, 90 down the slope); lifted `patternLift` above the top.
 */
function topPattern(ring: readonly Point[], q: Plane, covering: Finish, style: Style3d): { lines: Line3d[]; shapes: Face3d[] } {
  const g = Math.hypot(q.gx, q.gy);
  if (g < EPS) return { lines: [], shapes: [] };
  const up = { x: q.gx / g, y: q.gy / g }; // up the slope, in plan
  // Along the eave, the same way on every slope (+x, else +y), so a gable's two slopes lay their seams in line from the
  // box's lower left.
  const across = { x: up.y, y: -up.x };
  const eave = across.x > EPS || (Math.abs(across.x) <= EPS && across.y > 0) ? across : { x: -across.x, y: -across.y };
  const stretch = Math.sqrt(1 + g * g); // a plan step up the slope is this much longer on the roof
  const [u0, v0] = [Math.min(...ring.map((p) => p.x * eave.x + p.y * eave.y)), Math.min(...ring.map((p) => p.x * up.x + p.y * up.y))];
  const toUV = (p: Point): Point => ({ x: p.x * eave.x + p.y * eave.y - u0, y: (p.x * up.x + p.y * up.y - v0) * stretch });
  const geometry = finishGeometry(ring.map(toUV), [], covering);
  if (geometry.tooFine || !patternShows(geometry, MIN_SPACING_3D)) return { lines: [], shapes: [] };
  const world = (t: Point): Point3 => {
    const [s, r] = [t.x + u0, t.y / stretch + v0];
    const p = { x: eave.x * s + up.x * r, y: eave.y * s + up.y * r };
    return { ...p, z: heightOn(q, p) + ROOF_THICKNESS + style.patternLift };
  };
  const lines = geometry.lines.map((l): Line3d => ({ a: world(l.a), b: world(l.b), color: l.color }));
  const shapes = geometry.shapes.map((s): Face3d => ({ points: ccw(s.points.map((p) => ({ x: world(p).x, y: world(p).y }))).map((p) => ({ ...p, z: heightOn(q, p) + ROOF_THICKNESS + style.patternLift })), holes: [], color: s.color, owner: OWNER, outline: false }));
  return { lines, shapes };
}

function slab(part: readonly Point[], q: Plane, ridge: (a: Point, b: Point) => boolean, style: Style3d, covering: Finish | null): Face3d[] {
  const ring = ccw(part);
  if (ring.length < 3) return [];
  const under = (p: Point): Point3 => ({ x: p.x, y: p.y, z: heightOn(q, p) });
  const over = (p: Point): Point3 => ({ x: p.x, y: p.y, z: heightOn(q, p) + ROOF_THICKNESS });
  const shades = covering ? finishShades(covering.colour) : style.roof; // the top and edges in the covering (surfaces step 12)
  const pattern = covering ? topPattern(ring, q, covering, style) : { lines: [], shapes: [] };
  const top: Face3d = { points: ring.map(over), holes: [], color: shades.top, owner: OWNER };
  const faces: Face3d[] = [
    pattern.lines.length > 0 ? { ...top, lines: pattern.lines } : top,
    ...pattern.shapes,
    { points: [...ring].reverse().map(under), holes: [], color: style.roof.shaded, owner: OWNER },
  ];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    if (Math.hypot(b.x - a.x, b.y - a.y) < EPS || ridge(a, b)) return;
    const n = { x: (b.y - a.y), y: -(b.x - a.x) }; // outward for a counter-clockwise ring
    faces.push({ points: [under(a), under(b), over(b), over(a)], holes: [], color: sideShade(n, shades), owner: OWNER });
  });
  return faces;
}

/**
 * The roof's faces, or none under a flat ceiling or with no floor walls; with `finishes` (the viewer's switch, as for
 * floors and walls, surfaces.19) its covering on the top and edges.
 */
export function roofFaces(doc: Document, style: Style3d, finishes: boolean): Face3d[] {
  if (roofOf(doc).shape === "flat") return [];
  const outline = roofEdge(doc);
  if (outline.length === 0) return [];
  const planes = roofPlanes(doc);
  const [p0, p1] = planes;
  const covering = finishes ? roofCovering(doc) : null;
  // An edge on the ridge: where the two planes meet, so both its ends lie on both.
  const ridge = (a: Point, b: Point): boolean => p0 !== undefined && p1 !== undefined && [a, b].every((p) => Math.abs(heightOn(p0, p) - heightOn(p1, p)) < 1e-7);
  return planes.flatMap((q, i) => slab(partOf(outline, planes, i), q, ridge, style, covering));
}
