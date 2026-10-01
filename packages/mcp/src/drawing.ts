import { orphanLabelIds, sortedIds, zones, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";

// What get_drawing and every successful edit return (spec §12.4): a compact JSON summary in metres (areas in m²),
// listed in full up to MAX_LISTED_WALLS walls, otherwise an overview with counts and bounds.

type XY = [number, number];
export type ProjectSummary = { id: string; name: string; status: string };
export type Region = { min: Point; max: Point };
export type DrawingCounts = { walls: number; joints: number; rooms: number; labels: number; unplacedLabels: number };
export type DrawingSummary = {
  project: ProjectSummary;
  units: "m";
  counts: DrawingCounts;
  walls: { id: string; a: string; b: string; from: XY; to: XY; length: number }[];
  joints: { id: string; at: XY }[];
  rooms: { labels: { id: string; name: string }[]; area: number | null; note?: string; outline: XY[] }[];
  unplacedLabels: { id: string; name: string; at: XY }[];
};
export type DrawingOverview = {
  project: ProjectSummary;
  units: "m";
  counts: DrawingCounts;
  bounds: { min: XY; max: XY } | null;
  hint: string;
};

/** Above this many walls (in the drawing, or in the region asked for) a reply is an overview, not a listing. */
export const MAX_LISTED_WALLS = 300;

const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const xy = (p: Readonly<Point>): XY => [round(p.x, 3), round(p.y, 3)];

const inside = (p: Readonly<Point>, r: Region): boolean => p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;

/** Whether the extent (bounding box) of these points touches the region. */
function touches(points: readonly Readonly<Point>[], r: Region): boolean {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.min(...xs) <= r.max.x && Math.max(...xs) >= r.min.x && Math.min(...ys) <= r.max.y && Math.max(...ys) >= r.min.y;
}

function boundsOf(doc: Document): DrawingOverview["bounds"] {
  let box: { min: Point; max: Point } | null = null;
  for (const j of Object.values(doc.joints)) {
    box = box
      ? { min: { x: Math.min(box.min.x, j.x), y: Math.min(box.min.y, j.y) }, max: { x: Math.max(box.max.x, j.x), y: Math.max(box.max.y, j.y) } }
      : { min: j, max: j };
  }
  return box && { min: xy(box.min), max: xy(box.max) };
}

export function summarize(project: ProjectSummary, doc: Document, region?: Region): DrawingSummary | DrawingOverview {
  const rooms = zones(doc);
  const orphans = orphanLabelIds(doc);
  const counts: DrawingCounts = {
    walls: Object.keys(doc.walls).length,
    joints: Object.keys(doc.joints).length,
    rooms: rooms.length,
    labels: Object.keys(doc.zoneLabels).length,
    unplacedLabels: orphans.length,
  };
  const overview = (hint: string): DrawingOverview => ({ project, units: "m", counts, bounds: boundsOf(doc), hint });
  if (region === undefined && counts.walls > MAX_LISTED_WALLS) {
    return overview(
      `Too large to list: ${counts.walls} walls (the limit is ${MAX_LISTED_WALLS}). Pass a region { min, max } to get_drawing to list part of it.`,
    );
  }

  const walls: DrawingSummary["walls"] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const a = w ? doc.joints[w.a] : undefined;
    const b = w ? doc.joints[w.b] : undefined;
    if (!w || !a || !b) continue; // a valid document has none
    if (region && !touches([a, b], region)) continue;
    walls.push({ id, a: w.a, b: w.b, from: xy(a), to: xy(b), length: round(Math.hypot(b.x - a.x, b.y - a.y), 3) });
  }
  if (region && walls.length > MAX_LISTED_WALLS) {
    return overview(`The region holds ${walls.length} walls (the limit is ${MAX_LISTED_WALLS}): narrow it.`);
  }
  const joints = sortedIds(doc.joints).flatMap((id) => {
    const j = doc.joints[id];
    return j && (!region || inside(j, region)) ? [{ id, at: xy(j) }] : [];
  });
  const labelOf = (id: string): { id: string; name: string } => ({ id, name: doc.zoneLabels[id]?.name ?? "" });
  const listedRooms = rooms
    .filter((z) => !region || touches(z.face.ring, region))
    .map((z) => ({
      labels: z.labelIds.map(labelOf),
      area: z.area === null ? null : round(z.area, 2),
      ...(z.unavailable === null ? {} : { note: z.unavailable }),
      outline: z.face.ring.map(xy),
    }));
  const unplacedLabels = orphans.flatMap((id) => {
    const l = doc.zoneLabels[id];
    return l && (!region || inside(l.at, region)) ? [{ id, name: l.name, at: xy(l.at) }] : [];
  });
  return { project, units: "m", counts, walls, joints, rooms: listedRooms, unplacedLabels };
}
