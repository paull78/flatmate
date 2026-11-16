import { cross, dot, shownCm, sortedIds, wallFrame, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { EditorState } from "../state";

// A run's live distances (straight.03, spec M1 "Live distances"): while a connected run moves, at most two lines, one
// from each face of the run to the nearest parallel wall face on that side whose span overlaps the run's, in whole
// centimetres; none while the move is refused. Furniture's live distances measure pieces (view/distances.ts).

type DistanceLine = { from: Point; to: Point; gap: number };

/** Directions within 1° count as parallel for a distance (the faces read as parallel). */
const PARALLEL_SIN = Math.sin(Math.PI / 180);

/** The run's two distance lines on `doc` (the scene's document, so the move's preview), or none. */
export function runDistances(state: EditorState, doc: Document | null): DistanceLine[] {
  const t = state.tool.name === "select" ? state.tool.state : null;
  if (!doc || t?.kind !== "moving" || t.target.kind !== "walls" || !t.target.across || !t.attempt.ok) return [];
  const n = t.target.across;
  const dir = { x: n.y, y: -n.x };
  const run = new Set(t.target.wallIds);
  let centre = 0;
  let half = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of run) {
    const f = wallFrame(doc, id);
    if (!f) continue;
    centre = dot(f.a, n);
    half = Math.max(half, f.half);
    for (const p of [f.a, f.b]) [lo, hi] = [Math.min(lo, dot(p, dir)), Math.max(hi, dot(p, dir))];
  }
  if (lo > hi) return [];
  const best = new Map<1 | -1, { gap: number; along: number; face: number }>();
  for (const id of sortedIds(doc.walls)) {
    const f = run.has(id) ? null : wallFrame(doc, id);
    if (!f || Math.abs(cross(f.dir, dir)) > PARALLEL_SIN) continue;
    const [s0, s1] = [dot(f.a, dir), dot(f.b, dir)].sort((x, y) => x - y);
    const from = Math.max(lo, s0 ?? 0);
    const to = Math.min(hi, s1 ?? 0);
    if (from >= to) continue; // spans don't overlap
    const c = (dot(f.a, n) + dot(f.b, n)) / 2;
    for (const side of [1, -1] as const) {
      const gap = side * (c - centre) - f.half - half;
      if (side * (c - centre) <= 0 || gap < 0) continue;
      const seen = best.get(side);
      if (!seen || gap < seen.gap) best.set(side, { gap, along: (from + to) / 2, face: centre + side * half });
    }
  }
  const at = (along: number, across: number): Point => ({ x: dir.x * along + n.x * across, y: dir.y * along + n.y * across });
  return [...best.entries()].flatMap(([side, b]) =>
    shownCm(b.gap) === 0 ? [] : [{ from: at(b.along, b.face), to: at(b.along, b.face + side * b.gap), gap: b.gap }],
  );
}
