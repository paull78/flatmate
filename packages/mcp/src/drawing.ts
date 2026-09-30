import { orphanLabelIds, sortedIds, zones, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";

// What get_drawing and every successful edit return: a compact JSON summary in metres (areas in m²).

type XY = [number, number];
export type ProjectSummary = { id: string; name: string; status: string };
export type DrawingSummary = {
  project: ProjectSummary;
  units: "m";
  walls: { id: string; a: string; b: string; from: XY; to: XY; length: number }[];
  joints: { id: string; at: XY }[];
  rooms: { labels: { id: string; name: string }[]; area: number | null; note?: string; outline: XY[] }[];
  unplacedLabels: { id: string; name: string; at: XY }[];
};

const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const xy = (p: Readonly<Point>): XY => [round(p.x, 3), round(p.y, 3)];

export function summarize(project: ProjectSummary, doc: Document): DrawingSummary {
  const walls: DrawingSummary["walls"] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const a = w ? doc.joints[w.a] : undefined;
    const b = w ? doc.joints[w.b] : undefined;
    if (!w || !a || !b) continue; // a valid document has none
    walls.push({ id, a: w.a, b: w.b, from: xy(a), to: xy(b), length: round(Math.hypot(b.x - a.x, b.y - a.y), 3) });
  }
  const joints = sortedIds(doc.joints).flatMap((id) => {
    const j = doc.joints[id];
    return j ? [{ id, at: xy(j) }] : [];
  });
  const labelOf = (id: string): { id: string; name: string } => ({ id, name: doc.zoneLabels[id]?.name ?? "" });
  const rooms = zones(doc).map((z) => ({
    labels: z.labelIds.map(labelOf),
    area: z.area === null ? null : round(z.area, 2),
    ...(z.unavailable === null ? {} : { note: z.unavailable }),
    outline: z.face.ring.map(xy),
  }));
  const unplacedLabels = orphanLabelIds(doc).flatMap((id) => {
    const l = doc.zoneLabels[id];
    return l ? [{ id, name: l.name, at: xy(l.at) }] : [];
  });
  return { project, units: "m", walls, joints, rooms, unplacedLabels };
}
