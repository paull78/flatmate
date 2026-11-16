/** Placement points are kept to the centimetre: a click lands on screen pixels, not on round numbers. A leaf, so the
 * edit modules can import it without the snapping engine (areas: an import cycle through drag.ts otherwise). */
export const roundCm = (v: number): number => Math.round(v * 100) / 100;
