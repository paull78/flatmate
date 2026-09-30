import { add, dot, scale, sub, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Mods, SnapResult } from "../types";
import { choose } from "./chooser";
import { POLICIES, type SnapAxis, type SnapContext } from "./policies";

const GRID_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
const NOTHING: ReadonlySet<string> = new Set();

/** Smallest grid step that is at least 16 px wide at this zoom. */
export function gridSpacingFor(zoom: number): number {
  for (const s of GRID_STEPS) if (s * zoom >= 16) return s;
  return 10;
}

export function orthogonalAxis(origin: Point, cursor: Point): SnapAxis {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { origin, dir: { x: dx < 0 ? -1 : 1, y: 0 } };
  return { origin, dir: { x: 0, y: dy < 0 ? -1 : 1 } };
}

export function projectOnAxis(axis: SnapAxis, p: Point): Point {
  return add(axis.origin, scale(axis.dir, dot(sub(p, axis.origin), axis.dir)));
}

export function snapPoint(input: {
  doc: Document;
  cursor: Point;
  camera: Camera;
  mods: Mods;
  origin: Point | null;
  tolerancePx: number;
  excludeJoints?: ReadonlySet<string>;
  excludeWalls?: ReadonlySet<string>;
  angles?: boolean; // the wall tool: angle and perpendicular snaps from the origin (spec §5.8); a joint drag has none
}): SnapResult {
  const axis = input.mods.shift && input.origin ? orthogonalAxis(input.origin, input.cursor) : null;
  const cursor = axis ? projectOnAxis(axis, input.cursor) : input.cursor;
  if (input.mods.ctrl) return { point: cursor, kind: "none" };
  const tolerance = input.tolerancePx / input.camera.zoom;
  const ctx: SnapContext = {
    doc: input.doc,
    cursor,
    gridSpacing: gridSpacingFor(input.camera.zoom),
    tolerance,
    axis,
    excludeJoints: input.excludeJoints ?? NOTHING,
    excludeWalls: input.excludeWalls ?? NOTHING,
    drawOrigin: input.angles && !axis ? input.origin : null, // not with Shift (Ctrl returned above)
  };
  const best = choose(POLICIES.flatMap((policy) => policy(ctx)), tolerance);
  if (!best) return { point: cursor, kind: "none" };
  return best.guides ? { point: best.point, kind: best.kind, guides: best.guides } : { point: best.point, kind: best.kind };
}
