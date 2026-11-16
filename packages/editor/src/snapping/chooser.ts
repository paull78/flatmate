import type { SnapCandidate } from "./policies";

/**
 * Within tolerance: lowest priority, then smallest distance, then x, then y (deterministic). The grid is the
 * fallback and ignores the tolerance: its cells are at least 16 px wide, so a 10 px limit missed every cell centre.
 */
export function choose(cands: SnapCandidate[], tolerance: number): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const c of cands) {
    if (c.kind !== "grid" && c.distance > tolerance) continue;
    if (!best || better(c, best)) best = c;
  }
  return best;
}

function better(a: SnapCandidate, b: SnapCandidate): boolean {
  if (a.priority !== b.priority) return a.priority < b.priority;
  if (a.distance !== b.distance) return a.distance < b.distance;
  if (a.point.x !== b.point.x) return a.point.x < b.point.x;
  return a.point.y < b.point.y;
}
