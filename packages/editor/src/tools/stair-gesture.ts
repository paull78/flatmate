import { EPS, add, dot, footprintQuad, isFloor, kindConfigs, length, rangeOf, scale, stairEdges, stairFits, stairOnEdge, stairRuleOf, sub, floorWallBodies, type Document, type StairEdge, type StairEdgeShape, type StairFlight } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { activeStateId, viewedLevel, type EditorState } from "../state";
import type { ObjectGhost } from "./types";

// The pointer part of the stair gesture (stairdraw.11, .20, edge-catch.12, spec "Catching an edge"): which of the
// domain's stair edges the cursor catches, and where on it the stair's back goes. The edges, the stair hanging off a
// point and its fit are the domain's (stairEdges, stairOnEdge, stairFits), so the ghost and the commit read the same answer.
//
//         deck
//   ─────────────────  0.30 m behind the edge
//   a ════════════ b   the edge (normal out of the deck)
//   │▒▒ near  ▒▒▒▒▒│   within 0.30 m of it the nearest such edge catches, whatever is held
//   │░░ the band ░░│   in front, out to the end of the run the edge's rise gives
//   └──────────────┘   farther out a caught edge holds until the cursor is 0.30 m outside this

/** How far behind an edge (over the deck) its band starts, and how near an edge the cursor catches it whatever is held. */
export const CATCH_BEHIND = 0.3;
/** How far outside its band a caught edge still holds. */
export const HOLD = 0.3;
/** Once the top is fixed, the cursor turns an L past this far sideways along the edge, */
export const L_SIDEWAYS = 0.45;
/** and past this angle off straight out (spec "The gesture"). */
export const L_ANGLE_DEG = 30;

/** What is being drawn: the layout, the stair kind and the surface it stands on (the viewed level's, stairdraw.18). */
export type StairAsk = { state: string; kind: string; surface: string | null };

/** The stair being drawn, when the armed kind is a stair and the layout and level are known; on the viewed level's surface (stairdraw.18). */
export function stairAsk(state: EditorState): StairAsk | null {
  const layout = activeStateId(state);
  const level = viewedLevel(state);
  if (layout === null || !level || stairRuleOf(state.objectKind) === null) return null;
  return { state: layout, kind: state.objectKind, surface: isFloor(level) ? null : state.viewedDeck };
}

/**
 * The edge the cursor catches, or null. Within CATCH_BEHIND of one or more edges whose band holds the cursor, the
 * nearest of them, on any deck, whatever is held; a tie (within EPS) keeps `held` (edge-catch.02, .16). Farther out, a `held` edge
 * that still exists holds while the cursor is within HOLD of its band (stairdraw.11); else the nearest edge whose band
 * holds the cursor.
 */
export function catchEdge(doc: Document, ask: StairAsk, cursor: Point, held: StairEdge | null): StairEdge | null {
  const w = kindConfigs(ask.kind)[0]?.w;
  if (w === undefined) return null;
  const edges = stairEdges(doc, ask.surface, w).map((edge) => ({ edge, run: runOf(doc, ask, edge) }));
  const banded = edges
    .filter((e) => inBand(e.edge, e.run, cursor, 0))
    .map((e) => ({ edge: e.edge, gap: Math.abs(dot(sub(cursor, e.edge.a), e.edge.normal)) })); // within the band's length, the distance to the edge
  const isHeld = (e: StairEdge): boolean => held !== null && sameEdge(e, held);
  const nearest = (list: readonly { edge: StairEdge; gap: number }[]): StairEdge | null =>
    list.reduce<{ edge: StairEdge; gap: number } | null>((best, e) => (best === null || e.gap < best.gap - EPS || (e.gap <= best.gap + EPS && isHeld(e.edge)) ? e : best), null)?.edge ?? null;
  const near = banded.filter((e) => e.gap <= CATCH_BEHIND);
  if (near.length > 0) return nearest(near);
  const kept = edges.find((e) => isHeld(e.edge));
  if (kept && inBand(kept.edge, kept.run, cursor, HOLD)) return kept.edge;
  return nearest(banded);
}

/**
 * How the slide snaps: to the world's `step` lattice, flush to an end of the edge within `end` metres, and to `walls`,
 * the places along the edge that put the flight's long side on a wall face (wallSides); null (Ctrl) for none.
 */
export type SlideSnap = { step: number; end: number; walls: readonly number[] } | null;

/** How near a wall's face a flight's long side snaps to it (riser, AC-08). */
const WALL_SNAP = 0.3;
const PARALLEL_SIN = Math.sin(Math.PI / 180); // a face counts within 1° of the run

/**
 * The places along `edge` (metres from its start) where the middle of a flight `width` wide and `run` long, hanging off
 * the edge, has a long side on a floor wall's face: faces running with the flight, along some of its run (AC-08).
 */
export function wallSides(doc: Document, edge: StairEdge, run: number, width: number): readonly number[] {
  const u = scale(sub(edge.b, edge.a), 1 / length(sub(edge.b, edge.a)));
  const out: number[] = [];
  for (const body of floorWallBodies(doc).values()) {
    const middle = scale(body.reduce((sum, q) => add(sum, q), { x: 0, y: 0 }), 1 / body.length);
    body.forEach((p, i) => {
      const q = body[(i + 1) % body.length];
      if (!q) return;
      const face = sub(q, p);
      const len = length(face);
      if (len === 0 || Math.abs(dot(face, u)) / len > PARALLEL_SIN) return; // across the run
      const [from, to] = [dot(sub(p, edge.a), edge.normal), dot(sub(q, edge.a), edge.normal)];
      if (Math.max(from, to) <= 0 || Math.min(from, to) >= run) return; // beside the flight's run nowhere
      const at = dot(sub(p, edge.a), u);
      out.push(dot(sub(middle, p), u) < 0 ? at + width / 2 : at - width / 2); // the flight on the face's open side
    });
  }
  return out;
}

/**
 * Where on `edge` the back's middle of a stair `width` wide goes for `cursor`: its projection, kept within the edge so
 * the whole width fits, flush to an end within `snap.end` (the snap tolerance, stairdraw.59), else flush on the nearest
 * wall within 0.30 m (AC-08), else on the world's
 * `snap.step` lattice along the edge (its middle's world coordinate along the edge a multiple of the step, so on an
 * axis-aligned edge it lands on the grid under the cursor). With no snap (Ctrl), the projection to the centimetre.
 */
export function slideOnEdge(edge: StairEdge, cursor: Point, width: number, snap: SlideSnap): Point {
  const len = length(sub(edge.b, edge.a));
  const u = scale(sub(edge.b, edge.a), 1 / len);
  const t = dot(sub(cursor, edge.a), u);
  const lo = width / 2;
  const hi = len - width / 2;
  const origin = dot(edge.a, u); // the edge's start, measured along it from the world's origin
  const onLattice = (step: number): number => Math.round((t + origin) / step) * step - origin;
  const wall = snap === null ? undefined : snap.walls.filter((w) => Math.abs(w - t) <= WALL_SNAP).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
  const along = snap === null ? onLattice(0.01) : t - lo <= snap.end ? lo : hi - t <= snap.end ? hi : (wall ?? onLattice(snap.step));
  return add(edge.a, scale(u, Math.min(hi, Math.max(lo, along))));
}

/**
 * The shape the cursor picks once the top is fixed at `at` on `edge` (stairdraw.06): with u its offset along the edge
 * and v its offset out from it, an L when |u| > L_SIDEWAYS and atan2(|u|, v) > L_ANGLE_DEG (a cursor on or behind the
 * edge, v ≤ 0, always is), turning toward the cursor's side. Seen from the floor facing the edge, the right is `normal`
 * turned a quarter counter-clockwise, the domain's +across (stairOnEdge). Straight for a kind that doesn't `turn`.
 *
 *            edge ═════●═════         ● the fixed top
 *          l-left  ╲ 30° │ 30° ╱  l-right
 *     ◄ |u| > 0.45  ╲    │    ╱  |u| > 0.45 ►
 *                  straight out
 */
export function shapeFor(edge: StairEdge, at: Point, cursor: Point, turns: boolean): StairEdgeShape {
  const off = sub(cursor, at);
  const u = dot(off, { x: -edge.normal.y, y: edge.normal.x });
  const v = dot(off, edge.normal);
  const sideways = Math.abs(u) > L_SIDEWAYS && Math.atan2(Math.abs(u), v) > (L_ANGLE_DEG * Math.PI) / 180;
  return !turns || !sideways ? "straight" : u > 0 ? "l-right" : "l-left";
}

/**
 * Whether the stair `ask` hanging off `at` on `edge` can turn into an L there: its kind turns and its rise is high
 * enough for two flights (the domain's tooLowToTurn, stairdraw.35). One that can't places on one click (stairdraw.56, .58).
 */
export function turnsAt(doc: Document, ask: StairAsk, edge: StairEdge, at: Point): boolean {
  if (!(stairRuleOf(ask.kind)?.turns ?? false)) return false;
  const l = stairOnEdge(doc, { ...ask, deck: edge.deck, at, shape: "l-right" });
  return l.ok || l.error !== "tooLowToTurn";
}

/** The ghost once the top is fixed at `at`: the shape the `cursor` picks (shapeFor), for the armed kind. */
export function fixedStairGhost(doc: Document, ask: StairAsk, edge: StairEdge, at: Point, cursor: Point): ObjectGhost | null {
  return stairGhost(doc, ask, edge, at, shapeFor(edge, at, cursor, stairRuleOf(ask.kind)?.turns ?? false));
}

/**
 * The ghost of the stair hanging off `at` on `edge` as `shape` (stairOnEdge), red where the commit's fit (stairFits)
 * refuses it (its error in `refused`), with its rise and the deck it reaches; an L carries its lower flight and landing (`l`), all red or green
 * together. An L the domain won't turn (too low, stairdraw.35) is the straight ghost, `shape` "straight". Null where
 * the domain refuses the point.
 */
export function stairGhost(doc: Document, ask: StairAsk, edge: StairEdge, at: Point, shape: StairEdgeShape = "straight"): ObjectGhost | null {
  const asked = stairOnEdge(doc, { ...ask, deck: edge.deck, at, shape });
  const parts = !asked.ok && asked.error === "tooLowToTurn" ? stairOnEdge(doc, { ...ask, deck: edge.deck, at, shape: "straight" }) : asked;
  const config = kindConfigs(ask.kind)[0]?.id;
  const [upper, lower] = parts.ok ? parts.value.flights : [];
  if (!parts.ok || !upper || config === undefined) return null;
  const fit = stairFits(doc, parts.value, ask.state);
  const fits = fit.ok;
  const flight = (f: StairFlight): ObjectGhost => {
    const range = rangeOf(doc, { h: f.h, z: 0 }, footprintQuad(f.at, f.w, f.d, f.rotation), ask.surface);
    return { kind: ask.kind, config, w: f.w, d: f.d, at: f.at, rotation: f.rotation, fits, surface: ask.surface, range, h: f.h };
  };
  const { landing } = parts.value;
  const top = { ...flight(upper), reaches: upper.reaches, ...(fit.ok ? {} : { refused: fit.error }), ...(upper.leftEntry ? { left: true as const } : {}) };
  if (!landing || !lower) return { ...top, shape: "straight" };
  // The lower flight's rise is the landing's height above the surface, where the upper flight's steps begin.
  return { ...top, shape, base: lower.h, l: { lower: flight(lower), landing } };
}

/** The run of the straight stair that `ask` hangs off `edge`: its band's depth in front. */
export function runOf(doc: Document, ask: StairAsk, edge: StairEdge): number {
  const parts = stairOnEdge(doc, { ...ask, deck: edge.deck, at: scale(add(edge.a, edge.b), 0.5), shape: "straight" });
  return parts.ok ? (parts.value.flights[0]?.d ?? 0) : 0;
}

/** Whether `p` lies in the edge's band grown by `margin` on every side. */
function inBand(edge: StairEdge, run: number, p: Point, margin: number): boolean {
  const v = sub(edge.b, edge.a);
  const len = length(v);
  const t = dot(sub(p, edge.a), v) / len;
  const s = dot(sub(p, edge.a), edge.normal);
  return t >= -margin && t <= len + margin && s >= -CATCH_BEHIND - margin && s <= run + margin;
}

const sameEdge = (e: StairEdge, f: StairEdge): boolean => e.deck === f.deck && e.a.x === f.a.x && e.a.y === f.a.y && e.b.x === f.b.x && e.b.y === f.b.y;
