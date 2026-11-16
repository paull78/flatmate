import type { EntityKey, Point } from "@fm/protocol";
import { MESSAGES, sizeRange, type Violation } from "./errors";
import { boxOf, convexOverlap, distance, type Box } from "./geometry";
import { jointWalls, sortedIds } from "./graph";
import { memo } from "./memo";
import { EPS, SIZE_LIMITS, inSizeRange, isFloorWall, type Document, type SizeRange } from "./model";
import { wallBodies } from "./queries/footprints";
import { rangesOverlap, wallRange, type Range } from "./queries/vertical";
import { zones } from "./queries/zones";
import { inLine } from "./queries/runs";
import { shown } from "./format";

// Columns (pillars.01, .04, .21): a column is a wall row with `column` set, its width the centreline a → b, its depth
// the thickness. It stands free (no wall at either end, its body clear of every wall body) or in a wall's line (exactly
// one wall at each end, the two walls and the column on one straight line). I20 checks both, and the column sizes.

/** Column sizes compare within half a millimetre: a turned column's joints are rounded to the millimetre. */
const SIZE_TOLERANCE = EPS / 2;
const FREE_OR_IN_LINE = "a column stands free or in a wall's line";
/** pillars.42: a thinner column would leave a recess in its wall. */
const AS_DEEP = "a column in a wall's line is at least as deep as the wall";
const AS_DEEP_PLAIN = "A column in a wall's line is at least as deep as the wall";

/** A column as people see it: `rotation` in degrees counter-clockwise of a → b, in [0, 360). */
export type ColumnView = {
  id: string;
  centre: Point;
  width: number;
  depth: number;
  rotation: number;
  /** The walls whose line it sits in, the one at joint a first, or null for a column that is not in a line. */
  line: readonly [string, string] | null;
};

const wallsAtJoints = memo(jointWalls);
const key = (id: string): EntityKey => ({ table: "walls", id });

/** The other walls at each end of a row, sorted by ID. */
function endWalls(doc: Document, id: string, a: string, b: string): [string[], string[]] {
  const at = wallsAtJoints(doc);
  const others = (j: string): string[] => (at.get(j) ?? []).filter((w) => w !== id);
  return [others(a), others(b)];
}

/** The far end of wall `wallId` from joint `jointId`, or null. */
function farEnd(doc: Document, wallId: string, jointId: string): Point | null {
  const w = doc.walls[wallId];
  const far = w ? doc.joints[w.a === jointId ? w.b : w.a] : undefined;
  return far ? { x: far.x, y: far.y } : null;
}

/** A column's ends: the walls at each and, when it is in a line, the two walls of that line. */
function ends(doc: Document, id: string): { at: [string[], string[]]; line: [string, string] | null } | null {
  const w = doc.walls[id];
  const a = w ? doc.joints[w.a] : undefined;
  const b = w ? doc.joints[w.b] : undefined;
  if (!w || !a || !b) return null;
  const at = endWalls(doc, id, w.a, w.b);
  const [[before], [after]] = at;
  if (at[0].length !== 1 || at[1].length !== 1 || before === undefined || after === undefined) return { at, line: null };
  const from = farEnd(doc, before, w.a);
  const to = farEnd(doc, after, w.b);
  return { at, line: from && to && inLine(from, a, b, to) ? [before, after] : null };
}

/** The column on wall row `wallId`, or null when the row is missing, not a column, or misses a joint. */
export function columnOf(doc: Document, wallId: string): ColumnView | null {
  const w = doc.walls[wallId];
  const a = w?.column ? doc.joints[w.a] : undefined;
  const b = w?.column ? doc.joints[w.b] : undefined;
  if (!w || !a || !b) return null;
  const turn = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return {
    id: wallId,
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    width: distance(a, b),
    depth: w.thickness,
    rotation: turn < 0 ? turn + 360 : turn,
    line: ends(doc, wallId)?.line ?? null,
  };
}

/** A refusal naming the column for Claude, and in plain words for people. */
type Problem = { message: string; plain: string };

/**
 * The floor column `wallId` takes off its rooms (Properties' "Takes"), in m²: a free column its whole body; one in a
 * wall's line the part proud of the wall into each room it bounds, measured from the thinner half, as the heal would
 * leave it (pillars.43); a column on a deck none, as rooms come from the floor's rows (pillars.24). Null for a row that
 * is not a column.
 */
export function columnTakes(doc: Document, wallId: string): number | null {
  const c = columnOf(doc, wallId);
  const row = doc.walls[wallId];
  if (!c || !row) return null;
  if (!isFloorWall(row)) return 0;
  if (!c.line) return c.width * c.depth;
  const wall = Math.min(...c.line.map((w) => doc.walls[w]?.thickness ?? c.depth));
  const rooms = zones(doc).filter((z) => z.face.wallIds.includes(wallId) || z.face.holes.some((h) => h.wallIds.includes(wallId))).length;
  return (rooms * c.width * Math.max(0, c.depth - wall)) / 2;
}

/** The size refusal for one measure, or null; shown to the millimetre where centimetres would read as in range. */
function sizeProblem(id: string, what: "width" | "depth", v: number, range: SizeRange): Problem | null {
  if (inSizeRange(v, range, SIZE_TOLERANCE)) return null;
  const cm = shown(v);
  const rest = `${what} ${inSizeRange(Number(cm), range) ? shown(v, 3) : cm} m is outside ${sizeRange(range)} m`;
  return { message: `Column ${id} ${rest}`, plain: `Column ${rest}` };
}

/** I20's size violations for column `id` at this width and depth: the column commands refuse with the same text. */
export function columnSizeViolations(id: string, width: number, depth: number): Violation[] {
  return [sizeProblem(id, "width", width, SIZE_LIMITS.column.width), sizeProblem(id, "depth", depth, SIZE_LIMITS.column.depth)]
    .flatMap((p): Violation[] => (p === null ? [] : [{ invariant: "I20", ...p, entities: [key(id)] }]));
}

/** Why a column's ends break I20, or null: a wall at one end only, two at an end, or walls out of its line. */
function endsProblem(id: string, at: [string[], string[]], line: [string, string] | null): Problem | null {
  const [atA, atB] = at;
  const both = (rest: string): Problem => ({ message: `Column ${id} ${rest}`, plain: `This column ${rest}` });
  if (atA.length > 1 || atB.length > 1) return both(`has more than one wall at an end; ${FREE_OR_IN_LINE}`);
  if (atA.length !== atB.length) return both(`has a wall at one end only; ${FREE_OR_IN_LINE}`);
  const [before, after] = [atA[0], atB[0]];
  if (before === undefined || after === undefined || line) return null;
  return { message: `Column ${id} is not in line with walls ${before} and ${after}`, plain: "This column is not in line with its walls" };
}

/** Whether two boxes come within `gap` of each other. */
function near(p: Box, q: Box, gap: number): boolean {
  return p.minX <= q.maxX + gap && q.minX <= p.maxX + gap && p.minY <= q.maxY + gap && q.minY <= p.maxY + gap;
}

/** Whether two rows' ranges overlap; a row naming a missing deck (I21 reports it) meets everything. */
function meets(a: Range | null, b: Range | null): boolean {
  return a === null || b === null || rangesOverlap(a, b);
}

/**
 * I20 (pillars.04, .21): every column's width and depth within the column limits; its ends free or in a wall's line;
 * a free column's body at least EPS clear of every wall body whose range overlaps its own, an in-line one's of every
 * such wall but its line's two, except that a wall on another base may touch it (a post on the loft flush with the
 * shell's inner face, pillars.50) but not overlap it; an in-line column at least as deep as its walls (pillars.42).
 * Columns are few, so each body is tested against every wall body. Messages name the column.
 */
export function columnViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const bodies = wallBodies(doc);
  for (const id of sortedIds(doc.walls)) {
    const column = columnOf(doc, id);
    const end = column ? ends(doc, id) : null;
    if (!column || !end) continue;
    const v = (p: Problem, other: string[] = []): void => void out.push({ invariant: "I20", ...p, entities: [key(id), ...other.map(key)] });
    out.push(...columnSizeViolations(id, column.width, column.depth));
    const problem = endsProblem(id, end.at, end.line);
    if (problem) {
      v(problem, [...end.at[0], ...end.at[1]]);
      continue;
    }
    const thinner = end.line?.find((w) => column.depth < (doc.walls[w]?.thickness ?? 0) - EPS);
    if (thinner !== undefined) v({ message: `Column ${id} is thinner than its wall; ${AS_DEEP}`, plain: AS_DEEP_PLAIN }, [thinner]);
    const body = bodies.get(id);
    const range = wallRange(doc, id);
    if (!body) continue;
    const box = boxOf(body);
    for (const [other, quad] of bodies) {
      if (other === id || end.line?.includes(other) || !near(box, boxOf(quad), EPS) || !meets(range, wallRange(doc, other))) continue;
      // Within EPS counts as touching (overlap by more than −EPS); a wall on another base may touch, flush (pillars.50).
      const flush = doc.walls[other]?.base !== doc.walls[id]?.base;
      if (convexOverlap(body, quad, flush ? EPS : -EPS)) v({ message: MESSAGES.columnTouches(id, other), plain: MESSAGES.columnTouchesPlain }, [other]);
    }
  }
  return out;
}
