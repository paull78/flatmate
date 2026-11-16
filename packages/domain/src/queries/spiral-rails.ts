import type { Point } from "@fm/protocol";
import { sortedIds } from "../graph";
import { stairRuleOf } from "../kinds";
import { memo } from "../memo";
import { EPS, type Document, type HandrailKind, type LayoutObject, type Placement } from "../model";
import { openSpans, type Span } from "./edge-spans";
import { footprints, sizeOf } from "./footprints";
import { againstSpans } from "./guards";
import { HANDRAIL_HEIGHT, HANDRAIL_INSET, type RailKnot } from "./handrails";
import { spiralLanding, spiralTreads, stairBase, stairGeometry } from "./stairs";
import { ceilingOver, placementRange } from "./vertical";

// A spiral's rail and balustrade (AC-12, edge-catch.06), in the treads' frame: centred, x across, +y toward the back edge.
// Worked out from the geometry, read by the plan and 3D alike, and only drawn: nothing here refuses anything. What they are,
// Railing or Glass, is the stair's stored setting (guards.28), carried here as a flight's rows carry it.
//
//          back: on the deck's edge, closed by its slab, so you walk off forward
//     ┌───────────┬───────────┐
//     │    last   ┊ landing  ║│   ║ a rail on an open side: the landing's right one and front one
//     │ ╭─ tread  ┊          ║│   ┊ no rail where the last tread meets it: you step off sideways
//     │╱          ●═══════════│   ╭ the balustrade, just inside the treads' outer edge, rising with them
//     │╲      treads       ╱  │
//     └───────────────────────┘

/** One straight stretch of a landing's rail: level, from the landing's top `bottom` to `top`. */
export type LandingRail = { a: Point; b: Point; bottom: number; top: number };
/**
 * A spiral's rails: the landing's, and its balustrade on the circle of `radius`. The balustrade's `knots` run low to high,
 * `a` the degrees clockwise from `start`, the first tread's low end, and the last knot the last tread's high end. `kind`
 * is the stair's setting, for both.
 */
export type SpiralRails = { landing: readonly LandingRail[]; radius: number; start: number; knots: readonly RailKnot[]; kind: Exclude<HandrailKind, "none"> };

/** How the treads' frame lies in the world: a stair's `at` is its back edge's middle. */
function framer(p: Placement, d: number): (q: Point) => Point {
  const r = (p.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const centre = { x: p.at.x + (d / 2) * s, y: p.at.y - (d / 2) * c };
  return (q) => ({ x: centre.x + q.x * c - q.y * s, y: centre.y + q.x * s + q.y * c });
}

/**
 * The rails on the landing's sides, each moved in to stand on it and short of the side's ends, so they meet at a corner
 * inside the box. Three sides can have one; what's against a wall as tall as the rail or a deck at the landing's height has none.
 * The fourth, from the back edge to the centre, is where the last tread meets the landing, and never has one.
 */
function landingRails(doc: Document, w: number, d: number, world: (q: Point) => Point, bottom: number): LandingRail[] {
  const ring = spiralLanding(w, d);
  return ring.slice(0, -1).flatMap((a, i) => {
    const b = ring[i + 1] ?? a;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const [wa, wb] = [world(a), world(b)];
    const top = Math.min(bottom + HANDRAIL_HEIGHT, ceilingOver(doc, [wa, wb]));
    if (length <= 0 || top <= bottom + EPS) return [];
    const edge = { a: wa, b: wb, normal: { x: (wb.y - wa.y) / length, y: -(wb.x - wa.x) / length } }; // the ring is counter-clockwise: its right is outward
    const inward = { x: (-(b.y - a.y) * HANDRAIL_INSET) / length, y: ((b.x - a.x) * HANDRAIL_INSET) / length };
    const point = (t: number): Point => ({ x: a.x + ((b.x - a.x) * t) / length + inward.x, y: a.y + ((b.y - a.y) * t) / length + inward.y });
    return openSpans(length, againstSpans(doc, edge, length, bottom, top, null))
      .map(([from, to]): Span => [from + HANDRAIL_INSET, to - HANDRAIL_INSET])
      .filter(([from, to]) => to > from)
      .map(([from, to]): LandingRail => ({ a: point(from), b: point(to), bottom, top }));
  });
}

/** One spiral's rails, or null when it has no sizes or range. The rail's line rises from the first tread's top to the landing's. */
function railsOf(doc: Document, p: Placement, object: LayoutObject): SpiralRails | null {
  const rule = stairRuleOf(object.kind);
  const size = sizeOf(doc, p);
  const range = placementRange(doc, p.id);
  const kind = object.handrail ?? "railing";
  if (!rule || !size || !range || kind === "none") return null; // None draws no rail (edges.06)
  const base = stairBase(doc, p.id) ?? range.bottom;
  const g = stairGeometry(rule, size.w, size.d, range.top - base, object.riser ?? null);
  const world = framer(p, size.d);
  const radius = Math.min(size.w, size.d) / 2 - HANDRAIL_INSET;
  const treads = spiralTreads(rule, g.treads);
  const start = treads[0]?.to ?? 90;
  const turn = start - (treads.at(-1)?.from ?? 90);
  const ceiling = ceilingOver(doc, footprints(doc).get(p.id) ?? []);
  const [low, high] = [base + g.riser + HANDRAIL_HEIGHT, range.top + HANDRAIL_HEIGHT];
  const meets = low < ceiling && ceiling < high ? [(turn * (ceiling - low)) / (high - low)] : [];
  const line = (a: number): number => low + ((high - low) * a) / turn;
  const knots = turn <= 0 ? [] : [0, ...meets, turn].map((a): RailKnot => ({ a, top: Math.min(line(a), ceiling), foot: line(a) - HANDRAIL_HEIGHT }));
  return { landing: landingRails(doc, size.w, size.d, world, range.top), radius, start, knots, kind };
}

/** Every spiral's rails by its object. A stair has one pose in every layout (I19), so one placement says it. */
export const spiralRails = memo((doc: Document): ReadonlyMap<string, SpiralRails> => {
  const out = new Map<string, SpiralRails>();
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const object = p ? doc.objects[p.object] : undefined;
    if (!p || !object || out.has(object.id) || stairRuleOf(object.kind)?.shape !== "spiral") continue;
    const rails = railsOf(doc, p, object);
    if (rails) out.set(object.id, rails);
  }
  return out;
});
