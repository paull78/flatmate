import { distanceToSegment, UNDERLAY_ID, wallEnds, zones, type Document } from "@fm/domain";
import { pictureBounds } from "@fm/editor";
import type { Point } from "@fm/protocol";

// AC-15's comparison (import.18): a traced drawing passes when it has the same rooms and every outer wall of the truth
// lies within the tolerance of some traced wall. The traced drawing is moved by a given offset, never fitted: fitting
// (say, aligning bounding-box centres) would absorb half of any error, so a side 0.15 m out would score 0.075 and pass.

export type TraceReport = {
  pass: boolean;
  /** Why the comparison could not run (a trace with no walls, or with no underlay to register by), else null. */
  reason: string | null;
  offset: Point;
  max: number;
  rooms: { truth: string[]; traced: string[]; pass: boolean };
  walls: { wallId: string; deviation: number; pass: boolean }[];
};

// Metres along each truth wall. The distance to the nearest traced wall changes by at most the distance moved, so the
// true largest deviation exceeds the sampled one by at most half a step (2.5 mm).
const SAMPLE_STEP = 0.005;
const UNNAMED = "(unnamed)";

/**
 * The walls with a room on one side only: ids that occur exactly once across the rooms' outlines. A partition occurs
 * twice (once per room) and a dangling spur twice in one outline. A hole (a column drawn as four walls) is a room of
 * its own, so its walls occur once too: they are left out by name.
 */
export function outerWallIds(doc: Document): string[] {
  const count = new Map<string, number>();
  const inHoles = new Set<string>();
  for (const z of zones(doc)) {
    for (const id of z.face.wallIds) count.set(id, (count.get(id) ?? 0) + 1);
    for (const h of z.face.holes) for (const id of h.wallIds) inHoles.add(id);
  }
  return [...count].filter(([id, n]) => n === 1 && !inHoles.has(id)).map(([id]) => id).sort();
}

/**
 * Each outer truth wall's deviation: the largest, over samples every 5 mm along its centreline and both ends, of the
 * distance to the nearest traced centreline of any wall (traced walls split at other T-junctions than the truth's).
 */
export function compareTrace(truth: Document, traced: Document, offset: Point = { x: 0, y: 0 }, tolerance = 0.1): TraceReport {
  const segments = Object.keys(traced.walls).flatMap((id) => {
    const ends = wallEnds(traced, id);
    return ends ? [{ a: shift(ends.a, offset), b: shift(ends.b, offset) }] : [];
  });
  const rooms = { truth: roomNames(truth), traced: roomNames(traced) };
  const roomsPass = rooms.truth.length === rooms.traced.length && rooms.truth.every((n, i) => n === rooms.traced[i]);
  if (segments.length === 0) {
    return { pass: false, reason: "the trace has no walls", offset, max: 0, rooms: { ...rooms, pass: roomsPass }, walls: [] };
  }
  const nearest = (p: Point): number => Math.min(...segments.map((s) => distanceToSegment(p, s.a, s.b)));
  const walls = outerWallIds(truth).flatMap((wallId) => {
    const ends = wallEnds(truth, wallId);
    if (!ends) return [];
    const deviation = Math.max(...samples(ends.a, ends.b).map(nearest));
    return [{ wallId, deviation, pass: deviation <= tolerance }];
  });
  return {
    pass: roomsPass && walls.every((w) => w.pass),
    reason: null,
    offset,
    max: Math.max(0, ...walls.map((w) => w.deviation)),
    rooms: { ...rooms, pass: roomsPass },
    walls,
  };
}

/**
 * The top-left of the truth's PNG export: its frame is pictureBounds (editor export/panel.ts svgContent), and the
 * ground truth has no furniture, so the layout doesn't matter.
 */
export function truthTopLeft(truth: Document): Point {
  const b = pictureBounds(truth, null);
  return { x: b.min.x, y: b.max.y };
}

/**
 * The translation that takes the traced drawing into the truth's frame: the underlay row's `at` is the picture's
 * top-left before and after any scaling (import.11), and that picture is the truth's export. Null without a row.
 */
export function underlayOffset(truth: Document, traced: Document): Point | null {
  const row = traced.underlays[UNDERLAY_ID];
  if (!row) return null;
  const tl = truthTopLeft(truth);
  return { x: tl.x - row.at.x, y: tl.y - row.at.y };
}

/**
 * AC-15 for a trace over the truth's PNG dropped anywhere: registered through the underlay, translation only, so a
 * scale error shows, growing with the distance from the picture's top-left.
 */
export function compareTraceByUnderlay(truth: Document, traced: Document, tolerance = 0.1): TraceReport {
  const offset = underlayOffset(truth, traced);
  if (offset) return compareTrace(truth, traced, offset, tolerance);
  const rooms = compareTrace(truth, traced, { x: 0, y: 0 }, tolerance).rooms;
  return { pass: false, reason: "The traced drawing has no underlay", offset: { x: 0, y: 0 }, max: 0, rooms, walls: [] };
}

function shift(p: Point, by: Point): Point {
  return { x: p.x + by.x, y: p.y + by.y };
}

function samples(a: Point, b: Point): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const out: Point[] = [];
  for (let k = 0; k * SAMPLE_STEP < length; k++) {
    const t = (k * SAMPLE_STEP) / length;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  out.push(b);
  return out;
}

/** One name per room, sorted: its labels trimmed, lower-cased, sorted and joined by " / ", or "(unnamed)". */
function roomNames(doc: Document): string[] {
  return zones(doc)
    .map((z) => {
      const names = z.labelIds.map((id) => (doc.zoneLabels[id]?.name ?? "").trim().toLowerCase()).sort();
      return names.length === 0 ? UNNAMED : names.join(" / ");
    })
    .sort();
}
