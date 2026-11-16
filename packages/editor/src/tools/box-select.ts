import { EPS, footprints, type Document, type EntityRef, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { selectableAt } from "./selectable";

/**
 * The placements of `layout` whose footprints lie fully inside the box with corners `a` and `b`, in id order
 * (direct.07), that the viewed level can select (levels.06). A footprint touching an edge counts (EPS slack); one
 * crossing it does not.
 */
export function placementsInBox(doc: Document, layout: string | null, level: Level, a: Point, b: Point): string[] {
  if (layout === null) return [];
  const [x0, x1] = [Math.min(a.x, b.x) - EPS, Math.max(a.x, b.x) + EPS];
  const [y0, y1] = [Math.min(a.y, b.y) - EPS, Math.max(a.y, b.y) + EPS];
  const inside = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const out: string[] = [];
  for (const [id, quad] of footprints(doc)) {
    if (doc.placements[id]?.state === layout && selectableAt(doc, layout, { table: "placements", id }, level) && quad.every(inside)) out.push(id);
  }
  return out;
}

/**
 * The selection a box sets: Shift adds the boxed pieces to a furniture selection, skipping those already in it;
 * otherwise, or over a non-furniture selection, the boxed pieces alone (direct.02: one thing, or furniture).
 */
export function boxSelection(selection: EntityRef[], inside: string[], additive: boolean, walls: string[] = []): EntityRef[] {
  // The boxed walls too (straight.09): a group is walls and furniture.
  const boxed = [...walls.map((id): EntityRef => ({ table: "walls", id })), ...inside.map((id): EntityRef => ({ table: "placements", id }))];
  if (!additive || !selection.every((r) => r.table === "placements" || r.table === "walls")) return boxed;
  const held = new Set(selection.map((r) => `${r.table}/${r.id}`));
  return [...selection, ...boxed.filter((r) => !held.has(`${r.table}/${r.id}`))];
}
