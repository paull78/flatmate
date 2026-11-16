import { boxOf, rotateAbout, type Box } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { LineFamily, MotifDrawing } from "./motifs";

// The pattern's joints and shapes over a floor's bounding box (finishes.02, .18): tiled in the pattern's own frame
// (unrotated, in units of the size, from (0,0)), lines merged by line key, and only then scaled and rotated into the
// drawing. Lines and shapes are tiled in one pass under one cell cap.

/** A pattern needing more cells than this over a floor's bounding box draws its colour alone (finishes.06). */
export const MAX_CELLS = 20_000;

/** A merged joint in drawing coordinates, before clipping; `key` names its line in the pattern (family + index). */
export type TiledLine = { a: Point; b: Point; key: string; shade: number };
/** A convex shape in drawing coordinates, before clipping. */
export type TiledShape = { points: Point[]; shade: number };
/** The pattern over a floor: `tooFine` (and nothing else) when it needs more than MAX_CELLS cells. */
export type Tiled = { lines: TiledLine[]; shapes: TiledShape[]; tooFine: boolean };

const ORIGIN: Point = { x: 0, y: 0 };
const SLACK = 1e-9; // a cell or line touching the box is tiled: clipping decides what stays

/** The rows of cells i·u + j·v whose lines can reach the box, as j with an inclusive i range each. */
type CellRow = { j: number; lo: number; hi: number };

/** The integers i with lo ≤ i·k + c ≤ hi; all of them when k is 0 and c fits. */
function steps(lo: number, hi: number, k: number, c: number): [number, number] {
  if (k === 0) return c >= lo - SLACK && c <= hi + SLACK ? [-Infinity, Infinity] : [1, 0];
  const [p, q] = [(lo - c) / k, (hi - c) / k];
  return [Math.ceil(Math.min(p, q) - SLACK), Math.floor(Math.max(p, q) + SLACK)];
}

/**
 * The cells whose drawing's box (lines and shapes: cement tiles' corner diamonds stick out of the cell) meets `box`, and
 * how many there are (counted first: the cap is checked before tiling).
 */
function cellRows(drawing: MotifDrawing, box: Box): { rows: CellRow[]; count: number } {
  const [u, v] = drawing.repeat;
  const reach = boxOf([...drawing.lines.flatMap((l) => [l.a, l.b]), ...drawing.shapes.flatMap((s) => s.points)]);
  // The cell origins o with o + reach meeting the box.
  const origins: Box = { minX: box.minX - reach.maxX, maxX: box.maxX - reach.minX, minY: box.minY - reach.maxY, maxY: box.maxY - reach.minY };
  const det = u.x * v.y - u.y * v.x;
  const corners = [
    { x: origins.minX, y: origins.minY }, { x: origins.maxX, y: origins.minY },
    { x: origins.minX, y: origins.maxY }, { x: origins.maxX, y: origins.maxY },
  ];
  const js = corners.map((o) => (u.x * o.y - u.y * o.x) / det);
  const rows: CellRow[] = [];
  let count = 0;
  for (let j = Math.ceil(Math.min(...js) - SLACK); j <= Math.floor(Math.max(...js) + SLACK); j++) {
    const [xLo, xHi] = steps(origins.minX, origins.maxX, u.x, j * v.x);
    const [yLo, yHi] = steps(origins.minY, origins.maxY, u.y, j * v.y);
    const lo = Math.max(xLo, yLo);
    const hi = Math.min(xHi, yHi);
    if (hi < lo) continue;
    rows.push({ j, lo, hi });
    count += hi - lo + 1;
    if (count > MAX_CELLS) break;
  }
  return { rows, count };
}

/** One line of the pattern: its family, its offset across (a whole number) and the spans along it, in sizes. */
type Run = { family: LineFamily; offset: number; shade: number; spans: [number, number][] };

/** Collinear spans that overlap or touch become one; exact, as every end is a whole number. */
function merged(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** Whether the shape at cell origin (ox, oy) has its box meeting `box`. */
function shapeMeets(shape: Box, ox: number, oy: number, box: Box): boolean {
  return shape.maxX + ox >= box.minX - SLACK && shape.minX + ox <= box.maxX + SLACK && shape.maxY + oy >= box.minY - SLACK && shape.minY + oy <= box.maxY + SLACK;
}

/**
 * The drawing's joints and shapes over the floor ring's bounding box, at `size` metres per unit and turned `angle`
 * degrees about (0,0), lines merged per line; `tooFine` (and nothing else) when the box needs more than MAX_CELLS cells.
 */
export function tilePattern(drawing: MotifDrawing, ring: readonly Point[], size: number, angle: number): Tiled {
  const empty = drawing.lines.length === 0 && drawing.shapes.length === 0;
  if (empty || !(size > 0) || ring.length === 0) return { lines: [], shapes: [], tooFine: false };
  const box = boxOf(ring.map((p) => {
    const q = rotateAbout(p, ORIGIN, -angle);
    return { x: q.x / size, y: q.y / size };
  }));
  const { rows, count } = cellRows(drawing, box);
  if (count > MAX_CELLS) return { lines: [], shapes: [], tooFine: true };
  const [u, v] = drawing.repeat;
  const toWorld = (x: number, y: number): Point => rotateAbout({ x: x * size, y: y * size }, ORIGIN, angle);
  const shapeBoxes = drawing.shapes.map((s) => boxOf(s.points));
  const shapes: TiledShape[] = [];
  const runs = new Map<string, Run>();
  for (const { j, lo, hi } of rows) {
    for (let i = lo; i <= hi; i++) {
      const ox = i * u.x + j * v.x;
      const oy = i * u.y + j * v.y;
      for (const { family, a, b, shade } of drawing.lines) {
        const alongX = family === "x";
        const offset = alongX ? oy + a.y : ox + a.x;
        const span: [number, number] = alongX ? [ox + a.x, ox + b.x] : [oy + a.y, oy + b.y];
        const [acrossLo, acrossHi, alongLo, alongHi] = alongX ? [box.minY, box.maxY, box.minX, box.maxX] : [box.minX, box.maxX, box.minY, box.maxY];
        if (offset < acrossLo - SLACK || offset > acrossHi + SLACK || span[1] < alongLo - SLACK || span[0] > alongHi + SLACK) continue;
        const id = `${family}${Math.round(offset)} ${shade}`;
        const run = runs.get(id);
        if (run) run.spans.push(span);
        else runs.set(id, { family, offset: Math.round(offset), shade, spans: [span] });
      }
      drawing.shapes.forEach(({ points, shade }, k) => {
        const shapeBox = shapeBoxes[k];
        if (shapeBox && shapeMeets(shapeBox, ox, oy, box)) shapes.push({ points: points.map((p) => toWorld(ox + p.x, oy + p.y)), shade });
      });
    }
  }
  const lines: TiledLine[] = [];
  for (const { family, offset, shade, spans } of runs.values()) {
    const key = `${family}${offset}`;
    for (const [lo, hi] of merged(spans)) {
      const [a, b] = family === "x" ? [toWorld(lo, offset), toWorld(hi, offset)] : [toWorld(offset, lo), toWorld(offset, hi)];
      lines.push({ a, b, key, shade });
    }
  }
  return { lines, shapes, tooFine: false };
}
