import { MIN_ARM, add, armsOf, fitShapes, isValidId, normalize, outlineOf, perpLeft, placedShape, roundMm, scale, sub, type Arms, type Document, type ResizeSide } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { flushTargets, pieceFlushTargets } from "./faces";
import { pickSnap } from "./picker";
import { roundTo } from "./policies";
import { sideOf, type ResizeOptions } from "./resize";

// An `L` piece's grips and arm drags (catalog.09, .12). Its outline, counter-clockwise from the front-left (catalog.17):
// o0 front-left, o1 the left arm's front-right, o2 the inner corner, o3 the back arm's inner end, o4 back-right,
// o5 back-left. Edge i runs from o(i) to o(i+1): 0 the left arm's front end, 1 the left arm's inner edge, 2 the back
// arm's inner edge, 3 the back arm's right end, 4 the back, 5 the left side.

export type Arm = "back" | "left";

/** A grip's spot: the middle of an outline edge and its outward unit normal. */
export type Spot = { mid: Point; normal: Point };

/** The placed outline of an `ell` piece (the one fit and the drawing read), or null for another kind or a gone piece. */
export function ellOutline(doc: Document, placementId: string): readonly Point[] | null {
  const p = isValidId(placementId) ? doc.placements[placementId] : undefined;
  const kind = p ? doc.objects[p.object]?.kind : undefined;
  return kind !== undefined && outlineOf(kind) === "ell" ? (fitShapes(doc).get(placementId) ?? null) : null;
}

/** Edge `i` of a counter-clockwise ring: its middle and outward normal (on its right). */
function edgeSpot(ring: readonly Point[], i: number): Spot | null {
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  const dir = a && b ? normalize(sub(b, a)) : null;
  return a && b && dir ? { mid: scale(add(a, b), 0.5), normal: scale(perpLeft(dir), -1) } : null;
}

/** Where an `L`'s side grip sits (catalog.12): right and front at the arm ends, back and left on their sides' middles. */
export function ellSideSpot(outline: readonly Point[], side: ResizeSide): Spot | null {
  switch (side) {
    case "front":
      return edgeSpot(outline, 0);
    case "right":
      return edgeSpot(outline, 3);
    case "back":
      return edgeSpot(outline, 4);
    case "left":
      return edgeSpot(outline, 5);
    default:
      return assertNever(side);
  }
}

/** An arm grip's spot: the middle of the arm's inner edge, its normal into the empty quarter (the way the arm deepens). */
export function armSpot(outline: readonly Point[], arm: Arm): Spot | null {
  return edgeSpot(outline, arm === "back" ? 2 : 1);
}

/**
 * The part of an arm beside the empty quarter as a footprint quad (front-left, front-right, back-right, back-left) and
 * its side that the inner edge is: the back arm's x from the inner corner to its right end, its front side moving;
 * the left arm's y from its front end to the inner corner, its right side moving. Its size across is the arm's depth.
 */
function armBand(o: readonly Point[], arm: Arm): { quad: Point[]; side: ResizeSide } | null {
  const [o0, o1, o2, o3, o4] = o;
  if (!o0 || !o1 || !o2 || !o3 || !o4) return null;
  return arm === "back" ? { quad: [o2, o3, o4, add(o2, sub(o4, o3))], side: "front" } : { quad: [o0, o1, o2, add(o0, sub(o2, o1))], side: "right" };
}

/**
 * The arms an arm grip's drag `along` metres into the quarter gives (negative thins the arm), with the object and its
 * width for the size command (catalog.18), or null without an `L` piece. As a side grip's size (`resizeTo`): with
 * `free` (Ctrl) the cursor to the centimetre; otherwise a wall face, then another piece's face in `opts.layout`, within
 * `tolerance`, else the movement in whole steps. Kept to the millimetre and clamped to 0.10 m to 0.10 m short of the
 * side the arm runs across.
 */
export function armTo(doc: Document, placementId: string, arm: Arm, along: number, opts: ResizeOptions): { objectId: string; w: number; arms: Arms } | null {
  const p = isValidId(placementId) ? doc.placements[placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  const w = p ? object?.w[p.config] : undefined;
  const d = p ? object?.d[p.config] : undefined;
  const now = object ? armsOf(object) : null;
  const outline = ellOutline(doc, placementId);
  const band = outline ? armBand(outline, arm) : null;
  if (!object || w === undefined || d === undefined || !now || !band) return null;
  const t0 = now[arm];
  const raw = t0 + along;
  const picked = pickSnap({
    targets: opts.free ? [] : [
      ...flushTargets(doc, band.quad, band.side, raw, opts.tolerance, opts.hiddenWalls),
      ...pieceFlushTargets(doc, band.quad, band.side, raw, opts.tolerance, opts.layout, new Set([placementId, ...opts.hidden])),
    ],
    stepped: t0 + roundTo(along, opts.step),
    free: Math.round(raw * 100) / 100,
    ctrl: opts.free,
  });
  const across = arm === "back" ? d : w;
  const t = roundMm(Math.min(across - MIN_ARM, Math.max(MIN_ARM, picked.value)));
  return { objectId: object.id, w, arms: arm === "back" ? { ...now, back: t } : { ...now, left: t } };
}

/** A side's grip spot on a piece placed as given: an `L`'s at its arm end with `arms` (catalog.12), another's on its side's middle. */
export function pieceSideSpot(piece: { kind: string; at: Point; w: number; d: number; rotation: number; quad: readonly Point[]; arms?: Arms }, side: ResizeSide): Spot | null {
  if (outlineOf(piece.kind) !== "ell") return sideOf(piece.quad, side);
  return ellSideSpot(placedShape(piece.kind, piece.at, piece.w, piece.d, piece.rotation, piece.arms), side);
}

/** The arm grip's spot of an `L` piece with `arms` instead of its own: where a dragged arm's inner edge is. */
export function armSpotWith(doc: Document, placementId: string, arm: Arm, arms: Arms): Spot | null {
  const p = isValidId(placementId) ? doc.placements[placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  const w = p ? object?.w[p.config] : undefined;
  const d = p ? object?.d[p.config] : undefined;
  if (!p || !object || w === undefined || d === undefined || outlineOf(object.kind) !== "ell") return null;
  return armSpot(placedShape(object.kind, p.at, w, d, p.rotation, arms), arm);
}
