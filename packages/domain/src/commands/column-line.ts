import { err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { columnSizeViolations } from "../column-checks";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { distanceToSegment, dot, sub } from "../geometry";
import { sortedIds, wallEnds, wallFrame } from "../graph";
import { EPS, MIN_EDGE, type Document, type Wall } from "../model";
import { diffPatch } from "../patch";
import { validateDocument } from "../validate";
import { carryOpenings } from "./split-openings";
import type { CommandResult } from "./types";

// A column into a wall's line (pillars.03, .19, .21, .25): one rule for the Column tool over a wall and for MCP's centre
// on a centreline. The column splits its wall into wall, column, wall sharing joints, centred on the wall's centreline
// and in its direction, taking its base and top.

/** Distances closer than this count as equal, so float noise cannot reorder a tie (as addWall's resolve). */
const TIE = 1e-9;

/** The size refusal for column `id`, with I20's own text, or null. */
export function sizeRefusal(id: string, width: number, depth: number): DomainError | null {
  const sizes = columnSizeViolations(id, width, depth);
  const [first] = sizes;
  return first ? domainError("invalidInput", first.message, sizes) : null;
}

/**
 * The wall standing on `base` whose body holds `at` (within EPS of half its thickness from its centreline), not a column
 * row; the closest one, then the smallest ID. Null when `at` is in no such wall's body.
 */
export function wallUnder(doc: Document, at: Point, base: string): string | null {
  let best: { id: string; d: number } | null = null;
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const ends = wallEnds(doc, id);
    if (!w || w.column || w.base !== base || !ends) continue;
    const d = distanceToSegment(at, ends.a, ends.b);
    if (d < w.thickness / 2 + EPS && (!best || d < best.d - TIE)) best = { id, d };
  }
  return best?.id ?? null;
}

/**
 * Places a column into wall `wallId`'s line, centred on `at` projected onto the centreline: the wall keeps its ID from
 * its a to `${opId}/j0`; the column row `${opId}/w0` runs to `${opId}/j1`; `${opId}/w1`, a copy of the wall, runs on
 * to the wall's b, with the openings past the column (their world place kept). Refused when a half would be under
 * MIN_EDGE or the column covers an opening; then validated (I20: the line, and contact with every other wall).
 */
export function placeInLine(doc: Document, opId: string, wallId: string, s: { at: Point; width: number; depth: number }): CommandResult {
  const id = `${opId}/w0`;
  const rest = `${opId}/w1`;
  const [j0, j1] = [`${opId}/j0`, `${opId}/j1`];
  const sized = sizeRefusal(id, s.width, s.depth);
  if (sized) return err(sized);
  const wall = doc.walls[wallId];
  const f = wallFrame(doc, wallId);
  if (!wall || !f) return err(domainError("notFound", "Wall not found"));
  const along = dot(sub(s.at, f.a), f.dir);
  const [from, to] = [along - s.width / 2, along + s.width / 2];
  if (from < MIN_EDGE || f.length - to < MIN_EDGE) return err(domainError("tooShort", MESSAGES.columnHalves));
  const deps: EntityKey[] = [{ table: "walls", id: wall.id }, { table: "joints", id: wall.a }, { table: "joints", id: wall.b }];
  const moved = carryOpenings(doc, wall, { from, to, fragment: rest }, (o) => `A column can't cover ${o}`, deps);
  if (!moved.ok) return moved;
  const point = (t: number): Point => ({ x: f.a.x + f.dir.x * t, y: f.a.y + f.dir.y * t });
  const column: Wall = { id, a: j0, b: j1, thickness: s.depth, top: wall.top, base: wall.base, column: true };
  const next: Document = {
    ...doc,
    joints: { ...doc.joints, [j0]: { id: j0, ...point(from) }, [j1]: { id: j1, ...point(to) } },
    walls: { ...doc.walls, [wall.id]: { ...wall, b: j0 }, [id]: column, [rest]: { ...wall, id: rest, a: j1 } },
    openings: { ...doc.openings, ...moved.value },
  };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
