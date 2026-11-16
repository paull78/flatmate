import { add, distance, distanceToSegment, dot, fitShapes, footprints, kindOf, normalize, perpLeft, placementTuck, quadCentre, roundMm, scale, sub, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { pieceFit, type Piece } from "./piece";

// The tuck snap (seating.11, spec "Seating: the tuck rule"): a seat whose front comes within the tolerance of an edge
// of a piece it may tuck under, or overlaps it, turns square to that edge (at a round table, to face its centre) and
// slides in until its backrest (its kind's `seat` depth, pieces.09) is flush with the edge: fully tucked. Its place along the edge is kept.
// Stateless, from the gesture's start angle, like touch to turn. The edges are the piece's outline's (catalog.16): an
// `L`'s inner edges, never the seam between its arms nor its footprint's invisible sides.
//
//        table          n: the edge's outward normal
//   ┌────────────────┐
//   │     ┌────┐     │
//   └─────┼────┼─────┘  ← edge: the strip's front line
//         │▓▓▓▓│ ← strip   at, the back edge's middle, = the edge + n · backrest
//         └────┘

const TIE = 1e-9;

/** A tucked pose and how far the seat's front is from that edge now (negative when it crosses it). */
type Tucked = { at: Point; rotation: number; gap: number };
/** A tucked pose, the table it tucks under and the surface that table stands on, the turn to it, and its edge's order. */
type Candidate = Tucked & { table: string; deck: string | null; turn: number; order: number };
/** The moving seat at the start angle: its centre, width, front normal, back edge's middle and front corners, and its backrest's depth. */
type Seat = { centre: Point; w: number; front: Point; back: Point; corners: readonly [Point, Point]; backrest: number };

/** The front normal at rotation `r` (its front faces (sin r, −cos r)). */
const frontOf = (r: number): Point => ({ x: Math.sin((r * Math.PI) / 180), y: -Math.cos((r * Math.PI) / 180) });
/** Degrees in [0, 360); `+ 0` turns −0 into 0. */
const norm = (r: number): number => ((r % 360) + 360) % 360 + 0;
/** The rotation whose front faces `f`, cleaned of float noise. */
const facing = (f: Point): number => norm(Math.round(((Math.atan2(f.x, -f.y) * 180) / Math.PI) * 1e6) / 1e6);
/** Flush lands on an axis edge exactly; on a slanted one or a circle 1 mm out, so the millimetre anchor never ends inside. */
const margin = (n: Point): number => (Math.abs(n.x) < TIE || Math.abs(n.y) < TIE ? 0 : 0.001);
const mm = (p: Point): Point => ({ x: roundMm(p.x) + 0, y: roundMm(p.y) + 0 });

function seatAt(centre: Point, size: { w: number; d: number }, r: number, backrest: number): Seat {
  const front = frontOf(r);
  const right = { x: -front.y, y: front.x };
  const mid = add(centre, scale(front, size.d / 2));
  return { centre, w: size.w, front, back: add(centre, scale(front, -size.d / 2)), corners: [add(mid, scale(right, size.w / 2)), add(mid, scale(right, -size.w / 2))], backrest };
}

/**
 * The tucked pose against edge a→b of a counter-clockwise outline, or null unless the seat's front faces the edge, its
 * back is outside it, its nearer front corner is within `tol` of the edge's line (or across it) and, tucked with its
 * centre kept along the edge, it goes under the edge at least in part.
 */
function atEdge(seat: Seat, a: Point, b: Point, tol: number): Tucked | null {
  const dir = normalize(sub(b, a));
  if (!dir) return null;
  const n = scale(perpLeft(dir), -1); // outward: the outline runs counter-clockwise, so its outside is on the right
  const t = dot(sub(seat.centre, a), dir);
  const gap = Math.min(...seat.corners.map((c) => dot(sub(c, a), n)));
  if (dot(seat.front, n) >= -TIE || dot(sub(seat.back, a), n) <= TIE || gap > tol + TIE) return null;
  if (t <= -seat.w / 2 + TIE || t >= dot(sub(b, a), dir) + seat.w / 2 - TIE) return null;
  return { at: mm(add(add(a, scale(dir, t)), scale(n, seat.backrest + margin(n)))), rotation: facing(scale(n, -1)), gap };
}

/** The tucked pose at a round table centred on `o` with radius `radius`, facing its centre, or null (as `atEdge`). */
function atCircle(seat: Seat, o: Point, radius: number, tol: number): Tucked | null {
  const u = normalize(sub(seat.centre, o));
  const [c0, c1] = seat.corners;
  const gap = distanceToSegment(o, c0, c1) - radius;
  if (!u || dot(seat.front, u) >= -TIE || distance(seat.back, o) <= radius + TIE || gap > tol + TIE) return null;
  const rotation = norm(Math.round(facing(scale(u, -1)))); // whole degrees, as touch to turn
  return { at: mm(add(o, scale(frontOf(rotation), -(radius + seat.backrest + 0.001)))), rotation, gap };
}

/** The turn from `start` to `r`, folded to [−180, 180). */
const turn = (r: number, start: number): number => ((((r - start) % 360) + 540) % 360) - 180;

/**
 * Every tucked pose the seat could take in `layout`: nearest first (the front's gap, a crossing counting as 0), then
 * the smaller turn, as touch to turn, then table ID, then edge.
 */
function candidates(doc: Document, layout: string, seat: Seat, start: number, opts: { tolerance: number } & Piece): Candidate[] {
  const out: Candidate[] = [];
  const quads = footprints(doc);
  const outlines = fitShapes(doc);
  for (const [id, p] of Object.entries(doc.placements)) {
    if (p.state !== layout || (opts.ignore ?? []).includes(id) || placementTuck(doc, id) !== "under") continue;
    const quad = quads.get(id);
    const outline = outlines.get(id);
    const qc = quad ? quadCentre(quad) : null;
    const kind = doc.objects[p.object]?.kind;
    if (!quad || !outline || !qc || kind === undefined) continue;
    const next = (ring: readonly Point[], i: number): Point => ring[(i + 1) % ring.length] ?? qc;
    const poses = kindOf(kind)?.outline === "round"
      ? [atCircle(seat, qc, Math.min(...quad.map((q, i) => distance(q, next(quad, i)))) / 2, opts.tolerance)]
      : outline.map((a, i) => atEdge(seat, a, next(outline, i), opts.tolerance));
    poses.forEach((pose, order) => {
      if (pose) out.push({ ...pose, table: id, deck: p.deck, turn: Math.abs(turn(pose.rotation, start)), order });
    });
  }
  const near = (c: Candidate): number => Math.max(c.gap, 0);
  return out.sort((a, b) => {
    if (Math.abs(near(a) - near(b)) > TIE) return near(a) - near(b);
    if (Math.abs(a.turn - b.turn) > TIE) return a.turn - b.turn;
    return a.table < b.table ? -1 : a.table > b.table ? 1 : a.order - b.order;
  });
}

/**
 * Where a seat `size.w` × `size.d` centred on `centre` at `startRotation` tucks in `layout` (seating.11): the first
 * tucked pose, in `candidates`' order, under a piece it may tuck under (`seatsUnder` in the configuration that piece
 * shows) that fits by the tuck rule (`pieceFit` with the seat's role) on that piece's own surface; null for no snap.
 * Only for a seat kind (`opts.kind`); the caller skips it with Ctrl and for groups.
 */
export function tuckPlace(doc: Document, layout: string, size: { w: number; d: number }, centre: Point, startRotation: number,
  opts: { tolerance: number } & Piece): { at: Point; rotation: number } | null {
  const backrest = opts.kind === undefined ? null : (kindOf(opts.kind)?.seat ?? null);
  if (backrest === null) return null;
  for (const c of candidates(doc, layout, seatAt(centre, size, startRotation, backrest), startRotation, opts)) {
    const fit = pieceFit(doc, layout, opts, size, c.at, c.rotation);
    if (fit.fits && fit.landed.kind === "surface" && fit.landed.deck === c.deck) return { at: c.at, rotation: c.rotation };
  }
  return null;
}
