// The screen zoom and a page's sizes on screen (sheetset.15): the zoom is this viewer's and never prints. Pure, for tests.

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
export const DESK_PADDING = 20; // CSS pixels, each side of the desk (.sheets-desk)
const MAX_BACKING_SIDE = 4096; // canvas pixels, so a large paper at 2× doesn't ask for a huge bitmap

/** The next step along, from a fitted zoom between steps too. */
export const nextZoom = (zoom: number, by: 1 | -1): number => (by > 0 ? ZOOM_STEPS.find((z) => z > zoom) : ZOOM_STEPS.filter((z) => z < zoom).at(-1)) ?? zoom;
export const canZoom = (zoom: number, by: 1 | -1): boolean => nextZoom(zoom, by) !== zoom;
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/** A larger paper starts smaller, as on the mockup, so a page of any size opens at about the same width on screen. */
function basePxPerMm(widthMm: number): number {
  if (widthMm > 700) return 0.9;
  if (widthMm > 500) return 1.2;
  return 2;
}

/** A page's size on screen in CSS pixels. */
export function pageCssSize(page: { widthMm: number; heightMm: number }, zoom: number): { w: number; h: number } {
  const k = basePxPerMm(page.widthMm) * zoom;
  return { w: Math.round(page.widthMm * k), h: Math.round(page.heightMm * k) };
}

/** The zoom a page opens at: the desk's width, as the list and the panel narrow it and A3 at 100% would scroll sideways at 1440. */
export function fitZoom(widthMm: number, deskWidth: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (deskWidth - 2 * DESK_PADDING) / (widthMm * basePxPerMm(widthMm))));
}

/** The canvas's own pixels for that size: sharp at the screen's ratio, within the cap and in proportion. */
export function pageBackingSize(css: { w: number; h: number }, dpr: number): { w: number; h: number } {
  const k = Math.min(dpr, MAX_BACKING_SIDE / Math.max(css.w, css.h));
  return { w: Math.round(css.w * k), h: Math.round(css.h * k) };
}
