import { MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, cross, dot, fitShapes, footprints, normalize, outlineOf, perpLeft, placementRug, sortedIds, sub, wallBodies, type Document, type ResizeSide } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { SnapTarget } from "./picker";

// Flush-to-face targets for a resize (direct.06, direct.19): the sizes at which the grabbed side of a footprint meets
// a wall face ahead of it, as the side moves along its outward normal and the opposite side stays put. A side is in
// the footprint's own axes: "right" is local +x, "back" local +y (the front faces local −y).

const PARALLEL_SIN = Math.sin(Math.PI / 180); // a face counts within 1° of the side

/**
 * The fixed edge of a footprint quad (corners: front-left, front-right, back-right, back-left) and the unit direction
 * in which `side` moves, or null for a degenerate quad.
 */
function sideFrame(quad: readonly Point[], side: ResizeSide): { fixed: [Point, Point]; n: Point } | null {
  const [q0, q1, q2, q3] = quad;
  if (!q0 || !q1 || !q2 || !q3) return null;
  const frame = (fixed: [Point, Point], from: Point, to: Point) => {
    const n = normalize(sub(to, from));
    return n ? { fixed, n } : null;
  };
  switch (side) {
    case "right":
      return frame([q3, q0], q0, q1);
    case "left":
      return frame([q1, q2], q1, q0);
    case "back":
      return frame([q0, q1], q1, q2);
    case "front":
      return frame([q2, q3], q2, q1);
    default:
      return assertNever(side);
  }
}

/**
 * The wall-face targets for `side` of `quad`, tagged with wall ids, in wallBodies order: one per wall body outside
 * `hidden` (the walls the viewed level doesn't see, levels.19) whose faces are both ahead of the side, parallel to it
 * within 1° and overlapping its span (bodyTarget). `raw` is the dragged size.
 */
export function flushTargets(doc: Document, quad: readonly Point[], side: ResizeSide, raw: number, tolerance: number, hidden: ReadonlySet<string> = new Set()): SnapTarget<string>[] {
  const frame = sideFrame(quad, side);
  if (!frame) return [];
  return [...wallBodies(doc)].flatMap(([wallId, body]) => (hidden.has(wallId) ? [] : bodyTarget(frame, body, raw, tolerance, wallId) ?? []));
}

/**
 * The face targets of the footprints of `layout`'s placements outside `exclude`, in ID order, tagged with placement
 * ids: the same rules as `flushTargets`, every footprint face counted (zone drags, furnish.15; side grips too,
 * furnish.61, cleanup step 15). An `L` piece offers its outline's edges instead (catalog.20): a side in its empty
 * quarter meets an inner edge, never the footprint's invisible right or front side. A rug offers none: a piece lying
 * on it has no reason to stop at its edge (catalog.15).
 */
export function pieceFlushTargets(doc: Document, quad: readonly Point[], side: ResizeSide, raw: number, tolerance: number, layout: string | null, exclude: ReadonlySet<string>): SnapTarget<string>[] {
  const frame = sideFrame(quad, side);
  if (!frame || layout === null) return [];
  const all = footprints(doc);
  const outlines = fitShapes(doc);
  const out: SnapTarget<string>[] = [];
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const fp = p?.state === layout && !exclude.has(id) && !placementRug(doc, id) ? all.get(id) : undefined;
    const outline = outlines.get(id);
    if (fp && outline && outlineOf(doc.objects[p?.object ?? ""]?.kind ?? "") === "ell") {
      out.push(...edgeTargets(frame, outline, raw, tolerance, id));
      continue;
    }
    const [b0, b1, b2, b3] = fp ?? [];
    if (!b0 || !b1 || !b2 || !b3) continue;
    // bodyTarget reads one pair of parallel faces; the turned corner order gives the other pair.
    for (const body of [[b0, b1, b2, b3], [b1, b2, b3, b0]]) {
      const t = bodyTarget(frame, body, raw, tolerance, id);
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * The targets of a counter-clockwise outline's edges that face the moving side: each edge whose outward normal (its
 * right) points against the side's motion, as a body whose two faces are that edge, so its span decides the overlap.
 */
function edgeTargets(frame: { fixed: [Point, Point]; n: Point }, outline: readonly Point[], raw: number, tolerance: number, tag: string): SnapTarget<string>[] {
  return outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length] ?? a;
    const dir = normalize(sub(b, a));
    const facing = dir !== null && dot(frame.n, perpLeft(dir)) > 0; // the outward normal −perpLeft opposes the motion
    return facing ? (bodyTarget(frame, [a, b, b], raw, tolerance, tag) ?? []) : [];
  });
}

/**
 * The target of one rectangle `body` (a wall body, a footprint, or an outline edge as both faces): its faces along
 * b0–b1 and through b2 must be parallel to the side within 1° and overlap its span. The value is the size that puts the
 * side flush with the near face, the first fixed corner's partner to arrive deciding, rounded down to the millimetre so
 * no corner passes the face; null outside MIN_OBJECT_SIZE–MAX_OBJECT_SIZE.
 */
function bodyTarget(frame: { fixed: [Point, Point]; n: Point }, body: readonly Point[], raw: number, tolerance: number, tag: string): SnapTarget<string> | null {
  const [c0, c1] = frame.fixed;
  const edge = normalize(sub(c1, c0));
  const [b0, b1, b2] = body;
  const along = b0 && b1 ? normalize(sub(b1, b0)) : null;
  if (!edge || !b0 || !b1 || !b2 || !along || Math.abs(cross(along, edge)) > PARALLEL_SIN) return null;
  // Spans along the side's edge; touching at an end (up to float noise) is no overlap.
  const overlap = Math.min(Math.max(dot(c0, edge), dot(c1, edge)), Math.max(dot(b0, edge), dot(b1, edge))) - Math.max(Math.min(dot(c0, edge), dot(c1, edge)), Math.min(dot(b0, edge), dot(b1, edge)));
  if (overlap <= 1e-9) return null;
  const f = perpLeft(along);
  const speed = dot(frame.n, f);
  // The size at which a fixed corner's partner reaches the face line through `p`.
  const reach = (p: Point): number => Math.min(dot(sub(p, c0), f) / speed, dot(sub(p, c1), f) / speed);
  // The near face decides. A body with a face behind the side (size ≤ 0) falls under MIN_OBJECT_SIZE below.
  const value = Math.floor(Math.min(reach(b0), reach(b2)) * 1000 + 1e-9) / 1000;
  return value >= MIN_OBJECT_SIZE && value <= MAX_OBJECT_SIZE ? { value, distance: Math.abs(raw - value), tolerance, tag } : null;
}
