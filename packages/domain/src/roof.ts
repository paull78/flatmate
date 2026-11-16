import type { Point } from "@fm/protocol";
import { boxOf, type Box } from "./geometry";
import { memo } from "./memo";
import { CEILING_ID, DEFAULT_CEILING, isFloorWall, type Document } from "./model";
import { wallOutlines } from "./queries/outlines";
import { toMm } from "./format";
import type { Falls, RoofShape } from "./roof-shapes";
import type { Finish } from "./finishes";

// The roof (roofs.01–.07, .15, .17): a shed or gable whose underside is the ceiling, over the outer box of the floor's
// walls. One formula, `planes`, answers every ceiling height; the readers in queries/vertical.ts, the editor and MCP all
// come through here, so the slope is written once.

export { FALLS, ROOF_SHAPES, type Falls, type RoofShape } from "./roof-shapes";
/** The roof as read: every field filled. `height` is the flat ceiling, or a slope's low side. */
export type Roof = { shape: RoofShape; height: number; pitch: number; falls: Falls; overhang: number };

export const DEFAULT_PITCH = 10; // degrees, a tiny house shed's (roofs.04)
export const DEFAULT_OVERHANG = 0.3; // metres (roofs.08)
export const MIN_PITCH = 1;
export const MAX_PITCH = 60;
export const MAX_OVERHANG = 1;
export const MAX_HIGH_SIDE = 10;

/** The stored row with its defaults (roofs.20): a row without the new fields is today's flat ceiling. */
export function roofOf(doc: Document): Roof {
  const c = doc.ceilings[CEILING_ID];
  return { shape: c?.shape ?? "flat", height: c?.height ?? DEFAULT_CEILING, pitch: c?.pitch ?? DEFAULT_PITCH, falls: c?.falls ?? "-y", overhang: c?.overhang ?? DEFAULT_OVERHANG };
}

/** The roof's covering (surfaces step 11), as stored: kept while the ceiling is flat, drawn only under a slope. */
export function roofCovering(doc: Document): Finish | null {
  return doc.ceilings[CEILING_ID]?.covering ?? null;
}

/** The outer box of the walls standing on the floor, not columns (roofs.02), or null with none. */
export const roofBox = memo((doc: Document): Box | null => {
  const points: Point[] = [];
  for (const [id, ring] of wallOutlines(doc)) {
    const w = doc.walls[id];
    if (w && isFloorWall(w) && !w.column) points.push(...ring);
  }
  if (points.length === 0) return null;
  const b = boxOf(points);
  return { minX: mm(b.minX), minY: mm(b.minY), maxX: mm(b.maxX), maxY: mm(b.maxY) }; // whole mm, as every height
});

/** A ceiling plane: h = c + gx·x + gy·y. The ceiling is the lowest of a roof's planes (a gable is the lower of two). */
export type Plane = { c: number; gx: number; gy: number };

const tanOf = (degrees: number): number => Math.tan((degrees * Math.PI) / 180);
const alongY = (falls: Falls): boolean => falls === "-y" || falls === "+y";
/** The run the pitch climbs over: the box's span across the slope, half of it for a gable. */
const runOf = (roof: Roof, box: Box): number => (alongY(roof.falls) ? box.maxY - box.minY : box.maxX - box.minX) / (roof.shape === "gable" ? 2 : 1);

/** A plane rising at `t` from `low` on one side of the box, toward the opposite side. */
function rising(low: number, t: number, falls: Falls, box: Box): Plane {
  switch (falls) {
    case "-y": return { c: low - t * box.minY, gx: 0, gy: t };
    case "+y": return { c: low + t * box.maxY, gx: 0, gy: -t };
    case "-x": return { c: low - t * box.minX, gx: t, gy: 0 };
    case "+x": return { c: low + t * box.maxX, gx: -t, gy: 0 };
  }
}
const OPPOSITE: Record<Falls, Falls> = { "-y": "+y", "+y": "-y", "-x": "+x", "+x": "-x" };

export function planesOf(roof: Roof, box: Box | null): readonly Plane[] {
  if (roof.shape === "flat" || !box) return [{ c: roof.height, gx: 0, gy: 0 }];
  const t = tanOf(roof.pitch);
  const one = rising(roof.height, t, roof.falls, box);
  return roof.shape === "shed" ? [one] : [one, rising(roof.height, t, OPPOSITE[roof.falls], box)];
}

/** The ceiling's planes for this drawing, read by the 3D walls (roofs.16). */
export const roofPlanes = memo((doc: Document): readonly Plane[] => planesOf(roofOf(doc), roofBox(doc)));

const heightOn = (planes: readonly Plane[], p: Point): number => Math.min(...planes.map((q) => q.c + q.gx * p.x + q.gy * p.y));
const mm = (v: number): number => toMm(v) / 1000;

/** The ceiling at a point, in whole millimetres (roofs.17). */
export function ceilingAtPoint(doc: Document, p: Point): number {
  return mm(heightOn(roofPlanes(doc), p));
}

/** The high side: a shed's high wall or a gable's ridge, at the box's edge or middle; the height itself when flat. */
export function highSide(doc: Document): number {
  const roof = roofOf(doc);
  const box = roofBox(doc);
  return roof.shape === "flat" || !box ? roof.height : mm(roof.height + tanOf(roof.pitch) * runOf(roof, box));
}

/** The lowest ceiling along a segment: one of its ends, since every roof is concave (roofs.17). */
export function ceilingAlongSegment(doc: Document, a: Point, b: Point): number {
  return Math.min(ceilingAtPoint(doc, a), ceilingAtPoint(doc, b));
}

/** The lowest ceiling over an opening's span on its wall (roofs.17): the same rule as a segment. */
export const ceilingOverSpan = ceilingAlongSegment;

/** Where a gable's ridge crosses the segment a→b, or nothing. */
function ridgeCrossing(doc: Document, a: Point, b: Point): Point[] {
  const planes = roofPlanes(doc);
  const [p, q] = planes;
  if (!p || !q) return [];
  const da = p.c + p.gx * a.x + p.gy * a.y - (q.c + q.gx * a.x + q.gy * a.y);
  const db = p.c + p.gx * b.x + p.gy * b.y - (q.c + q.gx * b.x + q.gy * b.y);
  if (da * db > 0 || da === db) return [];
  const t = da / (da - db);
  return [{ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }];
}

/** The highest ceiling along a segment: an end, or where a gable's ridge crosses it. */
export function highestCeilingAlong(doc: Document, a: Point, b: Point): number {
  return Math.max(...[a, b, ...ridgeCrossing(doc, a, b)].map((p) => ceilingAtPoint(doc, p)));
}

/** The highest ceiling over a footprint: a corner, or a point where the ridge crosses its outline (roofs.17). */
export function highestCeilingOver(doc: Document, ring: readonly Point[]): number {
  if (ring.length === 0) return highSide(doc);
  return Math.max(...ring.map((a, i) => highestCeilingAlong(doc, a, ring[(i + 1) % ring.length] ?? a)));
}

/** One edit to a slope (roofs.03): the low side, the pitch or the high side; the other value stays or is solved. */
export type RoofEdit = { height: number } | { pitch: number } | { highSide: number };

/**
 * The stored pair after an edit: a low side keeps the pitch, a pitch keeps the low side, a high side keeps the low side
 * and solves the pitch over the current run. Null when a high side can't be solved (a flat ceiling or no box).
 */
export function solveRoof(roof: Roof, box: Box | null, edit: RoofEdit): { height: number; pitch: number } | null {
  if ("height" in edit) return { height: edit.height, pitch: roof.pitch };
  if ("pitch" in edit) return { height: roof.height, pitch: edit.pitch };
  if (roof.shape === "flat" || !box) return null;
  const run = runOf(roof, box);
  return run > 0 ? { height: roof.height, pitch: (Math.atan((edit.highSide - roof.height) / run) * 180) / Math.PI } : null;
}

/** The roof presets (roofs.04): rules of thumb from the research, each a shape, a low side and a pitch. */
export const ROOF_PRESETS = [
  { id: "tinyShed", label: "Tiny house shed", shape: "shed", height: 2.75, pitch: 10 },
  { id: "tinyGable", label: "Tiny house gable", shape: "gable", height: 2.3, pitch: 35 },
  { id: "smallShed", label: "Small home shed", shape: "shed", height: 2.5, pitch: 10 },
  { id: "smallGable", label: "Small home gable", shape: "gable", height: 2.5, pitch: 25 },
] as const satisfies readonly { id: string; label: string; shape: RoofShape; height: number; pitch: number }[];
export type RoofPreset = (typeof ROOF_PRESETS)[number];

/** The preset the roof matches to the shown centimetre and tenth of a degree, or null (as furniture presets, catalog.47). */
export function roofPresetOf(roof: Roof): RoofPreset | null {
  return ROOF_PRESETS.find((p) => p.shape === roof.shape && Math.round(p.height * 100) === Math.round(roof.height * 100) && Math.round(p.pitch * 10) === Math.round(roof.pitch * 10)) ?? null;
}

/** The sides a roof falls toward as the plan names them (roofs.05): no compass, north being a sheet setting. */
export const FALLS_LABELS: Record<Falls, string> = { "-y": "Bottom", "+y": "Top", "-x": "Left", "+x": "Right" };
