// Paper sizes and scales for the PDF sheet (spec Behaviour "Paper and scale"; export.05, .14). Millimetres; a scale
// is its denominator (50 means 1:50). Pure.

import { SHEET_SCALES, type PaperName } from "@fm/domain";

/** `column`: the title block column on each page's right edge, inside the margin (sheet.07, .08): wider from A3 up. */
export const PAPERS: Record<PaperName, { label: string; w: number; h: number; column: number }> = {
  A4: { label: "A4", w: 210, h: 297, column: 60 },
  A3: { label: "A3", w: 297, h: 420, column: 75 },
  A2: { label: "A2", w: 420, h: 594, column: 75 },
  A1: { label: "A1", w: 594, h: 841, column: 75 },
  Letter: { label: "Letter", w: 215.9, h: 279.4, column: 60 },
};

/** Largest first: fit to page tries them in this order. */
export const STANDARD_SCALES = SHEET_SCALES;
export const SMALLEST_SCALE = STANDARD_SCALES[STANDARD_SCALES.length - 1] ?? 200;

export const MARGIN_MM = 10;
/** What a plan keeps clear inside its frame, on paper: a dimension's text has paper sizes (sheetset.10). */
export const FRAME_INSET_MM = 5;

export function columnMm(paper: PaperName): number {
  return PAPERS[paper].column;
}

export type Orientation = "portrait" | "landscape";
export type Size = { w: number; h: number };
/** A rectangle on the page: origin at its bottom-left corner, y up. */
export type Rect = { x: number; y: number; w: number; h: number };

export function paperSize(paper: PaperName, orientation: Orientation): Size {
  const { w, h } = PAPERS[paper];
  return orientation === "portrait" ? { w, h } : { w: h, h: w };
}

/** Where the plan goes: the paper inside the margin, left of the title block column. */
export function drawingArea(paper: PaperName, orientation: Orientation): Rect {
  const page = paperSize(paper, orientation);
  return { x: MARGIN_MM, y: MARGIN_MM, w: page.w - 2 * MARGIN_MM - columnMm(paper), h: page.h - 2 * MARGIN_MM };
}

/**
 * The orientation that fits the plan best: the one whose drawing area, inside the inset, holds the plan at the larger
 * scale; on a tie, the one whose shape matches the plan's (landscape for a wide plan).
 */
export function orientationFor(plan: Size, paper: PaperName): Orientation {
  const room = (o: Orientation): number => {
    const a = drawingArea(paper, o);
    return Math.min((a.w - 2 * FRAME_INSET_MM) / plan.w, (a.h - 2 * FRAME_INSET_MM) / plan.h);
  };
  const portrait = room("portrait");
  const landscape = room("landscape");
  if (Math.abs(portrait - landscape) > 1e-9) return portrait > landscape ? "portrait" : "landscape";
  return plan.w >= plan.h ? "landscape" : "portrait";
}
