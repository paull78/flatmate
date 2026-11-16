import type { Point } from "@fm/protocol";
import { distanceToSegment, inBox, pointInPolygon, signedArea } from "../geometry";
import { sortedIds } from "../graph";
import { memo } from "../memo";
import { DEFAULT_WALL_THICKNESS, EPS, type Document } from "../model";
import { AREA_UNAVAILABLE, footprintsFit, holeFootprint, insetFloor } from "./area";
import { BOX_MARGIN, facesNear, indexFaces, type FaceIndex } from "./face-index";
import { boundedFaces, type BoundedFace, type Face } from "./faces";

/**
 * A hole of a room (holes.04): its outline (centreline ring, decides which room a point is in) and its footprint
 * (the outline pushed out by half of each wall's thickness, taken off the floor), null when the area is unavailable.
 * A free column's outline and footprint are both its body (pillars.01).
 */
export type ZoneHole = { readonly outline: readonly Readonly<Point>[]; readonly footprint: readonly Readonly<Point>[] | null };

/** Cached per document and shared by every caller: read-only down to the points. */
export type Zone = {
  readonly face: Face;
  /** The outer clear floor; the holes' footprints are not cut out of it. */
  readonly floor: readonly Readonly<Point>[] | null;
  /** Net clear area: the floor less every hole's footprint. */
  readonly area: number | null;
  readonly unavailable: string | null;
  /** Labels resolved to this face, sorted by label ID. */
  readonly labelIds: readonly string[];
  /** In `face.holes` order. */
  readonly holes: readonly ZoneHole[];
};

const UNSUPPORTED_BOUNDARY = "Area unavailable: unsupported boundary";

type Analysis = { faces: FaceIndex<BoundedFace>; zones: Zone[]; orphans: string[]; byLabel: Map<string, Zone> };

function publicFace(f: BoundedFace): Face {
  return { key: f.key, jointIds: f.jointIds, wallIds: f.wallIds, ring: f.ring, holes: f.holes };
}

function onBoundary(p: Point, ring: readonly Readonly<Point>[]): boolean {
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return b !== undefined && distanceToSegment(p, a, b) < EPS;
  });
}

/**
 * The innermost face around p (the smallest by centre area, boundary included), or null when p is
 * within EPS of its boundary or that face is not simple. An unsupported inner room does not fall
 * back to the room around it.
 */
function containingFace(index: FaceIndex<BoundedFace>, p: Point): BoundedFace | null {
  let best: BoundedFace | null = null;
  for (const f of facesNear(index, p)) {
    if (!inBox(p, f.box, BOX_MARGIN)) continue; // outside the box: neither on the boundary nor inside
    if (!onBoundary(p, f.ring) && !pointInPolygon(p, f.ring)) continue;
    if (!best || f.centreArea < best.centreArea) best = f;
  }
  return best && best.simple && !onBoundary(p, best.ring) ? best : null;
}

const analyse = memo((doc: Document): Analysis => {
  const faces = boundedFaces(doc);
  const index = indexFaces(faces);
  const labelsByFace = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const id of sortedIds(doc.zoneLabels)) {
    const label = doc.zoneLabels[id];
    const face = label ? containingFace(index, label.at) : null;
    if (face) labelsByFace.set(face.key, [...(labelsByFace.get(face.key) ?? []), id]);
    else orphans.push(id);
  }
  const half = (id: string): number => (doc.walls[id]?.thickness ?? DEFAULT_WALL_THICKNESS) / 2;
  const zones = faces.map((f): Zone => {
    const labelIds = labelsByFace.get(f.key) ?? [];
    const outlines = f.holes.map((h): ZoneHole => ({ outline: h.ring, footprint: null }));
    const unavailable = (reason: string): Zone => ({ face: publicFace(f), floor: null, area: null, unavailable: reason, labelIds, holes: outlines });
    if (!f.simple) return unavailable(UNSUPPORTED_BOUNDARY);
    // Ring edge i runs from joint i along wall i; each edge insets (or, round a hole, outsets) by its own wall's half thickness (spec: walls-rooms).
    const inset = insetFloor(f.ring, f.wallIds.map(half));
    // A free column's ring is its body already: its footprint as is (pillars.01).
    const footprints = f.holes.map((h) => (h.column ? { footprint: h.ring, area: -signedArea(h.ring) } : holeFootprint(h.ring, h.wallIds.map(half))));
    const fitted = footprints.flatMap((r) => (r ? [r] : []));
    if (!inset || fitted.length < footprints.length || !footprintsFit(inset.floor, fitted.map((r) => r.footprint))) return unavailable(AREA_UNAVAILABLE);
    const holes = f.holes.map((h, i): ZoneHole => ({ outline: h.ring, footprint: fitted[i]?.footprint ?? null }));
    const area = fitted.reduce((sum, r) => sum - r.area, inset.area);
    // Footprints that fill the floor (touching within EPS) leave no floor, as an inset with no positive area.
    if (area <= EPS * EPS) return unavailable(AREA_UNAVAILABLE);
    return { face: publicFace(f), floor: inset.floor, area, unavailable: null, labelIds, holes };
  });
  const byLabel = new Map<string, Zone>();
  for (const z of zones) for (const id of z.labelIds) byLabel.set(id, z);
  return { faces: index, zones, orphans, byLabel };
});

/**
 * Rooms derived from the walls, with clear floor areas and resolved labels (spec: walls-rooms).
 * Documents are treated as immutable values: results are memoized by document identity, shared
 * between callers and read-only.
 */
export function zones(doc: Document): readonly Zone[] {
  return analyse(doc).zones;
}

/** The room holding this label, or null for an orphan or an unknown ID (spec: walls-rooms): a lookup in the cached analysis. */
export function zoneOfLabel(doc: Document, labelId: string): Zone | null {
  return analyse(doc).byLabel.get(labelId) ?? null;
}

/**
 * Labels that resolve to no supported face ("no enclosing walls"), sorted by ID: outside every face,
 * within EPS of a boundary, or inside an unsupported face. Memoized by document identity like
 * `zones`: the result is shared and read-only.
 */
export function orphanLabelIds(doc: Document): readonly string[] {
  return analyse(doc).orphans;
}

/**
 * The supported face containing p; null outside every face, within EPS of a boundary, or inside an
 * unsupported face. Memoized by document identity like `zones`: the ring is shared and read-only.
 */
export function faceAt(doc: Document, p: Point): Face | null {
  const f = containingFace(analyse(doc).faces, p);
  return f ? publicFace(f) : null;
}
