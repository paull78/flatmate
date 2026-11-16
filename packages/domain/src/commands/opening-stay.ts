import type { EntityKey, Point } from "@fm/protocol";
import { cross, dot, normalize, sub } from "../geometry";
import type { Document, Opening } from "../model";

// Openings stay put when their wall only stretches (straight.15, .23). An opening's offset runs from its wall's joint a,
// so a stretch that moves joint a along the line would carry the opening with it. A wall stretches when its direction is
// unchanged and its two ends moved by different amounts; such a wall's openings get their offsets corrected for joint
// a's move, and validation (I12) refuses one pushed off its wall, naming it. A wall carried whole (both ends by one
// delta) or turned keeps its offsets.

/** Below this a direction or a delta counts as unchanged. */
const SAME = 1e-9;

/** How far joint a moved along a wall that only stretched from `before` to `after`, or 0 when it didn't stretch. */
function stretchShift(before: Document, after: Document, wallId: string): number {
  const w = before.walls[wallId];
  const [a0, b0, a1, b1] = w ? [before.joints[w.a], before.joints[w.b], after.joints[w.a], after.joints[w.b]] : [];
  if (!a0 || !b0 || !a1 || !b1) return 0;
  const da: Point = sub(a1, a0);
  const db: Point = sub(b1, b0);
  if (Math.abs(da.x - db.x) < SAME && Math.abs(da.y - db.y) < SAME) return 0; // carried whole
  const d0 = normalize(sub(b0, a0));
  const d1 = normalize(sub(b1, a1));
  if (!d0 || !d1 || Math.abs(cross(d0, d1)) > SAME || dot(d0, d1) < 0) return 0; // turned
  return dot(da, d0);
}

/**
 * `after` with the offsets of openings on stretched walls corrected so each keeps its place in the world. `moved` are
 * the joints that moved; the corrected openings are pushed to `deps`.
 */
export function keepOpeningsInPlace(before: Document, after: Document, moved: ReadonlySet<string>, deps?: EntityKey[]): Document {
  const shifts = new Map<string, number>();
  for (const w of Object.values(before.walls)) {
    if (!moved.has(w.a) && !moved.has(w.b)) continue;
    const shift = stretchShift(before, after, w.id);
    if (shift !== 0) shifts.set(w.id, shift);
  }
  if (shifts.size === 0) return after;
  const openings: Record<string, Opening> = { ...after.openings };
  for (const o of Object.values(after.openings)) {
    const shift = shifts.get(o.wall);
    if (shift === undefined) continue;
    openings[o.id] = { ...o, offset: o.offset - shift };
    deps?.push({ table: "openings", id: o.id });
  }
  return { ...after, openings };
}
