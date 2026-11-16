import { assertNever, type Point } from "@fm/protocol";
import { boxOf, convexOverlap } from "../geometry";
import { sortedIds } from "../graph";
import { stairRuleOf } from "../kinds";
import type { Document, Placement } from "../model";
import { SPIRAL_COLUMN_RADIUS, type SizeCheck, type SizeCheckId, type StairRule } from "../stairs";
import { footprintQuad } from "./footprints";
import { stairBase, stairGeometry, touchedDeck, type StairGeometry } from "./stairs";
import { ceilingOver, placementRange, solids } from "./vertical";

// A stair's warnings (stairs.03, .05, .12, .19): its rules of thumb, headroom over the flight against the pitch line,
// and "doesn't reach" when it no longer touches the deck it reaches. Structured, so Properties and MCP word the same
// facts. Never refusals.

export type StairCheckId = SizeCheckId | "headroom" | "reach";
/** A measured check (value in metres or degrees, its bounds), or the reach check naming the deck. */
export type StairCheck = { id: Exclude<StairCheckId, "reach">; ok: boolean; value: number; min: number | null; max: number | null } | { id: "reach"; ok: boolean; deck: string };

/** A stored size rounds to the millimetre, so a bound holds within half of one; angles within 0.05°. */
const METRE_TOLERANCE = 0.0005;
const DEGREE_TOLERANCE = 0.05;
const deg = (rad: number): number => (rad * 180) / Math.PI;

function measure(id: SizeCheckId, g: StairGeometry, w: number, d: number): number {
  switch (id) {
    case "riser": case "spacing": return g.riser;
    case "going": case "walkingTread": return g.going;
    case "step": return 2 * g.riser + g.going;
    case "width": return w;
    case "slope": return deg(Math.atan(g.riser / g.going));
    case "angle": return deg(Math.atan(g.rise / d));
    case "clearWidth": return w / 2 - SPIRAL_COLUMN_RADIUS;
    case "rise": return g.rise;
    default: return assertNever(id);
  }
}

function bound(b: number | "loft" | undefined, rule: StairRule, riser: number): number | null {
  if (b === undefined) return null;
  if (b !== "loft") return b;
  return rule.going.kind === "loft" ? rule.going.length - rule.going.slope * riser : null;
}

/** A stair's size checks at width w, run d and rise h, in the rule's order. */
export function stairRuleChecks(rule: StairRule, w: number, d: number, h: number, target: number | null): StairCheck[] {
  const g = stairGeometry(rule, w, d, h, target);
  return rule.checks.map((c: SizeCheck): StairCheck => {
    const value = measure(c.id, g, w, d);
    const [min, max] = [bound(c.min, rule, g.riser), bound(c.max, rule, g.riser)];
    const tol = c.id === "slope" || c.id === "angle" ? DEGREE_TOLERANCE : METRE_TOLERANCE;
    return { id: c.id, ok: (min === null || value >= min - tol) && (max === null || value <= max + tol), value, min, max };
  });
}

/**
 * The least headroom over a flight: the ceiling over its footprint less the pitch line at the last nosing, and every
 * solid over it (a piece of the same layout, a deck, a wall) less the pitch line under its far end, the highest it
 * reaches over the flight.
 */
function headroom(doc: Document, p: Placement, g: StairGeometry, quad: readonly Point[], base: number, w: number, flight: boolean): number {
  const r = (p.rotation * Math.PI) / 180;
  const up = { x: -Math.sin(r), y: Math.cos(r) }; // from the front edge (the bottom step) to the back edge
  const front = { x: p.at.x - up.x * g.run, y: p.at.y - up.y * g.run };
  const first = g.knots[0]?.a ?? 0;
  const last = Math.max(first, g.knots[g.knots.length - 1]?.a ?? 0);
  const pitch = (a: number): number => base + g.pitch(Math.min(last, Math.max(first, a)));
  let least = flight ? treadHeadroom(doc, front, up, w, g, last, pitch) : ceilingOver(doc, quad) - pitch(last);
  const box = boxOf(quad);
  for (const s of solids(doc)) {
    if ((s.state !== null && s.state !== p.state) || (s.key.table === "placements" && s.key.id === p.id)) continue;
    if (s.range.bottom <= base + 1e-6 || s.box.minX > box.maxX || s.box.maxX < box.minX || s.box.minY > box.maxY || s.box.maxY < box.minY) continue;
    if (!convexOverlap(s.ring, quad)) continue;
    const far = Math.max(...s.ring.map((q) => (q.x - front.x) * up.x + (q.y - front.y) * up.y));
    least = Math.min(least, s.range.bottom - pitch(far));
  }
  return least;
}

/**
 * A flight's headroom under the ceiling over each tread (roofs.18): the lowest ceiling over the tread's strip, from its
 * nosing to the next (the last one to the back edge), less the pitch line at its nosing; the geometry says where each
 * nosing lies (steps.09). Under a flat ceiling it is the
 * last tread's, as before.
 */
function treadHeadroom(doc: Document, front: Point, up: Point, w: number, g: StairGeometry, last: number, pitch: (a: number) => number): number {
  const side = { x: up.y, y: -up.x };
  const at = (a: number, s: number): Point => ({ x: front.x + up.x * a + side.x * s * (w / 2), y: front.y + up.y * a + side.y * s * (w / 2) });
  let least = Infinity;
  const treads = Math.max(1, g.treads);
  for (let i = 0; i < treads; i += 1) {
    const from = g.nosingAt(i + 1);
    const to = i === treads - 1 ? g.run : g.nosingAt(i + 2);
    least = Math.min(least, ceilingOver(doc, [at(from, -1), at(to, -1), at(to, 1), at(from, 1)]) - pitch(from));
  }
  return least;
}

/** A stair object's warnings, read from its first copy (copies agree, stairs.18); none for furniture. */
export function stairChecks(doc: Document, objectId: string): StairCheck[] {
  const object = doc.objects[objectId];
  const rule = object ? stairRuleOf(object.kind) : null;
  const p = doc.placements[sortedIds(doc.placements).find((id) => doc.placements[id]?.object === objectId) ?? ""];
  const range = p ? placementRange(doc, p.id) : null;
  const base = p ? stairBase(doc, p.id) : null;
  const [w, d] = p && object ? [object.w[p.config], object.d[p.config]] : [undefined, undefined];
  if (!object || !rule || !p || !range || base === null || w === undefined || d === undefined) return [];
  const h = range.top - base; // the rise its steps count (stairs.49)
  const target = object.riser ?? null;
  const checks = stairRuleChecks(rule, w, d, h, target);
  if (rule.headroom !== null) { // a spiral's pitch is its rise: headroom over its top tread
    const value = headroom(doc, p, stairGeometry(rule, w, d, h, target), footprintQuad(p.at, w, d, p.rotation), base, w, rule.shape === "flight" || rule.shape === "winder");
    checks.push({ id: "headroom", ok: value >= rule.headroom - METRE_TOLERANCE, value, min: rule.headroom, max: null });
  }
  if (typeof object.reaches === "string") checks.push({ id: "reach", ok: touchedDeck(doc, p) === object.reaches, deck: object.reaches });
  return checks;
}
