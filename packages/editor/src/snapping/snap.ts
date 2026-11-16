import { equalLength } from "./equal";
import { viewBox } from "./across";
import { squared } from "./near-square";
import { UNDERLAY_ID, add, dot, scale, sub, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import type { Mods, SnapResult } from "../types";
import { choose } from "./chooser";
import { POLICIES, type SnapAxis, type SnapContext, type SnapPolicy } from "./policies";

const GRID_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
const NOTHING: ReadonlySet<string> = new Set();

/** Smallest grid step that is at least 16 px wide at this zoom. */
export function gridSpacingFor(zoom: number): number {
  for (const s of GRID_STEPS) if (s * zoom >= 16) return s;
  return 10;
}

/** Auto's step while a plan picture shows (furnish.08): hand-traced walls follow the picture, not the zoom grid. */
export const TRACING_STEP = 0.01;

type StepInputs = Pick<EditorState, "snapSettings" | "camera" | "document" | "underlayView">;

/**
 * The step every snapped move rounds to (direct.14): the chosen step, else on Auto 1 cm while this viewer shows a
 * plan picture (furnish.08), else the zoom's grid. The drawn grid and its corner chip keep the zoom's step.
 */
export function snapStep(state: StepInputs): number {
  const step = state.snapSettings.step;
  if (step !== "auto") return step;
  return underlayShown(state) ? TRACING_STEP : gridSpacingFor(state.camera.zoom);
}

/** The snap tolerance in metres: `tolerancePx` (10 px) on screen at the camera's zoom. */
export function snapToleranceM(s: { snapSettings: { tolerancePx: number }; camera: { zoom: number } }): number {
  return s.snapSettings.tolerancePx / s.camera.zoom;
}

/** The open drawing has the underlay row and this viewer's Show/Hide shows it; faded or off screen still counts. */
function underlayShown(state: StepInputs): boolean {
  return state.document !== null && visibleDoc(state.document).underlays[UNDERLAY_ID] !== undefined && state.underlayView.visible;
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

/**
 * The rows a wall end on `base` never snaps to, and their joints: columns (pillars.39 b: wall commands are refused on
 * them) and every wall of another base (pillars.09: an end joins and splits only walls of its own base). The Wall
 * tool and a joint drag leave them out, so at the floor a loft wall's joint is no target, nor a partition under the loft
 * at the loft's level.
 */
export function otherParts(doc: Document, base: string): { joints: Set<string>; walls: Set<string> } {
  const rows = Object.values(doc.walls).filter((w) => w.column || w.base !== base);
  return { joints: new Set(rows.flatMap((w) => [w.a, w.b])), walls: new Set(rows.map((w) => w.id)) };
}

export function snapPoint(input: {
  doc: Document;
  cursor: Point;
  camera: Camera;
  mods: Mods;
  origin: Point | null;
  tolerancePx: number;
  gridSpacing: number; // snapStep's: the zoom's grid, the tracing step or the chosen step
  excludeJoints?: ReadonlySet<string>;
  excludeWalls?: ReadonlySet<string>;
  angles?: boolean; // the Wall and Dimension tools: origin-based (angle, perpendicular) snaps from `origin` (spec: tools); a joint drag has none
  policies?: readonly SnapPolicy[]; // default POLICIES; the Dimension tool passes its own (dims.18)
  squareFrom?: readonly Point[]; // the far ends of the walls at the moving point: near-square lands square (straight.10); none for Dimension, Section and footprints
}): SnapResult {
  const axis = input.mods.shift && input.origin ? orthogonalAxis(input.origin, input.cursor) : null;
  const cursor = axis ? projectOnAxis(axis, input.cursor) : input.cursor;
  if (input.mods.ctrl) return { point: cursor, kind: "none" };
  const tolerance = input.tolerancePx / input.camera.zoom;
  const ctx: SnapContext = {
    doc: input.doc,
    cursor,
    gridSpacing: input.gridSpacing,
    tolerance,
    axis,
    excludeJoints: input.excludeJoints ?? NOTHING,
    excludeWalls: input.excludeWalls ?? NOTHING,
    drawOrigin: input.angles && !axis ? input.origin : null, // not with Shift (Ctrl returned above)
  };
  const best = choose((input.policies ?? POLICIES).flatMap((policy) => policy(ctx)), tolerance);
  const result: SnapResult = !best ? { point: cursor, kind: "none" } : best.guides ? { point: best.point, kind: best.kind, guides: best.guides } : { point: best.point, kind: best.kind };
  if (!input.squareFrom) return result;
  // Square first, so an equal length runs along the squared direction; equal then only takes a grid or free point (straight step 25).
  return equalLength(squared(result, input.squareFrom), input.squareFrom, input.doc, input.excludeWalls ?? NOTHING, tolerance, viewBox(input.camera));
}
