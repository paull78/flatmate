import { add, roundMm, scale, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roundTo } from "../snapping/policies";
import { acrossLine } from "../view/dimension-layout";
import { markAxes } from "../view/section-marks-layer";

// Editing a section on the canvas (spec "Editing", "Depth"): an end grip on each end of the line, and a far grip that
// sets the depth. Whole depth has no far line, so its grip sits a fixed distance off the cut on the seen side.

export const WHOLE_GRIP_PX = 24;

/** The far grip's place and the way depth grows: the far line's middle, or WHOLE_GRIP_PX off the cut's with whole depth. */
export function sectionFarSpot(row: Section, zoom: number): { at: Point; normal: Point } | null {
  const axes = markAxes(row);
  if (!axes) return null;
  return { at: add(scale(add(row.a, row.b), 0.5), scale(axes.seen, row.depth ?? WHOLE_GRIP_PX / zoom)), normal: axes.seen };
}

/**
 * The depth a far grip at `world` sets: its distance from the cut towards the seen side, on the grid (to the mm with
 * Ctrl). Absolute, as a dimension's offset, so it's the same from a whole depth's grip; past the cut it stops at Zero.
 */
export function sectionDepthAt(row: Section, world: Point, step: number, free: boolean): number {
  const across = acrossLine(row.a, row.b, world) * row.side;
  return Math.max(0, free ? roundMm(across) : roundTo(across, step));
}
