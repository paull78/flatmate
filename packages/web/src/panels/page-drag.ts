import type { ExportPage } from "@fm/editor";

// A framing drag's arithmetic (sheetset.17): pixels until release, and paper millimetres on it, so the screen's zoom only
// divides pixels and never reaches what's stored. Pure, as web tests have no DOM (layout-states.38).

const DRAG_MIN_PX = 4; // a press moving less is a click, which selects the page

export type Px = { x: number; y: number };
export type PageDrag = { start: Px; at: Px; dragging: boolean };

export const pressAt = (at: Px): PageDrag => ({ start: at, at, dragging: false });

/** Once it's a drag it stays one, so coming back to the start doesn't turn the release into a click. */
export const dragTo = (drag: PageDrag, at: Px): PageDrag => ({ ...drag, at, dragging: drag.dragging || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) >= DRAG_MIN_PX });

/** How far it's moved in screen pixels, y down: none until it's a drag. */
export const dragDelta = ({ start, at, dragging }: PageDrag): Px => (dragging ? { x: at.x - start.x, y: at.y - start.y } : { x: 0, y: 0 });

/** How far that is on paper, y up, as `frameSheet` takes it. */
export const paperDrag = (delta: Px, pxPerMm: number): { dxMm: number; dyMm: number } => ({ dxMm: delta.x / pxPerMm, dyMm: -delta.y / pxPerMm });

/** The same move in a canvas's own pixels, at the screen's ratio. */
export const backingShift = (delta: Px, backingWidth: number, cssWidth: number): Px => ({ x: (delta.x * backingWidth) / cssWidth, y: (delta.y * backingWidth) / cssWidth });

/** Where a page's frames lie over its canvas, in CSS pixels from its top left. A page with no clip draws no plan, so has none. */
export function frameBoxes(page: ExportPage, css: { w: number; h: number }): { left: number; top: number; width: number; height: number }[] {
  const k = css.w / page.widthMm;
  return (page.clips ?? []).map(({ rect }) => ({ left: rect.x * k, top: (page.heightMm - rect.y - rect.h) * k, width: rect.w * k, height: rect.h * k }));
}
