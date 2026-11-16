import type { EntityKey } from "@fm/protocol";
import { columnOf } from "../column-checks";
import type { Document, Joint, Opening, Wall } from "../model";
import { rehost, runFrom } from "./split-openings";
import { sameSides, sidesOf, swapSides } from "../wall-sides";

// Deleting a column in a wall's line heals the wall (pillars.13, .25; AC-15): the halves merge back into one wall when
// thickness, top, base and finishes match (surfaces.13), otherwise the column's row becomes a wall segment like the
// thinner half. Openings keep their place in the world.

/** Thicknesses closer than this are the same. */
const SAME_THICKNESS = 1e-9;

/**
 * Whether two halves heal into one wall: thickness, top, base and finishes alike (surfaces.13), the finishes compared
 * face to face, so `q`'s sides are swapped when it runs the other way (`sameSense` false).
 */
function matching(p: Wall, q: Wall, sameSense: boolean): boolean {
  const qSides = sameSense ? sidesOf(q) : swapSides(sidesOf(q));
  return Math.abs(p.thickness - q.thickness) < SAME_THICKNESS && p.top === q.top && p.base === q.base && sameSides(sidesOf(p), qSides);
}

/** Whether two walls' rows run the same way along their line. */
function sameSense(doc: Document, p: Wall, q: Wall): boolean {
  const [pa, pb, qa, qb] = [doc.joints[p.a], doc.joints[p.b], doc.joints[q.a], doc.joints[q.b]];
  if (!pa || !pb || !qa || !qb) return true;
  return (pb.x - pa.x) * (qb.x - qa.x) + (pb.y - pa.y) * (qb.y - qa.y) > 0;
}

/**
 * `doc` with in-line column `id` healed out of its wall, or null when it isn't in a line or one of its halves is in
 * `selected` (then it is deleted as any wall row). Halves that match merge into the one at the column's joint a, which
 * keeps its ID and its sense (running away from the column, it runs on from the far end of the other half); the other
 * half, the column's row and joints go, and every opening of both halves moves onto the merged wall. Halves that differ
 * keep their joints and openings, and the row becomes a plain wall like the thinner half (the first when equally thick).
 */
export function healColumn(doc: Document, id: string, selected: ReadonlySet<string>, deps: EntityKey[]): Document | null {
  const col = doc.walls[id];
  const line = columnOf(doc, id)?.line;
  const [h0, h1] = line ? [doc.walls[line[0]], doc.walls[line[1]]] : [];
  if (!col || !h0 || !h1 || selected.has(h0.id) || selected.has(h1.id)) return null;
  deps.push({ table: "walls", id }, { table: "walls", id: h0.id }, { table: "walls", id: h1.id });
  if (!matching(h0, h1, sameSense(doc, h0, h1))) {
    const thin = h1.thickness < h0.thickness - SAME_THICKNESS ? h1 : h0;
    const segment: Wall = { ...col, column: false, thickness: thin.thickness, top: thin.top, base: thin.base };
    return { ...doc, walls: { ...doc.walls, [id]: segment } };
  }
  const far0 = h0.a === col.a ? h0.b : h0.a;
  const far1 = h1.a === col.b ? h1.b : h1.a;
  const merged: Wall = h0.a === far0 ? { ...h0, b: far1 } : { ...h0, a: far1 };
  const walls: Record<string, Wall> = { ...doc.walls, [h0.id]: merged };
  delete walls[id];
  delete walls[h1.id];
  const joints: Record<string, Joint> = { ...doc.joints };
  delete joints[col.a];
  delete joints[col.b];
  deps.push({ table: "joints", id: col.a }, { table: "joints", id: col.b });
  const [ma, mb] = [doc.joints[merged.a], doc.joints[merged.b]];
  if (!ma || !mb) return null;
  const to = runFrom(ma, mb);
  const openings: Record<string, Opening> = { ...doc.openings };
  for (const o of Object.values(doc.openings)) {
    const half = o.wall === h0.id ? h0 : o.wall === h1.id ? h1 : undefined;
    const [a, b] = half ? [doc.joints[half.a], doc.joints[half.b]] : [];
    if (!a || !b) continue;
    openings[o.id] = rehost(o, runFrom(a, b), to, h0.id);
    deps.push({ table: "openings", id: o.id });
  }
  return { ...doc, walls, joints, openings };
}
