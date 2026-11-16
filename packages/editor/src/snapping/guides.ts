import { anchorAt, boxOf, fitShapes, footprints, outlineOf, placedShape, placementRug, shownAt, sortedIds, type Arms, type Box, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Mods } from "../types";
import { pickSnap, type SnapTarget } from "./picker";
import { roundTo } from "./policies";

// Alignment guides (direct.13, AC-13): a moved piece's or group's edges and centre lines snap to those of the other
// furniture in its layout, along the screen axes, through the one picker (direct.17).
//
//        0.93                      the chair's left edge lands within the tolerance of the wardrobe's,
//         ┆┌──────────┐            so the move snaps to 0.93 and a guide runs from the chair to the wardrobe
//         ┆│ wardrobe │
//         ┆└──────────┘
//         ┆
//         ┌───┐
//         │ ch│
//         └───┘

/**
 * A footprint's world box. A piece at an odd angle (`edges` false) aligns by its centre lines only. `xs` and `ys`, when
 * given, are its lines on each axis in place of the box's low edge, centre and high edge: an `L`'s outline edges
 * (catalog.20), so nothing aligns to its footprint's invisible sides or centre.
 */
export type AxisBox = Box & { edges: boolean; xs?: readonly number[]; ys?: readonly number[] };
export type Guide = { a: Point; b: Point };

/** How close a moved line must be to another to show a guide: a millimetre-rounded anchor leaves up to about 1 mm. */
const ALIGN_EPS = 0.002;

export type Axis = "x" | "y";
const AXES: readonly Axis[] = ["x", "y"];

/** The world box of a w × d footprint centred on `centre` at `rotation` (whole degrees). */
export function boxAt(centre: Point, w: number, d: number, rotation: number): AxisBox {
  const edges = square(rotation);
  const quarter = ((rotation % 180) + 180) % 180 === 90; // exact swapped half-sizes, not cos 90° ≈ 6e-17
  const t = (rotation * Math.PI) / 180;
  const hx = edges ? (quarter ? d : w) / 2 : (w * Math.abs(Math.cos(t)) + d * Math.abs(Math.sin(t))) / 2;
  const hy = edges ? (quarter ? w : d) / 2 : (w * Math.abs(Math.sin(t)) + d * Math.abs(Math.cos(t))) / 2;
  return { minX: centre.x - hx, maxX: centre.x + hx, minY: centre.y - hy, maxY: centre.y + hy, edges };
}

/** `boxAt` for a piece of `kind`: an `L`'s at a square angle with its outline's lines (catalog.20), `arms` its own. */
export function shapedBoxAt(centre: Point, w: number, d: number, rotation: number, kind?: string, arms?: Arms): AxisBox {
  const box = boxAt(centre, w, d, rotation);
  if (!box.edges || kind === undefined || outlineOf(kind) !== "ell") return box;
  return withLines(box, placedShape(kind, anchorAt(centre, d, rotation), w, d, rotation, arms));
}

/** The boxes of the furniture in `layout` that `level` draws (`shownAt`, levels.19), except `exclude` and rugs (catalog.15), in ID order. */
export function guideBoxes(doc: Document, layout: string | null, exclude: ReadonlySet<string>, level: Level): AxisBox[] {
  const all = footprints(doc);
  return sortedIds(doc.placements).flatMap((id) => {
    const p = doc.placements[id];
    const quad = all.get(id);
    const shown = p && quad && p.state === layout && !exclude.has(id) && !placementRug(doc, id) && shownAt(doc, id, level);
    return shown ? [pieceBox(doc, id, quad, p.rotation)] : [];
  });
}

/** A placement's box: its footprint's, an `L`'s at a square angle with its outline's lines (catalog.20). */
function pieceBox(doc: Document, id: string, quad: readonly Point[], rotation: number): AxisBox {
  const box = { ...boxOf(quad), edges: square(rotation) };
  const outline = fitShapes(doc).get(id);
  if (!box.edges || !outline || outlineOf(doc.objects[doc.placements[id]?.object ?? ""]?.kind ?? "") !== "ell") return box;
  return withLines(box, outline);
}

/** `box` aligning by the lines of `outline`'s corners on each axis. */
function withLines(box: AxisBox, outline: readonly Point[]): AxisBox {
  return { ...box, xs: distinct(outline.map((q) => q.x)), ys: distinct(outline.map((q) => q.y)) };
}

/** The values sorted low to high, those within float noise of the previous one dropped. */
function distinct(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - (all[i - 1] ?? v) > 1e-9);
}

/**
 * The delta a piece or group moves by (direct.17): Shift keeps the larger axis only; Ctrl the raw delta; otherwise,
 * on each axis, the nearest line of `others` within the tolerance of a moved line of `moving` wins, else the step.
 */
export function alignDelta(moving: AxisBox, raw: Point, others: readonly AxisBox[], opts: { tolerance: number; step: number; mods: Mods }): Point {
  const along = alongAxis(raw, opts.mods.shift);
  const pick = (axis: Axis): number => {
    if (opts.mods.shift && along[axis] === 0) return 0; // the locked-out axis stays put
    const targets = lineTargets(moving, axis, others, along[axis], opts.tolerance);
    return pickSnap({ targets, stepped: roundTo(along[axis], opts.step), free: along[axis], ctrl: opts.mods.ctrl }).value;
  };
  return { x: pick("x"), y: pick("y") };
}

/** A move's delta under Shift: the larger axis only (a tie keeps x); without Shift, `raw`. */
export function alongAxis(raw: Point, shift: boolean): Point {
  return !shift ? raw : Math.abs(raw.x) >= Math.abs(raw.y) ? { x: raw.x, y: 0 } : { x: 0, y: raw.y };
}

/**
 * The guide targets on `axis` of `moving` moved by `along`: one per pair of a moving line and a line of `others`, its
 * value the shift from `moving`'s line onto the other (target − line), its distance from the moved line. In order:
 * the moving lines low, centre, high; `others` as given; their lines low, centre, high (the picker's ties).
 */
export function lineTargets(moving: AxisBox, axis: Axis, others: readonly AxisBox[], along: number, tolerance: number): SnapTarget<null>[] {
  const targets: SnapTarget<null>[] = [];
  for (const line of lines(moving, axis)) {
    for (const other of others) {
      for (const target of lines(other, axis)) {
        targets.push({ value: target - line, distance: Math.abs(target - (line + along)), tolerance, tag: null });
      }
    }
  }
  return targets;
}

/**
 * The guides `movingIds` (one piece, or a group by its bounding box) show in `doc`: one per moved line that lies within
 * ALIGN_EPS of a line of other furniture in `layout` that `level` shows, spanning the moved box and every box it lines
 * up with.
 */
export function alignmentGuides(doc: Document, movingIds: readonly string[], layout: string | null, level: Level): Guide[] {
  const moving = movingBox(doc, movingIds);
  return moving ? guidesBetween(moving, guideBoxes(doc, layout, new Set(movingIds), level)) : [];
}

/** The guides of the box `moving` against `others`: as alignmentGuides, for a box not in the document (the Object tool's ghost). */
export function guidesBetween(moving: AxisBox, others: readonly AxisBox[]): Guide[] {
  const out: Guide[] = [];
  for (const axis of AXES) {
    const across: Axis = axis === "x" ? "y" : "x";
    for (const line of lines(moving, axis)) {
      const matched = others.filter((o) => lines(o, axis).some((t) => Math.abs(t - line) <= ALIGN_EPS));
      if (matched.length === 0) continue;
      const from = Math.min(low(moving, across), ...matched.map((o) => low(o, across)));
      const to = Math.max(high(moving, across), ...matched.map((o) => high(o, across)));
      out.push(axis === "x" ? { a: { x: line, y: from }, b: { x: line, y: to } } : { a: { x: from, y: line }, b: { x: to, y: line } });
    }
  }
  return out;
}

/** One piece's box, or a group's bounding box (always axis-aligned); null when a piece is gone. */
function movingBox(doc: Document, ids: readonly string[]): AxisBox | null {
  const all = footprints(doc);
  const quads = ids.flatMap((id) => {
    const quad = all.get(id);
    return quad ? [quad] : [];
  });
  const [first] = ids;
  const [quad] = quads;
  const p = first ? doc.placements[first] : undefined;
  if (!p || !first || !quad || quads.length !== ids.length) return null;
  return ids.length === 1 ? pieceBox(doc, first, quad, p.rotation) : { ...boxOf(quads.flat()), edges: true };
}

/** Whether a piece at `rotation` has its sides along the screen axes. */
function square(rotation: number): boolean {
  return ((rotation % 90) + 90) % 90 === 0;
}

/** The low edge, centre and high edge along `axis` (an `L`'s own lines); the centre only for a box at an odd angle. */
function lines(box: AxisBox, axis: Axis): readonly number[] {
  const mid = (low(box, axis) + high(box, axis)) / 2;
  const own = axis === "x" ? box.xs : box.ys;
  return !box.edges ? [mid] : (own ?? [low(box, axis), mid, high(box, axis)]);
}

const low = (box: Box, axis: Axis): number => (axis === "x" ? box.minX : box.minY);
const high = (box: Box, axis: Axis): number => (axis === "x" ? box.maxX : box.maxY);
