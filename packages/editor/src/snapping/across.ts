import { cross, dot, sortedIds, wallFrame, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { SnapResult } from "../types";

// A run's snaps across itself (straight.03, spec M1 "Snapping across"): within the tolerance, the run's centreline or a
// face lines up with the centreline or a face of another exactly parallel wall on screen, face to face or centre to
// centre. A wall even slightly off parallel can't coincide after a translation, so it is no target (straight.22). Pure
// (no editor state): tools/drag.ts calls it, and the run-drag modules can't import snap.ts (straight.28).

/** Directions this close (sine of the angle) count as exactly parallel: rounding only. */
const PARALLEL = 1e-9;

/** A world box: what the canvas shows. */
export type ViewBox = { min: Point; max: Point };

/** The world box a camera shows. */
export function viewBox(camera: { center: Point; zoom: number; viewport: { width: number; height: number } }): ViewBox {
  const hw = camera.viewport.width / 2 / camera.zoom;
  const hh = camera.viewport.height / 2 / camera.zoom;
  return { min: { x: camera.center.x - hw, y: camera.center.y - hh }, max: { x: camera.center.x + hw, y: camera.center.y + hh } };
}

/** Whether segment a → b has a point in the box (either end inside, or its middle). */
function onScreen(a: Point, b: Point, box: ViewBox): boolean {
  const inside = (p: Point): boolean => p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
  return inside(a) || inside(b) || inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}

/**
 * The lined-up distance across the run nearest to `raw` (the pointer's distance across, along `across`), within
 * `tolerance`, and its mark; null when no line is in range. The mark is an aligned snap at the run's middle, moved,
 * with a guide from the middle of the wall it lines up with.
 */
export function acrossSnap(doc: Document, wallIds: readonly string[], across: Point, raw: number, tolerance: number, box: ViewBox | null): { distance: number; snap: SnapResult } | null {
  const run = new Set(wallIds);
  const own: { offset: number; centre: boolean }[] = [];
  let middle: Point | null = null;
  for (const id of wallIds) {
    const f = wallFrame(doc, id);
    if (!f) continue;
    const c = dot(f.a, across);
    own.push({ offset: c, centre: true }, { offset: c + f.half, centre: false }, { offset: c - f.half, centre: false });
    middle ??= { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
  }
  if (!middle) return null;
  let best: { distance: number; guide: Point } | null = null;
  for (const id of sortedIds(doc.walls)) {
    const f = run.has(id) ? null : wallFrame(doc, id);
    if (!f || doc.walls[id]?.column || Math.abs(cross(f.dir, { x: -across.y, y: across.x })) > PARALLEL) continue;
    if (box && !onScreen(f.a, f.b, box)) continue;
    const c = dot(f.a, across);
    const targets = [{ offset: c, centre: true }, { offset: c + f.half, centre: false }, { offset: c - f.half, centre: false }];
    for (const t of targets) {
      for (const o of own) {
        if (o.centre !== t.centre) continue; // face to face, or centre to centre
        const d = t.offset - o.offset;
        if (Math.abs(d - raw) > tolerance || (best && Math.abs(d - raw) >= Math.abs(best.distance - raw))) continue;
        best = { distance: d, guide: { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 } };
      }
    }
  }
  if (!best) return null;
  const point = { x: middle.x + across.x * best.distance, y: middle.y + across.y * best.distance };
  return { distance: best.distance, snap: { point, kind: "aligned", guides: [best.guide] } };
}
