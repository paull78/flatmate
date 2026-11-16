import type { PaperName } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Bounds } from "../view/picture";
import { FRAME_INSET_MM, STANDARD_SCALES, drawingArea, orientationFor, type Size } from "./paper";

// What fits a frame (sheetset.10, .17): a note and Fit's choice, never a refusal to print a framed sheet. Pure.

const EPS_MM = 1e-9;

/**
 * Whether what's drawn lies inside the frame, `FRAME_INSET_MM` clear of its edges on paper. `framing` is the model point
 * at the frame's centre, not an offset from `drawn`'s own: a loft sheet is framed on the floor's centre (step 04), so
 * its drawing can sit off-centre. Nothing drawn (null) always fits.
 */
export function planFits({ drawn, scale, frameMm, framing }: { drawn: Bounds | null; scale: number; frameMm: Size; framing: Point }): boolean {
  if (drawn === null) return true;
  const k = 1000 / scale; // paper millimetres per metre
  const halfW = frameMm.w / 2 - FRAME_INSET_MM + EPS_MM;
  const halfH = frameMm.h / 2 - FRAME_INSET_MM + EPS_MM;
  return (framing.x - drawn.min.x) * k <= halfW && (drawn.max.x - framing.x) * k <= halfW && (framing.y - drawn.min.y) * k <= halfH && (drawn.max.y - framing.y) * k <= halfH;
}

/** The middle of what's drawn, where a sheet centres; the origin when nothing is. */
export function boundsCentre(b: Bounds | null): Point {
  return b === null ? { x: 0, y: 0 } : { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
}

/** Whether a plan of this size, centred, fits the paper at this scale in its best orientation. */
export function scaleFits(plan: Size, paper: PaperName, scale: number): boolean {
  const drawn = { min: { x: 0, y: 0 }, max: { x: plan.w, y: plan.h } };
  return planFits({ drawn, scale, frameMm: drawingArea(paper, orientationFor(plan, paper)), framing: boundsCentre(drawn) });
}

/** The largest standard scale at which the plan fits the paper, or null when it fits at none (export.14). */
export function fitScale(plan: Size, paper: PaperName): number | null {
  return STANDARD_SCALES.find((s) => scaleFits(plan, paper, s)) ?? null;
}
