import { roundCm } from "./round-cm";
import { EPS, anchorAtMm, cross, dot, levelOf, sortedIds, sub, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { NO_MODS } from "../types";
import { faceCornerPolicy, faceSegments, onFacePolicy, type FaceSegment } from "./dimension-policies";
import { guideBoxes, type AxisBox } from "./guides";
import { wallSeenAt } from "./near-walls";
import { snapPoint } from "./snap";

export { roundCm }; // its own leaf module (round-cm.ts), re-exported so imports stay here

// The Dimension tool's face snaps (dims.18) and nothing else: joint centres lie inside the wall body, and a drawn
// corner never takes the snap step (direct.19).
const CORNER_POLICIES = [faceCornerPolicy, onFacePolicy];
const PARALLEL_SIN = Math.sin(Math.PI / 180); // 1°, as the domain's faces
// Sizes are floored to the millimetre, so a drawn piece never outgrows its rectangle; the slack keeps
// 1.2000000000000002 at 1.2 and 1.1999999999999997 at 1.2 (direct.57).
const floorMm = (v: number): number => Math.floor(v * 1000 + 1e-9) / 1000;

/** The walls `level` doesn't see (under an upper level, levels.19) and every joint they end at. */
function hiddenWalls(doc: Document, level: Level): { walls: Set<string>; joints: Set<string> } {
  const walls = new Set(sortedIds(doc.walls).filter((id) => !wallSeenAt(doc, id, level)));
  const joints = new Set([...walls].flatMap((id) => {
    const w = doc.walls[id];
    return w ? [w.a, w.b] : [];
  }));
  return { walls, joints };
}

/**
 * One corner of a drawn footprint: a wall face corner, else the foot on a wall face, within the snap tolerance; else
 * the cm. The pointer is rounded to the cm first, so a foot on an axis-aligned face also lands on a whole cm along it.
 * Only the walls `level` sees count (the floor level by default, for the Deck tool), and no corner at a joint of a wall
 * it hides. With a `layout` (the Object tool, sizing.35), an axis no wall fixed takes the nearest piece side within
 * the tolerance (`pieceSide`): a face corner fixes both axes, a foot on a face only the one across it. Ctrl: none.
 */
export function footprintCorner(doc: Document, camera: Camera, tolerancePx: number, world: Point, ctrl: boolean, level: Level = levelOf(doc, null), layout: string | null = null): Point {
  const cursor = { x: roundCm(world.x), y: roundCm(world.y) };
  const hidden = hiddenWalls(doc, level);
  const r = snapPoint({
    doc, cursor, camera, mods: { ...NO_MODS, ctrl }, origin: null, tolerancePx, gridSpacing: 0.01, policies: CORNER_POLICIES,
    excludeWalls: hidden.walls, excludeJoints: hidden.joints,
  });
  const walled = r.kind === "none" ? cursor : r.point;
  if (ctrl || layout === null || r.kind === "endpoint") return walled;
  const boxes = guideBoxes(doc, layout, new Set(), level);
  const tolerance = tolerancePx / camera.zoom;
  const free = (v: number, c: number): boolean => Math.abs(v - c) < 1e-9; // an axis the wall's foot left alone
  return {
    x: free(walled.x, cursor.x) ? (pieceSide(boxes, "x", cursor, tolerance) ?? walled.x) : walled.x,
    y: free(walled.y, cursor.y) ? (pieceSide(boxes, "y", cursor, tolerance) ?? walled.y) : walled.y,
  };
}

/**
 * The nearest piece side on `axis` within `tolerance` of the cursor (sizing.34): the boxes are the guides' (pieces in
 * the layout that the level shows, no rugs, an `L`'s outline lines, catalog.20); a turned piece offers none; a side
 * counts only where the box's span across it reaches the cursor within the tolerance. Ties: the lower box, then value.
 */
function pieceSide(boxes: readonly AxisBox[], axis: "x" | "y", cursor: Point, tolerance: number): number | null {
  let best: { v: number; gap: number } | null = null;
  for (const b of boxes) {
    if (!b.edges) continue;
    const across = axis === "x" ? cursor.y >= b.minY - tolerance && cursor.y <= b.maxY + tolerance : cursor.x >= b.minX - tolerance && cursor.x <= b.maxX + tolerance;
    if (!across) continue;
    const lines = axis === "x" ? (b.xs ?? [b.minX, b.maxX]) : (b.ys ?? [b.minY, b.maxY]);
    for (const v of lines) {
      const gap = Math.abs(cursor[axis] - v);
      if (gap <= tolerance + 1e-9 && (best === null || gap < best.gap - 1e-9)) best = { v, gap };
    }
  }
  return best?.v ?? null;
}

type Side = { start: Point; end: Point; dir: Point; rotation: number };

/**
 * The piece a rectangle drawn from `a` to `b` along the world axes holds (furnish.17): its back is the walled side
 * opposite the one open side; with two or more open sides, or none, the start angle decides, rounded to a quarter
 * turn; `turns` quarter turns counter-clockwise go over either (R while drawing, sizing.07). The width runs along the
 * back. `at` is the back edge's centre (layout-states.49), to the mm. Only the faces of walls `level` sees wall a side
 * (levels.19).
 */
export function drawnFootprint(doc: Document, a: Point, b: Point, startRotation: number, level: Level = levelOf(doc, null), turns = 0): { at: Point; rotation: number; w: number; d: number } {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const across = { x: 1, y: 0 };
  const up = { x: 0, y: 1 };
  // Each side with the rotation that puts the piece's back on it (the front faces −y at 0, turns counter-clockwise).
  const sides: Side[] = [
    { start: { x: x0, y: y1 }, end: { x: x1, y: y1 }, dir: across, rotation: 0 },
    { start: { x: x0, y: y0 }, end: { x: x0, y: y1 }, dir: up, rotation: 90 },
    { start: { x: x0, y: y0 }, end: { x: x1, y: y0 }, dir: across, rotation: 180 },
    { start: { x: x1, y: y0 }, end: { x: x1, y: y1 }, dir: up, rotation: 270 },
  ];
  const faces = faceSegments(doc).filter((f) => wallSeenAt(doc, f.wall, level));
  const [open, ...moreOpen] = sides.flatMap((s, i) => (faces.some((f) => walls(f, s)) ? [] : [i]));
  const single = open !== undefined && moreOpen.length === 0 ? sides[(open + 2) % 4] : undefined;
  const ruled = single ? single.rotation : Math.round(startRotation / 90) * 90;
  const rotation = (((ruled + 90 * turns) % 360) + 360) % 360; // R's quarter turns while drawing, over the rule (sizing.07)
  const along = rotation === 0 || rotation === 180 ? x1 - x0 : y1 - y0;
  const other = rotation === 0 || rotation === 180 ? y1 - y0 : x1 - x0;
  const w = floorMm(along);
  const d = floorMm(other);
  return { at: anchorAtMm({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, d, rotation), rotation, w, d };
}

/**
 * A face walls a side when it is parallel within 1°, both of the side's ends lie on its line within 1 mm, and it runs
 * along more than 1 mm of the side. A face that only touches the side at an end, or a side of no length, doesn't count.
 */
function walls(f: FaceSegment, s: Side): boolean {
  if (Math.abs(cross(f.dir, s.dir)) > PARALLEL_SIN) return false;
  if (Math.abs(cross(f.dir, sub(s.start, f.start))) > EPS || Math.abs(cross(f.dir, sub(s.end, f.start))) > EPS) return false;
  const t0 = dot(sub(s.start, f.start), f.dir);
  const t1 = dot(sub(s.end, f.start), f.dir);
  return Math.min(Math.max(t0, t1), f.length) - Math.max(Math.min(t0, t1), 0) > EPS;
}
