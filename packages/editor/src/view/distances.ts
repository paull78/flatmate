import { add, boxOf, footprints, nearestObstacles, normalize, perpLeft, scale, shownAt, shownCm, sortedIds, sub, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { ghostCopyIds } from "../duplicate";
import { activeStateId, viewedLevelOn, type EditorState } from "../state";
import { measuredPlacements } from "./refused-overlay";
import { runDistances } from "./run-distances";
import { wallSeenAt } from "../snapping/near-walls";
import { HELPER_FONT } from "./fonts";
import { resizeLabelBox } from "./handles";
import { drawDimension, drawPlate, outsideBox } from "./helper";
import { labelBox } from "./labels";
import type { Primitive } from "./scene-types";

// Live distances (direct.12, AC-12): while furniture is moved, resized or nudged, up to four dimension lines from the
// piece's sides (a group's bounding box) to the nearest wall face or furniture of the active layout. The domain
// measures (direct.18); this module picks what to measure on the preview document and draws the result.

type DistanceLine = { from: Point; to: Point; gap: number };
type Box = { min: Point; max: Point };

const PLATE_GAP_PX = 2; // between a slid plate and the size label

/**
 * The placements the Select tool's gesture measures and the document they are on: a drag's target or a nudge run's on
 * `doc`, the scene's document; the duplicate's copies on their preview while they fit (a refused ghost is drawn at the
 * cursor, so its last valid place would mislead); none otherwise. Ctrl changes nothing, as on a drag (ghost.07).
 */
function measured(state: EditorState, doc: Document | null): { ids: string[]; doc: Document | null } {
  const tool = state.tool;
  if (tool.name !== "select") return { ids: [], doc };
  const t = tool.state;
  switch (t.kind) {
    case "moving":
    case "nudging":
      return { ids: measuredPlacements(t.target), doc };
    case "copying":
      return t.attempt.ok ? { ids: ghostCopyIds(t), doc: t.attempt.doc } : { ids: [], doc };
    case "idle":
    case "pressing":
    case "box":
    case "editingHelper":
    case "editingGap":
    case "splitting":
      return { ids: [], doc };
    default:
      return assertNever(t);
  }
}

/**
 * The lines on `sceneDoc`, the scene's document (a gesture's preview, so the last valid one while refused), or on the
 * duplicate's preview: one piece measures along its own axes, a group from the bounding box of its footprints along
 * the screen axes. Only the furniture the viewed level draws (`shownAt`) and the walls it sees (`wallSeenAt`) count
 * (levels.19). A side with nothing in front, or a gap
 * under half a centimetre, has no line.
 */
export function liveDistances(state: EditorState, sceneDoc: Document | null): DistanceLine[] {
  const run = runDistances(state, sceneDoc); // a wall run's, instead of furniture's (straight.03)
  if (run.length > 0) return run;
  const { ids, doc } = measured(state, sceneDoc);
  const layout = activeStateId(state);
  if (!doc || !layout || ids.length === 0) return [];
  const all = footprints(doc);
  const quads = ids.flatMap((id) => {
    const quad = all.get(id);
    return quad ? [quad] : [];
  });
  if (quads.length !== ids.length) return [];
  const one = quads.length === 1 ? quads[0] : undefined;
  const b = boxOf(quads.flat());
  const quad = one ?? [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
  const level = viewedLevelOn(state, doc); // the gesture's preview, where the pieces measured stand
  const hidden = Object.keys(doc.placements).filter((id) => !shownAt(doc, id, level));
  const hiddenWalls = new Set(sortedIds(doc.walls).filter((id) => !wallSeenAt(doc, id, level)));
  const sides = nearestObstacles(doc, quad, layout, new Set([...ids, ...hidden]), hiddenWalls);
  return [sides.front, sides.right, sides.back, sides.left].flatMap((g) =>
    g && shownCm(g.gap) !== 0 ? [{ from: g.from, to: g.to, gap: g.gap }] : [],
  );
}

/** The longest part of a → b outside the box (a → b when none is). */
function longestOutside(a: Point, b: Point, box: Box): [Point, Point] {
  let best: [Point, Point] = [a, b];
  let bestLength = -1;
  for (const piece of outsideBox(a, b, box.min, box.max)) {
    const d = sub(piece[1], piece[0]);
    const len = Math.hypot(d.x, d.y);
    if (len > bestLength) [best, bestLength] = [piece, len];
  }
  return best;
}

/**
 * How far the plate must slide along `dir` to clear the box by `gap`, 0 when it already does. The plate overlaps the
 * box while its centre is inside the box grown by the plate's half-size, so it slides to that grown box's far edge.
 */
function slideClear(plate: Box, dir: Point, box: Box, gap: number): number {
  const half = scale(sub(plate.max, plate.min), 0.5);
  const at = scale(add(plate.min, plate.max), 0.5);
  const exits = [
    { c: at.x, d: dir.x, lo: box.min.x - half.x - gap, hi: box.max.x + half.x + gap },
    { c: at.y, d: dir.y, lo: box.min.y - half.y - gap, hi: box.max.y + half.y + gap },
  ];
  if (exits.some(({ c, lo, hi }) => c <= lo || c >= hi)) return 0;
  return Math.min(...exits.map(({ c, d, lo, hi }) => (d > 0 ? (hi - c) / d : d < 0 ? (lo - c) / d : Infinity)));
}

/**
 * The live distances (annotations layer): each line with ticks at both ends and an upright plate in whole
 * centimetres at its middle. During a resize the lines, ticks and plates keep clear of the size label: a plate moves
 * to the middle of the longest part of its line outside the label, and when it still overlaps the label (too little
 * of the line is left) it slides on along its line, away from the piece, until it clears it.
 */
export function drawDistances(state: EditorState, doc: Document | null, out: Primitive[]): void {
  const size = resizeLabelBox(state);
  const avoid = size ? [size] : [];
  for (const { from, to, gap } of liveDistances(state, doc)) {
    const dir = normalize(sub(to, from));
    if (!dir) continue;
    const text = `${shownCm(gap)} cm`; // the one rounding rule (cleanup.39)
    const [a, b] = size ? longestOutside(from, to, size) : [from, to];
    const mid = scale(add(a, b), 0.5);
    const first = labelBox(text, mid, HELPER_FONT, state.camera);
    const at = size ? add(mid, scale(dir, slideClear(first, dir, size, PLATE_GAP_PX / state.camera.zoom))) : mid;
    const plate = { text, at, ...labelBox(text, at, HELPER_FONT, state.camera) };
    drawDimension(from, to, [from, to], perpLeft(dir), plate, state.camera.zoom, out, avoid);
    drawPlate(plate, null, out);
  }
}
