import type { Box } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Size } from "./types";

// The editor owns the camera (spec: editor): shells send screen coordinates only.
// Screen y points down; world y points up. Screen coordinates and zoom are CSS pixels
// (zoom = CSS pixels per metre); `dpr` is carried only for the renderer's backing store
// and is ignored by these transforms.
export type Camera = { center: Point; zoom: number; viewport: Size; dpr: number };

export const DEFAULT_ZOOM = 80;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 2000;

export function screenToWorld(c: Camera, p: Point): Point {
  return {
    x: c.center.x + (p.x - c.viewport.width / 2) / c.zoom,
    y: c.center.y - (p.y - c.viewport.height / 2) / c.zoom,
  };
}

export function worldToScreen(c: Camera, p: Point): Point {
  return {
    x: (p.x - c.center.x) * c.zoom + c.viewport.width / 2,
    y: c.viewport.height / 2 - (p.y - c.center.y) * c.zoom,
  };
}

/**
 * Zooms by `factor` while the world point under `screen` stays under it; the zoom is clamped to
 * [MIN_ZOOM, MAX_ZOOM]. A factor that is not finite or not > 0 (NaN, 0, negative, Infinity)
 * returns `c` unchanged.
 */
export function zoomAt(c: Camera, screen: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return c;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
  const anchor = screenToWorld(c, screen);
  return {
    ...c,
    zoom,
    center: {
      x: anchor.x - (screen.x - c.viewport.width / 2) / zoom,
      y: anchor.y + (screen.y - c.viewport.height / 2) / zoom,
    },
  };
}

/** Moves the content with the pointer by (dx, dy) screen pixels. */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { ...c, center: { x: c.center.x - dx / c.zoom, y: c.center.y + dy / c.zoom } };
}

/** True when all of `box` maps inside the viewport, give or take `slackPx` of floating-point error. */
export function boxInView(c: Camera, box: Box, slackPx = 0.5): boolean {
  const topLeft = worldToScreen(c, { x: box.minX, y: box.maxY });
  const bottomRight = worldToScreen(c, { x: box.maxX, y: box.minY });
  const { width, height } = c.viewport;
  return topLeft.x >= -slackPx && topLeft.y >= -slackPx && bottomRight.x <= width + slackPx && bottomRight.y <= height + slackPx;
}

/**
 * Centres on `box` at the largest zoom that fits it with `marginPx` on every side, clamped to [MIN_ZOOM, MAX_ZOOM]
 * (furnish.07). An empty viewport returns `c` unchanged.
 */
export function frameBox(c: Camera, box: Box, marginPx: number): Camera {
  const { width, height } = c.viewport;
  if (width <= 0 || height <= 0) return c;
  const fit = Math.min(Math.max(1, width - 2 * marginPx) / (box.maxX - box.minX), Math.max(1, height - 2 * marginPx) / (box.maxY - box.minY));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  return { ...c, zoom, center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } };
}
