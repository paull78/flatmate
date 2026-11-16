import { MIN_AREA_SIZE, type Document, type ResizeSide } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { faceSegments } from "../snapping/dimension-policies";
import { roundCm } from "../snapping/round-cm";
import { widthSide } from "../snapping/resize";
import { pullToLine } from "./pull-line";

// Editing a named area on the canvas (areas.07, .29), as a deck (decks.30), square to the page: a drag moves its centre
// by the grid-rounded delta, then a side within the tolerance lands on a wall face or another area's side parallel to
// it; a side grip moves that side along its normal with the opposite side fixed, to the cm and at least MIN_AREA_SIZE.

const PARALLEL = 1e-9;
const NORMALS: Record<ResizeSide, Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, back: { x: 0, y: 1 }, front: { x: 0, y: -1 } };

/** The area a side grip dragged by `drag` (world) leaves: its new centre and size, or null for a gone area. */
export function areaResize(doc: Document, areaId: string, side: ResizeSide, drag: Point): { at: Point; w: number; d: number } | null {
  const a = Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  if (!a) return null;
  const n = NORMALS[side];
  const was = widthSide(side) ? a.w : a.d;
  const size = Math.max(MIN_AREA_SIZE, roundCm(was + drag.x * n.x + drag.y * n.y));
  const at = { x: a.at.x + (n.x * (size - was)) / 2, y: a.at.y + (n.y * (size - was)) / 2 }; // the opposite side stays
  return widthSide(side) ? { at, w: size, d: a.d } : { at, w: a.w, d: size };
}

/**
 * A dragged area's centre `at`, moved on each axis so that the side nearer a line, within `tol` metres, lies on it: the
 * wall faces square to the page and the other areas' sides. `at` as given when nothing is near, or with `tol` 0 (Ctrl).
 */
export function snapAreaAt(doc: Document, areaId: string, at: Point, tol: number): Point {
  const a = Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  if (!a || tol <= 0) return at;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const f of faceSegments(doc)) {
    if (Math.abs(f.dir.y) <= PARALLEL) ys.push(f.start.y);
    else if (Math.abs(f.dir.x) <= PARALLEL) xs.push(f.start.x);
  }
  for (const [id, o] of Object.entries(doc.areas)) {
    if (id === areaId) continue;
    xs.push(o.at.x - o.w / 2, o.at.x + o.w / 2);
    ys.push(o.at.y - o.d / 2, o.at.y + o.d / 2);
  }
  return { x: pullToLine(at.x, a.w / 2, xs, tol), y: pullToLine(at.y, a.d / 2, ys, tol) };
}
