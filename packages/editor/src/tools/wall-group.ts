import { EPS, type Document, type EntityRef, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { selectableAt } from "./selectable";
import type { DragTarget } from "./types";

// Walls in the selection (straight.09, .16): a group is walls and pieces of the active layout, alone or mixed. Columns,
// joints, openings and the rest are never grouped. A group with walls drags as one `walls` target with no run and no
// across-only: it moves exactly what is in it (one moveWalls).

/** Whether `ref` can be part of a group: a piece, or a wall that isn't a column. */
export function groupable(doc: Document | null, ref: EntityRef): boolean {
  return ref.table === "placements" || (ref.table === "walls" && doc?.walls[ref.id]?.column !== true);
}

/** The selection as a group's members: itself when every ref is groupable, else none. */
export function groupMembers(doc: Document | null, selection: EntityRef[]): EntityRef[] {
  return selection.every((r) => groupable(doc, r)) ? selection : [];
}

/** The walls of a selection, columns left out. */
export function selectedWalls(doc: Document | null, selection: EntityRef[]): string[] {
  return selection.flatMap((r) => (r.table === "walls" && groupable(doc, r) ? [r.id] : []));
}

/** Whether the selection is a group with walls in it: two or more walls, or walls with pieces. */
export function wallGroup(doc: Document | null, selection: EntityRef[]): boolean {
  const walls = selectedWalls(doc, selection).length;
  return selection.length > 1 && walls > 0 && groupMembers(doc, selection).length > 0;
}

/** The drag target of a group with walls: those walls and pieces, moved by one delta. */
export function groupTarget(wallIds: readonly string[], placementIds: readonly string[]): DragTarget {
  return { kind: "walls", wallIds, placementIds, across: null };
}

/**
 * The walls lying wholly inside the box with corners `a` and `b` (both ends inside, EPS slack) that the viewed level
 * can select, in id order; columns left out.
 */
export function wallsInBox(doc: Document, layout: string | null, level: Level, a: Point, b: Point): string[] {
  const [x0, x1] = [Math.min(a.x, b.x) - EPS, Math.max(a.x, b.x) + EPS];
  const [y0, y1] = [Math.min(a.y, b.y) - EPS, Math.max(a.y, b.y) + EPS];
  const inside = (p: Point | undefined): boolean => p !== undefined && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  return Object.keys(doc.walls).sort().filter((id) => {
    const w = doc.walls[id];
    return w !== undefined && !w.column && inside(doc.joints[w.a]) && inside(doc.joints[w.b]) && selectableAt(doc, layout, { table: "walls", id }, level);
  });
}
