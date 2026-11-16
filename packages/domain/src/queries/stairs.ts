import { assertNever, type Point } from "@fm/protocol";
import { SPIRAL_COLUMN_RADIUS, SPIRAL_WALKING_LINE, WINDERS, type GoingRule, type StairRule } from "../stairs";
import { distanceToSegment } from "../geometry";
import { stairRuleOf } from "../kinds";
import type { Document, LayoutObject, Placement } from "../model";
import { deckViews, onSlab } from "./decks";
import { roundMm } from "./footprints";
import { placementRange, surfaceTop } from "./vertical";

// A stair's numbers from its box (stairs.01, .03, .20): the riser count rounds the rise up by the kind's largest
// riser; a flight has one tread fewer than risers (the last riser steps onto what it reaches), a ladder one rung fewer
// than spaces; the going is the run over the treads (over the spaces for a ladder; on the walking line for a spiral).

/** A point of a stair's pitch line: `a` metres up the run from the front edge, `z` above where its steps begin. */
export type PitchKnot = { a: number; z: number };

/**
 * `treads` are a ladder's rungs; `pitch(a)` is the pitch line's height at `a` metres along the run from the front
 * edge: through every nosing for a flight, through every rung for a ladder. The geometry owns the walk (steps.09):
 * `knots` are the pitch line's points from low to high (level before the first and past the last, for the readers
 * that clamp), `nosingAt(k)` where tread k's nosing lies (a ladder's rung k), and `runFor(going)` the run a straight
 * going gives with these risers.
 */
export type StairGeometry = {
  rise: number; risers: number; riser: number; treads: number; going: number; run: number; pitch: (a: number) => number;
  knots: readonly PitchKnot[]; nosingAt: (k: number) => number; runFor: (going: number) => number;
};

/** Fewer than two risers is no stair: one step is a platform's edge. A rule may ask more (`minRisers`). */
export const MIN_RISERS = 2;
/** Rounds a rise that is an exact multiple of the largest riser down to that multiple, not one more. */
const RISER_EPS = 1e-9;

/** The riser count for a rise: the rise rounded up by the stair's target, else its kind's largest riser, at least its rule's fewest (riser.01, .09, steps.09). */
export function risersFor(rule: StairRule, h: number, target: number | null): number {
  return Math.max(rule.minRisers, Math.ceil(h / (target ?? rule.maxRiser) - RISER_EPS));
}

/** The going a kind recommends for a riser; a spiral's is measured on its walking line. */
export function goingFor(going: GoingRule, riser: number): number {
  switch (going.kind) {
    case "step":
      return Math.min(going.max, Math.max(going.min, going.length - 2 * riser));
    case "loft":
      return going.length - going.slope * riser;
    case "angle":
      return riser / Math.tan((going.deg * Math.PI) / 180);
    case "turn":
      return (SPIRAL_COLUMN_RADIUS + SPIRAL_WALKING_LINE) * ((going.deg * Math.PI) / 180);
    default:
      return assertNever(going);
  }
}

/** A stair's numbers at width w, depth (run) d, height (rise) h and target riser (null for its kind's). */
export function stairGeometry(rule: StairRule, w: number, d: number, h: number, target: number | null): StairGeometry {
  const risers = risersFor(rule, h, target);
  const riser = h / risers;
  const treads = risers - 1;
  switch (rule.shape) {
    case "flight": {
      const going = d / treads;
      const knots = [{ a: 0, z: riser }, { a: (treads - 1) * going, z: treads * riser }];
      return { rise: h, risers, riser, treads, going, run: d, pitch: (a) => riser + (a * riser) / going, knots, nosingAt: (k) => (k - 1) * going, runFor: (g) => g * treads };
    }
    case "winder": {
      // Three winders in the w × w square at the front, then straight treads (steps.04, .09): the pitch line is level at
      // tread 4's nosing (4 risers up, at a = w) across the square, then rises as a flight's.
      const straight = treads - WINDERS;
      const going = straight > 0 ? (d - w) / straight : 0;
      const pitch = (a: number): number => (WINDERS + 1) * riser + (Math.max(0, a - w) * riser) / going;
      const nosingAt = (k: number): number => (k <= WINDERS ? ((k - 1) * w) / WINDERS : w + (k - WINDERS - 1) * going);
      const knots = [{ a: w, z: (WINDERS + 1) * riser }, { a: nosingAt(treads), z: treads * riser }];
      return { rise: h, risers, riser, treads, going, run: d, pitch, knots, nosingAt, runFor: (g) => w + g * straight };
    }
    case "ladder": {
      const going = d / risers;
      const knots = [{ a: 0, z: 0 }, { a: d, z: h }];
      return { rise: h, risers, riser, treads, going, run: d, pitch: (a) => (a * riser) / going, knots, nosingAt: (k) => k * going, runFor: (g) => g * risers };
    }
    case "spiral": {
      const going = goingFor(rule.going, riser); // on the walking line
      return { rise: h, risers, riser, treads, going, run: w, pitch: () => h, knots: [{ a: 0, z: h }], nosingAt: (k) => (k - 1) * going, runFor: () => w };
    }
    default:
      return assertNever(rule.shape);
  }
}

/** The run a kind recommends for a rise ("Fit run", stairs.15): its going times the treads; a ladder at its angle; a spiral's diameter `w`. */
export function recommendedRun(rule: StairRule, h: number, target: number | null, w = 0): number {
  const risers = risersFor(rule, h, target);
  const riser = h / risers;
  switch (rule.shape) {
    case "flight":
      return goingFor(rule.going, riser) * (risers - 1);
    case "winder":
      return w + goingFor(rule.going, riser) * (risers - 1 - WINDERS);
    case "ladder":
      return h / Math.tan(((rule.going.kind === "angle" ? rule.going.deg : 90) * Math.PI) / 180);
    case "spiral":
      return w;
    default:
      return assertNever(rule.shape);
  }
}

/** A spiral's turn over `treads` treads, in degrees (stairs.21); 0 for a flight or a ladder. */
export function stairTurn(rule: StairRule, treads: number): number {
  return rule.going.kind === "turn" ? treads * rule.going.deg : 0;
}

/** A spiral tread's angles in degrees, `from` < `to`. */
export type SpiralTread = { from: number; to: number };

/**
 * A spiral's treads, the first (the bottom step) first, as angles in its footprint: counter-clockwise from the right
 * (x across), 90° toward the back edge. It rises clockwise and its last tread ends at 90°, so it arrives at its back
 * edge (stairs.21); the piece's rotation turns them with it.
 */
export function spiralTreads(rule: StairRule, treads: number): SpiralTread[] {
  const step = stairTurn(rule, 1);
  return Array.from({ length: treads }, (_, i) => ({ from: 90 + (treads - i - 1) * step, to: 90 + (treads - i) * step }));
}

/**
 * A spiral's top landing (edge-catch.06, .11): the quarter its treads leave open at the top, from the centre to the
 * box's right and back sides, counter-clockwise from the centre, in the treads' frame (centred, x across, +y toward the
 * back edge). It lies at the stair's top: you step off the last tread (ending at 90°) onto it, then forward onto the
 * deck. Drawn only: the stair's box already holds it, so no rule reads it.
 *
 *          back edge (on the deck's edge)
 *     ┌─────────┬─────────┐
 *     │  last   │ landing │
 *     │  tread  │         │
 *     │         ●─────────┤ right
 *     │      treads       │
 *     └───────────────────┘
 */
export function spiralLanding(w: number, d: number): Point[] {
  const across = spiralLandingWidth(w);
  return [{ x: 0, y: 0 }, { x: across, y: 0 }, { x: across, y: d / 2 }, { x: 0, y: d / 2 }];
}

/** How far a spiral's landing runs along its back, from the back's middle toward its right: its way off onto the deck. */
export const spiralLandingWidth = (w: number): number => w / 2;

/**
 * The side of a spiral's square box after a resize from `was` to `asked` (stairs.21, spec "Kinds and sizes"): the width
 * when it changed, else the depth; null for any other shape, whose width and depth stay apart.
 */
export function squareSize(rule: StairRule | null, was: { w: number; d: number }, asked: { w: number; d: number }): number | null {
  if (rule === null) return null;
  switch (rule.shape) {
    case "flight":
    case "winder":
    case "ladder":
      return null;
    case "spiral":
      return asked.w !== was.w || asked.d === was.d ? asked.w : asked.d;
    default:
      return assertNever(rule.shape);
  }
}

/** How close a stair's back edge must lie to a deck's edge to touch it: the 1 mm of touching solids (decks.24). */
export const REACH_TOLERANCE = 0.001;

/** How far in front of its back edge a stair is tested for lying off a slab: a flight may run on under it (riser.06). */
const OFF_THE_SLAB = 0.01;

/**
 * The deck a stair's back edge touches: the edge's middle (`at`) on an edge of the deck's slab, within 1 mm, the two
 * edges parallel, and the stair off the slab just in front of its back edge (outside it or over a hole, stairwell.17);
 * the deck it stands on never counts. A spiral's landing is its only way off, so the landing's whole back has to be on
 * that edge too. The first such deck by ID, or null. Only the reach warning reads it: touching links nothing (stairdraw.08).
 */
export function touchedDeck(doc: Document, p: Placement): string | null {
  const r = (p.rotation * Math.PI) / 180;
  const along = { x: Math.cos(r), y: Math.sin(r) };
  const inFront = { x: p.at.x + OFF_THE_SLAB * Math.sin(r), y: p.at.y - OFF_THE_SLAB * Math.cos(r) };
  const object = doc.objects[p.object];
  const landing = object && stairRuleOf(object.kind)?.shape === "spiral" ? spiralLandingWidth(object.w[p.config] ?? 0) : 0;
  const backEnd = { x: p.at.x + along.x * landing, y: p.at.y + along.y * landing };
  for (const deck of deckViews(doc)) {
    if (deck.id === p.deck || onSlab(deck, inFront)) continue;
    const touches = deck.edges.some(({ a, b }) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const parallel = Math.abs((along.x * (b.y - a.y) - along.y * (b.x - a.x)) / len) < 1e-6;
      return parallel && distanceToSegment(p.at, a, b) <= REACH_TOLERANCE && distanceToSegment(backEnd, a, b) <= REACH_TOLERANCE;
    });
    if (touches) return deck.id;
  }
  return null;
}

/**
 * Where a stair placement's steps begin (stairs.49): the top of the deck it starts at, else the bottom of its range (its
 * surface), never below that bottom. Its steps count the rise from here to its top; its box keeps the range. Null
 * without a range.
 */
export function stairBase(doc: Document, placementId: string): number | null {
  const range = placementRange(doc, placementId);
  const start = doc.objects[doc.placements[placementId]?.object ?? ""]?.startsAt;
  if (!range) return null;
  return typeof start === "string" && Object.hasOwn(doc.decks, start) ? Math.max(range.bottom, surfaceTop(doc, start)) : range.bottom;
}

/**
 * The other flight of the L the stair `object` is a flight of (spec "The L"), or null. An L is a deck exactly one stair
 * starts at and exactly one other reaches: the upper flight pairs at the deck it starts at, the lower one, which starts
 * nowhere, at the deck it reaches. A third stair at that deck, or a copied flight keeping its links, makes no pair.
 *
 *     upper ── startsAt ──▶ landing ◀── reaches ── lower
 */
export function ellPartner(doc: Document, object: LayoutObject): string | null {
  const landing = typeof object.startsAt === "string" ? object.startsAt : object.reaches;
  if (typeof landing !== "string") return null;
  const all = [...Object.values(doc.objects).filter((o) => o.id !== object.id), object];
  const [upper, ...moreUppers] = all.filter((o) => o.startsAt === landing);
  const [lower, ...moreLowers] = all.filter((o) => o.reaches === landing);
  if (upper === undefined || lower === undefined || moreUppers.length > 0 || moreLowers.length > 0 || upper === lower) return null;
  return upper === object ? lower.id : upper.id;
}

/** A stair's rise to `deck` from the surface it stands on (`surface`: a deck ID or null for the floor), to the millimetre. */
export function stairRise(doc: Document, deck: string, surface: string | null): number {
  return roundMm(surfaceTop(doc, deck) - surfaceTop(doc, surface));
}
