import {
  EPS, MAX_OBJECT_SIZE, MIN_ZONE_SIZE, add, armsFor, armsOf, dot, ellZoneLines, footprints, isValidId, normalize, perpLeft, roundMm, scale, sub, zoneExtent, zoneRings,
  type Document, type ResizeSide, type Side, type StripLines, type ZoneExtent,
} from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { ellOutline } from "./arm-drag";
import { flushTargets, pieceFlushTargets } from "./faces";
import { pickSnap } from "./picker";
import { roundTo } from "./policies";
import { sideOf, type ResizeOptions } from "./resize";

// A use zone's frame (furnish.15, .20): where one side's zone lies, for its handles, its "×" chip and its drag. The extent is the domain's resolved one (`zoneExtent`), so the frame's band is the band the outline draws.
// An `L` piece's front zone is two strips, each with its own frame (catalog.13): strip 0 along the left arm's inner
// edge from its front end (o1) to the inner corner (o2), trimmed by `start`; strip 1 along the back arm's inner edge
// from the inner corner (o2) to its right end (o3), trimmed by `end`. The inner corner is never trimmed.

/** An `L` front zone's strip: 0 in front of the left arm, 1 in front of the back arm. */
export type Strip = 0 | 1;

/**
 * One active side's zone, or one strip of an `L` front: the zone's resolved extent (what a drag commits), this band's
 * insets along it (a strip's at the inner corner is 0) and length, the band (a quad in a footprint's corner order:
 * front-left, front-right, back-right, back-left, as `sideOf` and `flushTargets` read it), the inner edge from the start
 * corner's end to the far end's, the outward unit normal, the unit direction from the start corner along the side, and
 * the side of the band quad each edge moves.
 */
export type ZoneFrame = {
  side: Side;
  strip: Strip | null;
  extent: ZoneExtent;
  insets: { start: number; end: number };
  length: number;
  band: readonly Point[];
  inner: readonly [Point, Point];
  normal: Point;
  along: Point;
  edges: Readonly<Record<ZoneEdge, ResizeSide>>;
};

/** The frame of a placement's zone on `side` (an `L` front's `strip`), or null when the piece, its object or that zone is missing or off. */
export function zoneFrame(doc: Document, placementId: string, side: Side, strip?: Strip): ZoneFrame | null {
  return zoneFrames(doc, placementId, side).find((f) => f.strip === (strip ?? null)) ?? null;
}

/** The frames of a placement's zone on `side`: one, an `L` front's two strips, or none when it is missing or off. */
export function zoneFrames(doc: Document, placementId: string, side: Side): ZoneFrame[] {
  const p = isValidId(placementId) ? doc.placements[placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  const w = p ? object?.w[p.config] : undefined;
  const d = p ? object?.d[p.config] : undefined;
  const quad = footprints(doc).get(placementId);
  const [q0, q1, q2, q3] = quad ?? [];
  const extent = p ? zoneExtent(doc, p, side) : null;
  const r = q0 && q1 ? normalize(sub(q1, q0)) : null;
  const b = q0 && q3 ? normalize(sub(q3, q0)) : null;
  if (!p || !p.sides[side] || w === undefined || d === undefined || !q0 || !q1 || !q2 || !q3 || !extent || !r || !b) return [];
  const ell = side === "front" ? ellOutline(doc, placementId) : null;
  const arms = ell && object ? armsFor(object.kind, w, d, armsOf(object) ?? undefined) : null;
  if (ell && arms) return ellFrames(ell, extent, [d - arms.back, w - arms.left]);
  const [origin, along, normal, length] = ((): [Point, Point, Point, number] => {
    switch (side) {
      case "front": return [q0, r, scale(b, -1), w];
      case "back": return [q3, r, b, w];
      case "left": return [q3, scale(b, -1), scale(r, -1), d];
      case "right": return [q2, scale(b, -1), r, d];
      default: return assertNever(side);
    }
  })();
  // As drawn: a zone off its deck's edge stops there (AC-05), so its handles do, and none shows for a zone with none left.
  const drawn = zoneRings(doc).get(placementId)?.find((z) => z.side === side)?.ring;
  if (!drawn) return [];
  const reach = Math.max(...drawn.map((q) => dot(sub(q, origin), normal)));
  const shown = reach < extent.depth - EPS ? { ...extent, depth: roundMm(reach) } : extent; // an uncut zone keeps its exact depth
  const { a, e, A, E } = bandCorners(origin, along, normal, length, shown.start, shown.end, shown.depth);
  const band = ((): Point[] => {
    switch (side) {
      case "front": return [A, E, e, a];
      case "back": return [a, e, E, A];
      case "left": return [E, e, a, A];
      case "right": return [e, E, A, a];
      default: return assertNever(side);
    }
  })();
  const ends: [ResizeSide, ResizeSide] = side === "front" || side === "back" ? ["left", "right"] : ["back", "front"];
  return [{ side, strip: null, extent: shown, insets: { start: shown.start, end: shown.end }, length, band, inner: [a, e], normal, along, edges: { depth: side, start: ends[0], end: ends[1] } }];
}

/** A band's corners: the inner edge's ends a and e, `start` and `length − end` along from `origin`, and A and E `depth` out. */
function bandCorners(origin: Point, along: Point, normal: Point, length: number, start: number, end: number, depth: number) {
  const a = add(origin, scale(along, start));
  const e = add(origin, scale(along, length - end));
  return { a, e, A: add(a, scale(normal, depth)), E: add(e, scale(normal, depth)) };
}

/**
 * An `L` front zone's two strip frames, from its placed outline (catalog.17's o1, o2, o3) and its inner edges' lengths
 * (exact, d − t1 and w − t2, as the domain's clamp reads them).
 */
function ellFrames(outline: readonly Point[], extent: ZoneExtent, lengths: readonly [number, number]): ZoneFrame[] {
  const [, o1, o2, o3] = outline;
  if (!o1 || !o2 || !o3) return [];
  const strip = (strip: Strip, from: Point, to: Point, insets: { start: number; end: number }): ZoneFrame[] => {
    const along = normalize(sub(to, from));
    if (!along) return [];
    const normal = scale(perpLeft(along), -1); // on the right of the counter-clockwise outline: into the empty quarter
    const length = lengths[strip];
    const { a, e, A, E } = bandCorners(from, along, normal, length, insets.start, insets.end, extent.depth);
    const [band, edges]: [Point[], Record<ZoneEdge, ResizeSide>] = strip === 0
      ? [[a, A, E, e], { depth: "right", start: "front", end: "back" }]
      : [[A, E, e, a], { depth: "front", start: "left", end: "right" }];
    return [{ side: "front", strip, extent, insets, length, band, inner: [a, e], normal, along, edges }];
  };
  return [...strip(0, o1, o2, { start: extent.start, end: 0 }), ...strip(1, o2, o3, { start: 0, end: extent.end })];
}

/**
 * Each strip of an `L` front zone's frames, [left, back] (`ellZoneLines`): its length, where its outer line and far
 * end lie on the zone's outline, and the point `s` from the inner corner along it and `out` from its inner edge.
 */
export function ellStripSpots(frames: readonly ZoneFrame[]): { frame: ZoneFrame; length: number; lines: StripLines; at: (s: number, out: number) => Point }[] {
  const lengths = frames.map((f) => f.length - f.insets.start - f.insets.end);
  const depth = frames[0]?.extent.depth ?? 0;
  const lines = ellZoneLines(lengths[0] ?? 0, lengths[1] ?? 0, depth);
  return frames.flatMap((frame, i) => {
    const l = lines[i];
    const [corner, away] = frame.strip === 0 ? [frame.inner[1], scale(frame.along, -1)] : [frame.inner[0], frame.along];
    const at = (s: number, out: number): Point => add(add(corner, scale(away, s)), scale(frame.normal, out));
    return l ? [{ frame, length: lengths[i] ?? 0, lines: l, at }] : [];
  });
}

/** The edge of a zone a handle moves: the outer edge (depth), or the end at the start or the far inset. */
type ZoneEdge = "depth" | "start" | "end";

/**
 * The extent a zone handle's drag by `delta` gives (furnish.15, .20): the edge moves like a resize grip on the band
 * quad, from the resolved (clamped) extent. With `free` (Ctrl) the cursor to the centimetre; otherwise a wall face,
 * then a face of another piece of `layout` (not the zone's own), within the tolerance, else whole steps from where it
 * started. Kept to the millimetre; the depth or length stays at least MIN_ZONE_SIZE and within its side.
 */
export function zoneDragExtent(doc: Document, layout: string | null, placementId: string, frame: ZoneFrame, edge: ZoneEdge, delta: Point, opts: Omit<ResizeOptions, "layout">): { depth: number; start: number; end: number } {
  const { depth } = frame.extent;
  const { start, end } = frame.insets;
  const L = frame.length;
  const bs = frame.edges[edge];
  const n = sideOf(frame.band, bs)?.normal;
  const along = n ? dot(delta, n) : 0;
  const s0 = edge === "depth" ? depth : L - start - end;
  const raw = s0 + along;
  const targets = opts.free ? [] : [
    ...flushTargets(doc, frame.band, bs, raw, opts.tolerance, opts.hiddenWalls),
    ...pieceFlushTargets(doc, frame.band, bs, raw, opts.tolerance, layout, new Set([placementId, ...opts.hidden])),
  ]; // walls first: a tie goes to the wall (direct.17)
  const picked = pickSnap({ targets, stepped: s0 + roundTo(along, opts.step), free: Math.round(raw * 100) / 100, ctrl: opts.free });
  const max = edge === "depth" ? MAX_OBJECT_SIZE : edge === "start" ? L - end : L - start;
  const v = Math.min(max, Math.max(MIN_ZONE_SIZE, roundMm(picked.value)));
  // The moved inset to the millimetre, but never so far that a clamped zone's unrounded other inset leaves it under
  // MIN_ZONE_SIZE long; + 0 turns −0 into 0, as the command stores it (furnish.56).
  const inset = (other: number): number => Math.max(0, Math.min(roundMm(L - other - v), L - other - MIN_ZONE_SIZE)) + 0;
  switch (edge) {
    case "depth": return { ...frame.extent, depth: v };
    case "start": return { ...frame.extent, start: inset(end) };
    case "end": return { ...frame.extent, end: inset(start) };
    default: return assertNever(edge);
  }
}
