import {
  MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, add, armsOf, footprintQuad, footprints, isValidId, normalize, resizedAnchor, roundMm, scale, squareSize, stairRuleOf, sub, type Document,
  type ResizeSide,
} from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { flushTargets, pieceFlushTargets } from "./faces";
import { pickSnap } from "./picker";
import { roundTo } from "./policies";

// A side grip's drag (direct.04, direct.06): the size it picks, and the footprint that size gives. The anchor, which
// side stays put, is the domain's rule (`resizedAnchor`, direct.18); nothing here moves a placement.

/**
 * `layout`: the active layout, whose other pieces' faces the grip snaps to (furnish.61), null for none; `hidden`: the
 * pieces the viewed level hides, which attract nothing (levels.19).
 */
export type ResizeOptions = { step: number; tolerance: number; free: boolean; layout: string | null; hidden: ReadonlySet<string>; hiddenWalls: ReadonlySet<string> };

/** True for the sides that change the width (local ±x), false for those that change the depth. */
export function widthSide(side: ResizeSide): boolean {
  switch (side) {
    case "left":
    case "right":
      return true;
    case "front":
    case "back":
      return false;
    default:
      return assertNever(side);
  }
}

/**
 * The middle of `side` of a footprint quad (corners: front-left, front-right, back-right, back-left) and its outward
 * unit normal, or null for a degenerate quad.
 */
export function sideOf(quad: readonly Point[], side: ResizeSide): { mid: Point; normal: Point } | null {
  const [q0, q1, q2, q3] = quad;
  const right = q0 && q1 ? normalize(sub(q1, q0)) : null;
  const back = q0 && q3 ? normalize(sub(q3, q0)) : null;
  if (!q0 || !q1 || !q2 || !q3 || !right || !back) return null;
  const mid = (a: Point, b: Point): Point => scale(add(a, b), 0.5);
  switch (side) {
    case "right":
      return { mid: mid(q1, q2), normal: right };
    case "left":
      return { mid: mid(q3, q0), normal: scale(right, -1) };
    case "front":
      return { mid: mid(q0, q1), normal: scale(back, -1) };
    case "back":
      return { mid: mid(q2, q3), normal: back };
    default:
      return assertNever(side);
  }
}

/** A placement's object, configuration and current w × d, or null when any is missing. */
function current(doc: Document, placementId: string) {
  const p = isValidId(placementId) ? doc.placements[placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  const w = p ? object?.w[p.config] : undefined;
  const d = p ? object?.d[p.config] : undefined;
  return p && object && w !== undefined && d !== undefined ? { p, kind: object.kind, arms: armsOf(object) ?? undefined, w, d } : null;
}

/**
 * The size `side` takes when its grip is dragged `along` metres outward (negative shrinks): with `free` (Ctrl) the
 * cursor to the centimetre; otherwise a wall face, then another piece's face in `opts.layout`, within `tolerance`
 * (step 10's targets and picker, direct.17, furnish.61; a tie goes to the wall), else
 * the movement rounded to `step`, so a 1.23 m piece goes 1.43, 1.63. Kept to the millimetre and clamped to 0.10–10 m.
 * Null without the placement.
 */
export function resizeTo(doc: Document, placementId: string, side: ResizeSide, along: number, opts: ResizeOptions): number | null {
  const now = current(doc, placementId);
  const quad = footprints(doc).get(placementId);
  if (!now || !quad) return null;
  const s0 = widthSide(side) ? now.w : now.d;
  const raw = s0 + along;
  const picked = pickSnap({
    targets: opts.free ? [] : [
      ...flushTargets(doc, quad, side, raw, opts.tolerance, opts.hiddenWalls),
      ...pieceFlushTargets(doc, quad, side, raw, opts.tolerance, opts.layout, new Set([placementId, ...opts.hidden])),
    ],
    stepped: s0 + roundTo(along, opts.step),
    free: Math.round(raw * 100) / 100,
    ctrl: opts.free,
  });
  return Math.min(MAX_OBJECT_SIZE, Math.max(MIN_OBJECT_SIZE, roundMm(picked.value))); // a stepped size without float noise
}

/**
 * The piece with `side` resized to `size`, anchored where the domain would put it (`resizedAnchor`), or null; a
 * spiral's box stays square, as the domain keeps it (stairs.21); an `L` keeps its arms.
 */
export function resizedPreview(doc: Document, placementId: string, side: ResizeSide, size: number) {
  const now = current(doc, placementId);
  if (!now) return null;
  const asked = { w: widthSide(side) ? size : now.w, d: widthSide(side) ? now.d : size };
  const square = squareSize(stairRuleOf(now.kind), now, asked);
  const [w, d] = square === null ? [asked.w, asked.d] : [square, square];
  const at = resizedAnchor(now.p, side, now.w, now.d, size);
  return { kind: now.kind, config: now.p.config, w, d, at, rotation: now.p.rotation, quad: footprintQuad(at, w, d, now.p.rotation), arms: now.arms };
}
