import type { Point } from "@fm/protocol";
import { distanceToSegment, pointInPolygon } from "../geometry";
import { sortedIds } from "../graph";
import { EPS, type Document } from "../model";
import { AREA_UNAVAILABLE, insetFloor } from "./area";
import { boundedFaces, type BoundedFace, type Face } from "./faces";

/** Cached per document and shared by every caller: read-only down to the points. */
export type Zone = {
  readonly face: Face;
  readonly floor: readonly Readonly<Point>[] | null;
  readonly area: number | null;
  readonly unavailable: string | null;
  /** Labels resolved to this face, sorted by label ID. */
  readonly labelIds: readonly string[];
};

const UNSUPPORTED_BOUNDARY = "Area unavailable: unsupported boundary";

type Analysis = { faces: BoundedFace[]; zones: Zone[]; orphans: string[]; byLabel: Map<string, Zone> };
const memo = new WeakMap<Document, Analysis>();

function publicFace(f: BoundedFace): Face {
  return { key: f.key, jointIds: f.jointIds, wallIds: f.wallIds, ring: f.ring };
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
function containingFace(faces: BoundedFace[], p: Point): BoundedFace | null {
  let best: BoundedFace | null = null;
  for (const f of faces) {
    if (!onBoundary(p, f.ring) && !pointInPolygon(p, f.ring)) continue;
    if (!best || f.centreArea < best.centreArea) best = f;
  }
  return best && best.simple && !onBoundary(p, best.ring) ? best : null;
}

function analyse(doc: Document): Analysis {
  const cached = memo.get(doc);
  if (cached) return cached;
  const faces = boundedFaces(doc);
  const labelsByFace = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const id of sortedIds(doc.zoneLabels)) {
    const label = doc.zoneLabels[id];
    const face = label ? containingFace(faces, label.at) : null;
    if (face) labelsByFace.set(face.key, [...(labelsByFace.get(face.key) ?? []), id]);
    else orphans.push(id);
  }
  const zones = faces.map((f): Zone => {
    const labelIds = labelsByFace.get(f.key) ?? [];
    if (!f.simple) return { face: publicFace(f), floor: null, area: null, unavailable: UNSUPPORTED_BOUNDARY, labelIds };
    const inset = insetFloor(f.ring);
    return inset
      ? { face: publicFace(f), floor: inset.floor, area: inset.area, unavailable: null, labelIds }
      : { face: publicFace(f), floor: null, area: null, unavailable: AREA_UNAVAILABLE, labelIds };
  });
  const byLabel = new Map<string, Zone>();
  for (const z of zones) for (const id of z.labelIds) byLabel.set(id, z);
  const result = { faces, zones, orphans, byLabel };
  memo.set(doc, result);
  return result;
}

/**
 * Rooms derived from the walls, with clear floor areas and resolved labels (spec §3.6).
 * Documents are treated as immutable values: results are memoized by document identity, shared
 * between callers and read-only.
 */
export function zones(doc: Document): readonly Zone[] {
  return analyse(doc).zones;
}

/** The room holding this label, or null for an orphan or an unknown ID (spec §3.6): a lookup in the cached analysis. */
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
