import type { Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "./contact";
import type { Piece } from "./piece";
import { roundTo } from "./policies";

// Where a dragged or new object, or a dragged opening, lands (arch-review R-05): one place for object and opening
// snapping, used by the Object tool's ghost and the Select tool's drags. Each caller passes how it got its centre or
// drag (the ghost: the pointer to the centimetre; a drag: its delta aligned to other furniture or grid-rounded, AC-13).

/**
 * Where a w × d piece centred on `centre` lands in `layout`, starting from `rotation`: contact plus fit (spec: layouts,
 * furnish.16, snapping/contact.ts). Ctrl (`opts.free`) keeps the angle with no snap; `opts.ignore` lists the placements
 * the fit skips (a drag's own piece); `opts.kind`, the piece's kind, lets a corner kind take the corner turn;
 * `opts.heights` are the piece's for the configuration it shows (heights.12); a seat kind with its `opts.config` may
 * take the tuck snap first (`held`, seating.11). Its anchor is kept to the millimetre.
 */
export function placeFootprint(doc: Document, layout: string, size: { w: number; d: number }, centre: Point, rotation: number,
  opts: { tolerance: number; free: boolean } & Piece): { at: Point; rotation: number; flushWalls: readonly string[]; held?: true } {
  return contactPlace(doc, layout, size, centre, rotation, opts);
}

/** An opening dragged `along` metres along its wall: the drag rounded to the grid (exact with Ctrl), the offset to the centimetre. */
export function slideOpening(offset: number, along: number, gridSpacing: number, exact: boolean): number {
  const delta = exact ? along : roundTo(along, gridSpacing);
  return Math.round((offset + delta) * 100) / 100;
}
