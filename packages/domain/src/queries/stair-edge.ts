import { err, ok, type Point, type Result } from "@fm/protocol";
import type { StairEdgeRefusal } from "../errors";
import { convexOverlap, distanceToSegment, inConvex, projectOnSegment } from "../geometry";
import { defaultSides, kindConfigs, stairRuleOf, type Side, type Sides } from "../kinds";
import type { StairRule } from "../stairs";
import type { Document } from "../model";
import { deckViews } from "./decks";
import { floorWallBodies, roundMm, sideBand } from "./footprints";
import { MIN_RISERS, goingFor, recommendedRun, risersFor, spiralLandingWidth, spiralTreads, stairRise } from "./stairs";
import { surfaceTop } from "./vertical";

// A stair on a deck's edge (stairdraw.18, .20, spec "Catching an edge"): the domain says which edges a stair can go up
// to and what stair hangs off a point on one; the editor adds only the pointer part, MCP and the toast only word the
// refusals. The surface is given (the viewed level's, or the floor for MCP), never found by the landing rule.

/** How the stair goes up to the edge: a straight flight, or an L turning left or right as seen facing the edge. */
export type StairEdgeShape = "straight" | "l-left" | "l-right";
/** A stair asked for at `at` on one of `deck`'s edges, standing on `surface` (a deck's ID, or null for the floor). */
export type StairRequest = { state: string; kind: string; deck: string; at: Point; shape: StairEdgeShape; surface: string | null };
/** An edge a stair can go up to, from `a` to `b` along the deck's ring, `normal` the unit vector away from the deck. */
export type StairEdge = { deck: string; a: Point; b: Point; normal: Point };
/**
 * One flight as placed: its back edge's middle, rotation, size, rise, the decks it reaches and starts at, either a
 * deck's ID or STAIR_LANDING for the L's own landing, which has no ID until placeStair adds it, and its use-zone sides,
 * null for the kind's defaults (a spiral's are its entry side's, stairdraw.15).
 */
/** One flight placeStair places; `leftEntry`: a winder entered from the left (steps.39), false for any other. */
export type StairFlight = { at: Point; rotation: number; w: number; d: number; h: number; reaches: string; startsAt: string | null; sides: Sides | null; leftEntry: boolean };
/** An L's landing deck: its centre, size, rotation and top. */
export type StairLanding = { at: Point; w: number; d: number; rotation: number; top: number };
/** What placeStair places: flights of one kind standing on one surface, and an L's landing. */
export type StairParts = { kind: string; surface: string | null; flights: StairFlight[]; landing: StairLanding | null };

/** The L's landing in a flight's `reaches` or `startsAt`: not a valid ID, so no deck has it. */
export const STAIR_LANDING = "(landing)";

/** How far from an edge a point may lie and still be on it: 1 cm (spec "MCP"). */
export const EDGE_TOLERANCE = 0.01;
/** How far outside an edge a wall must be for the edge to be flush against it: less than the thinnest wall. */
const FLUSH_PROBE = 0.01;
/** An edge as long as the stair is wide still takes it. */
const LENGTH_EPS = 1e-9;

/**
 * The edges a stair `width` wide standing on `surface` can go up to (stairdraw.20): the edges of every deck whose top
 * is above the surface's top, but not the surface deck's own, not one shorter than `width`, and not one flush against a
 * floor wall's face (a wall lies just outside its middle, so nothing stands in front of it; pillars.24). A deck's edges
 * are its slab's boundary (stairwell.17): a hole's sides face into it, and a notch's open side is none. By deck ID,
 * then boundary order.
 */
export function stairEdges(doc: Document, surface: string | null, width: number): StairEdge[] {
  const base = surfaceTop(doc, surface);
  const walls = [...floorWallBodies(doc).values()];
  return deckViews(doc).flatMap((deck) => {
    if (deck.id === surface || deck.top <= base) return [];
    return deck.edges.flatMap(({ a, b }) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len + LENGTH_EPS < width) return [];
      const normal = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }; // the slab is on its left: right is off it
      const probe = { x: (a.x + b.x) / 2 + normal.x * FLUSH_PROBE, y: (a.y + b.y) / 2 + normal.y * FLUSH_PROBE };
      return walls.some((quad) => inConvex(probe, quad, 0)) ? [] : [{ deck: deck.id, a, b, normal }];
    });
  });
}

/**
 * The stair hanging off `at` on one of `deck`'s edges (stairdraw.18): its back edge's middle is `at` projected onto the
 * nearest edge that catches, within 1 cm, to the millimetre, a spiral's short of the end its landing would leave the edge
 * by; it is turned so its back is on the edge and up points toward the deck. Its width is the kind's default, its rise the deck's top less the surface's, its run the kind's
 * recommended run for that rise (a spiral's is its diameter). An L (spec "The L") is refused for a kind that doesn't
 * turn; checks run kind, shape, edge, then the L's rise.
 */
export function stairOnEdge(doc: Document, req: StairRequest): Result<StairParts, StairEdgeRefusal> {
  const rule = stairRuleOf(req.kind);
  const w = kindConfigs(req.kind)[0]?.w;
  if (rule === null || w === undefined) return err("kindNotStair");
  if (req.shape !== "straight" && !rule.turns) return err("doesNotTurn");
  const edge = nearestEdge(stairEdges(doc, req.surface, w).filter((e) => e.deck === req.deck), req.at);
  if (edge === null) return err("notOnEdge");
  const projected = projectOnSegment(req.at, edge.a, rule.shape === "spiral" ? shortOfLanding(edge, w) : edge.b).point;
  const back = { x: roundMm(projected.x), y: roundMm(projected.y) };
  const rotation = facing(edge.normal);
  const h = stairRise(doc, req.deck, req.surface);
  if (req.shape === "straight") {
    const d = roundMm(recommendedRun(rule, h, null, w));
    const leftEntry = rule.shape === "winder" && entersLeft(doc, req.kind, back, rotation, w, d);
    const sides = rule.shape === "spiral" ? newSides(req.kind, h) : rule.shape === "winder" ? onlySide(leftEntry ? "left" : "right") : null;
    const flight: StairFlight = { at: back, rotation, w, d, h, reaches: req.deck, startsAt: null, sides, leftEntry };
    return ok({ kind: req.kind, surface: req.surface, flights: [flight], landing: null });
  }
  const l = theL(rule, { back, rotation, w, h, deck: req.deck, base: surfaceTop(doc, req.surface) }, req.shape === "l-right" ? 1 : -1);
  return l === null ? err("tooLowToTurn") : ok({ kind: req.kind, surface: req.surface, ...l });
}

/**
 * Whether a winder `w` × `d` with its back's middle at `back` enters from the left (steps.39): when its right entry's
 * zone (beside the front square, the kind's zone deep, as `frontSquare` gives it) meets a floor wall's body and the
 * left's doesn't. Both blocked, or neither: the right, as a winder placed any other way.
 */
function entersLeft(doc: Document, kind: string, back: Point, rotation: number, w: number, d: number): boolean {
  const depth = kindConfigs(kind)[0]?.zone ?? null;
  if (depth === null || depth <= 0) return false;
  const walls = [...floorWallBodies(doc).values()];
  const blocked = (side: "left" | "right"): boolean => {
    const band = sideBand({ at: back, rotation }, w, d, { depth, start: Math.max(0, d - w), end: 0 }, side);
    return walls.some((quad) => convexOverlap(band, quad));
  };
  return blocked("right") && !blocked("left");
}

/**
 * Where a spiral's back's middle has to stop on `edge`: a stair's right runs from `a` to `b`, since the slab is on the
 * edge's left and the stair faces away from it, so its landing's back runs toward `b`. An edge that catches is at least
 * the stair's width, so this is never before `a`.
 */
function shortOfLanding(edge: StairEdge, w: number): Point {
  const keep = 1 - spiralLandingWidth(w) / Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
  return { x: edge.a.x + (edge.b.x - edge.a.x) * keep, y: edge.a.y + (edge.b.y - edge.a.y) * keep };
}

/** The straight flight an L starts from: its back on the edge, its rotation, width, whole rise, the deck and the surface's top. */
type LBase = { back: Point; rotation: number; w: number; h: number; deck: string; base: number };

/**
 * An L's parts (spec "The L", stairdraw.05): the R risers split, ceil(R/2) for the upper flight from the edge, the rest
 * for the lower one; both at the riser h / R and the kind's going for it. `side` is +1 for a lower flight toward the
 * stair's +x (the right, seen from the floor facing the edge), −1 for the left. Null when a flight would get fewer than
 * two risers.
 *
 *        edge ═══╤═══╤═══      upper: back on the edge, front facing `front`, run going × (n2 − 1)
 *                │ ▲ │
 *   left ◄ ──────┼───┼────── ► right (side +1, along `across`)
 *          lower │ L │ lower   landing w × w, centred on the upper's axis; the lower's back on its side edge
 */
function theL(rule: StairRule, s: LBase, side: 1 | -1): Pick<StairParts, "flights" | "landing"> | null {
  const risers = risersFor(rule, s.h, null);
  const upperN = Math.ceil(risers / 2);
  const lowerN = risers - upperN;
  if (lowerN < MIN_RISERS) return null;
  const going = goingFor(rule.going, s.h / risers);
  const r = (s.rotation * Math.PI) / 180;
  const front = { x: Math.sin(r), y: -Math.cos(r) };
  const across = { x: Math.cos(r), y: Math.sin(r) };
  const upperD = roundMm(going * (upperN - 1));
  const top = roundMm(s.base + (s.h * lowerN) / risers);
  const centre = mm({ x: s.back.x + front.x * (upperD + s.w / 2), y: s.back.y + front.y * (upperD + s.w / 2) });
  const lowerBack = mm({ x: centre.x + across.x * side * (s.w / 2), y: centre.y + across.y * side * (s.w / 2) });
  const upper: StairFlight = { at: s.back, rotation: s.rotation, w: s.w, d: upperD, h: s.h, reaches: s.deck, startsAt: STAIR_LANDING, sides: null, leftEntry: false };
  const lower: StairFlight = { at: lowerBack, rotation: (s.rotation + (side === 1 ? 90 : 270)) % 360, w: s.w, d: roundMm(going * (lowerN - 1)), h: roundMm(top - s.base), reaches: STAIR_LANDING, startsAt: null, sides: null, leftEntry: false };
  return { flights: [upper, lower], landing: { at: centre, w: s.w, d: s.w, rotation: s.rotation, top } };
}

/** Each side's outward direction in footprint angles (counter-clockwise from +x, 90° toward the back), front first. */
const SIDE_ANGLES: readonly [Side, number][] = [["front", 270], ["right", 0], ["left", 180], ["back", 90]];

/**
 * The side of a spiral's box you walk in from to its first tread (stairdraw.15, edge-catch.23, spec "The spiral"): it
 * rises clockwise, so you step onto tread 0 across its `to` radius in `spiralTreads` moving clockwise, coming from a
 * quarter turn counter-clockwise of it. The side whose outward direction is nearest that angle; on a tie, the first in
 * the order front, right, left, back. 10 risers: 9 treads, tread 0 starts at 0°, you come from 90°, the back.
 *
 *            back 90°
 *          ┌─────────┐
 *   left   │    ·    │  right 0° (360°)
 *   180°   └─────────┘
 *            front 270°
 */
export function spiralEntrySide(rule: StairRule, risers: number): Side {
  const entry = (spiralTreads(rule, Math.max(1, risers - 1))[0]?.to ?? 90) + 90;
  const gap = (deg: number): number => Math.abs((((entry - deg) % 360) + 540) % 360 - 180);
  let best: [Side, number] = ["front", Infinity];
  for (const [side, deg] of SIDE_ANGLES) if (gap(deg) < best[1]) best = [side, gap(deg)];
  return best[0];
}

/**
 * The use-zone sides a new piece of `kind` gets at height `h` (edge-catch.10, .15): a spiral's one zone on its entry
 * side for that rise, any other kind's defaults. Every path that makes a piece reads it (placeObject, setObjectKind,
 * stairOnEdge), with the height after the stair's link; a later change of rise keeps the sides (stairdraw.15).
 */
export function newSides(kind: string, h: number): Sides | null {
  const rule = stairRuleOf(kind);
  return rule?.shape === "spiral" ? onlySide(spiralEntrySide(rule, risersFor(rule, h, null))) : defaultSides(kind);
}

const onlySide = (side: Side): Sides => ({ front: side === "front", back: side === "back", left: side === "left", right: side === "right" });

const mm = (p: Point): Point => ({ x: roundMm(p.x), y: roundMm(p.y) });

/** The edge nearest to `p` within the tolerance (the first on a tie), or null. */
function nearestEdge(edges: readonly StairEdge[], p: Point): StairEdge | null {
  let best: { edge: StairEdge; gap: number } | null = null;
  for (const edge of edges) {
    const gap = distanceToSegment(p, edge.a, edge.b);
    if (gap <= EDGE_TOLERANCE + LENGTH_EPS && (best === null || gap < best.gap)) best = { edge, gap };
  }
  return best?.edge ?? null;
}

/** The whole-degree rotation whose front faces `normal`: at rotation r a piece's front faces (sin r, −cos r). */
function facing(normal: Point): number {
  const r = Math.round((Math.atan2(normal.x, -normal.y) * 180) / Math.PI);
  return ((r % 360) + 360) % 360 + 0;
}
