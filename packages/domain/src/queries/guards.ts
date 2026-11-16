import type { Point } from "@fm/protocol";
import { memo } from "../memo";
import { DECK_SIDES, EPS, GUARD_DROP, sideField, type DeckSide, type Document, type Guard, type GuardValue } from "../model";
import { sortedIds } from "../graph";
import { stairRuleOf } from "../kinds";
import { deckLabel, deckView, deckViews, type DeckView } from "./decks";
import { sideName, type PlanSide } from "./deck-sides";
import { alongEdge, ON_EDGE, openSpans, ringSpan, type EdgeLine, type Span } from "./edge-spans";
import { footprints, wallBodies } from "./footprints";
import type { EdgeOwner, SlabEdge } from "./slab";
import { ceilingOver, wallRange } from "./vertical";

// A deck's guards (spec "Guards", guards.02): worked out from the geometry, with only the deck's setting stored, so every
// drawing reads this one list and they can't disagree. Guards only draw: nothing here refuses anything (guards.08).

/**
 * One straight stretch of guard, on a deck's edge, from `bottom` (its deck's top) to `top`: its guard's height above
 * the deck, or as much as fits under the ceiling (guards.04, edges.02). `side` or `hole` is what it lies on (edges.01).
 */
export type GuardRun = { deck: string; kind: Exclude<Guard, "none">; a: Point; b: Point; bottom: number; top: number; side: DeckSide | null; hole: string | null };

/** The guard an edge takes: its side's, or its hole's (edges.01). */
function ownerGuard(deck: DeckView, owner: EdgeOwner): GuardValue {
  if ("side" in owner) return deck[sideField(owner.side)];
  return deck.holes.find((h) => h.id === owner.hole)?.guard ?? deck.guardFront; // every hole edge has its hole
}

const off = (edge: SlabEdge, p: Point): number => (p.x - edge.a.x) * edge.normal.x + (p.y - edge.a.y) * edge.normal.y;

/** The stretch of `edge` a segment lies on, when both its ends are on the line; null otherwise. */
function segmentSpan(edge: SlabEdge, length: number, a: Point, b: Point): Span | null {
  if (Math.abs(off(edge, a)) > ON_EDGE || Math.abs(off(edge, b)) > ON_EDGE) return null;
  const [p, q] = [alongEdge(edge, length, a), alongEdge(edge, length, b)];
  return [Math.min(p, q), Math.max(p, q)];
}

/**
 * The way up onto a deck: only a stair's end, never a side it merely touches (guards.13). A flight's back where it reaches
 * this deck, its front where it starts from it; a spiral's landing, the back's right half, where you step off (edge-catch.06).
 * A stair has one pose in every layout (I19), so one placement says it.
 */
const stairEnds = memo((doc: Document): readonly { deck: string; a: Point; b: Point }[] => {
  const quads = footprints(doc);
  const seen = new Set<string>();
  return sortedIds(doc.placements).flatMap((id) => {
    const p = doc.placements[id];
    const object = p ? doc.objects[p.object] : undefined;
    const [q0, q1, q2, q3] = quads.get(id) ?? [];
    if (!p || !object || seen.has(object.id) || !q0 || !q1 || !q2 || !q3 || !stairRuleOf(object.kind)) return [];
    seen.add(object.id);
    const spiral = stairRuleOf(object.kind)?.shape === "spiral";
    const back = spiral ? { a: { x: (q3.x + q2.x) / 2, y: (q3.y + q2.y) / 2 }, b: q2 } : { a: q3, b: q2 };
    return [
      ...(object.reaches ? [{ deck: object.reaches, ...back }] : []),
      ...(object.startsAt ? [{ deck: object.startsAt, a: q0, b: q1 }] : []),
    ];
  });
});

/**
 * What of a rail's line, standing on `level` and rising to `top`, has no drop beside it: walls as tall as the rail
 * (guards.14) and the slabs of decks at that height, but for the deck `except` whose own edge this is. A deck's guards and a
 * spiral's landing both ask this.
 */
export function againstSpans(doc: Document, edge: EdgeLine, length: number, level: number, top: number, except: string | null): Span[] {
  const spans: (Span | null)[] = [];
  for (const [id, body] of wallBodies(doc)) {
    const range = wallRange(doc, id);
    if (range && range.top >= top - EPS && range.bottom <= level + EPS) spans.push(ringSpan(edge, length, body));
  }
  for (const other of deckViews(doc)) {
    if (other.id === except || Math.abs(other.top - level) > EPS) continue;
    for (const cell of other.cells) spans.push(ringSpan(edge, length, cell)); // its slab, not its rectangle: a hole in it is still a drop
  }
  return spans.filter((s): s is Span => s !== null);
}

/** What of `edge` isn't open: what `againstSpans` finds, and a stair's end. */
function closedSpans(doc: Document, deck: DeckView, edge: SlabEdge, length: number, top: number): Span[] {
  const spans: (Span | null)[] = againstSpans(doc, edge, length, deck.top, top, deck.id);
  for (const end of stairEnds(doc)) {
    // A way up onto a deck at this height too: a stair can arrive across the seam of two.
    if (end.deck === deck.id || Math.abs((deckView(doc, end.deck)?.top ?? Number.NaN) - deck.top) <= EPS) spans.push(segmentSpan(edge, length, end.a, end.b));
  }
  return spans.filter((s): s is Span => s !== null);
}

/** An open stretch of a deck's edge, as its guard would run, whatever its kind: the guard is the side's or the hole's. */
type OpenRun = { a: Point; b: Point; top: number; guard: GuardValue; side: DeckSide | null; hole: string | null };

/** A deck's open stretches, each at its own guard's height (a wall as tall as that guard closes it, edges.02). */
function openRuns(doc: Document, deck: DeckView): OpenRun[] {
  return deck.edges.flatMap((edge) => {
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    const guard = ownerGuard(deck, edge.owner);
    const top = Math.min(deck.top + guard.height, ceilingOver(doc, [edge.a, edge.b]));
    if (length <= 0 || top <= deck.top + EPS) return [];
    const point = (t: number): Point => ({ x: edge.a.x + ((edge.b.x - edge.a.x) * t) / length, y: edge.a.y + ((edge.b.y - edge.a.y) * t) / length });
    const side = "side" in edge.owner ? edge.owner.side : null;
    const hole = "hole" in edge.owner ? edge.owner.hole : null;
    return openSpans(length, closedSpans(doc, deck, edge, length, top)).map(([from, to]) => ({ a: point(from), b: point(to), top, guard, side, hole }));
  });
}

/** Every deck's guard runs, by deck and then boundary order; a side or hole set to None has none. */
export const guardRuns = memo((doc: Document): readonly GuardRun[] => deckViews(doc).flatMap((deck) =>
  openRuns(doc, deck).flatMap(({ guard, ...run }): GuardRun[] => {
    const kind = guard.kind;
    return kind === "none" ? [] : [{ deck: deck.id, kind, a: run.a, b: run.b, bottom: deck.top, top: run.top, side: run.side, hole: run.hole }];
  })));

/**
 * A side or hole that wants a guard and has none (guards.05, edges.04): on a deck higher than GUARD_DROP, set to None,
 * with an open stretch. `at`: the middle of its longest open stretch; `plan`: a side's name on the plan now.
 */
export type MissingGuard = { deck: string; name: string; side: DeckSide | null; plan: PlanSide | null; hole: string | null; at: Point };

export const missingGuards = memo((doc: Document): readonly MissingGuard[] => deckViews(doc).flatMap((deck): MissingGuard[] => {
  if (deck.top <= GUARD_DROP) return [];
  const span = (r: { a: Point; b: Point }): number => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
  const longest = new Map<string, OpenRun>(); // by side or hole, in boundary order of first appearance
  for (const r of openRuns(doc, deck)) {
    if (r.guard.kind !== "none") continue;
    const key = r.side ?? `hole ${r.hole ?? ""}`;
    const best = longest.get(key);
    if (best === undefined || span(r) > span(best)) longest.set(key, r);
  }
  // Sides first, front to left, then holes by id: the list reads the same however the slab's edges are chained.
  const rank = (r: OpenRun): string => (r.side === null ? `1 ${r.hole ?? ""}` : `0 ${DECK_SIDES.indexOf(r.side)}`);
  return [...longest.values()].sort((x, y) => (rank(x) < rank(y) ? -1 : rank(x) > rank(y) ? 1 : 0)).map((r) => ({
    deck: deck.id, name: deckLabel(deck), side: r.side, plan: r.side === null ? null : sideName(deck, r.side), hole: r.hole,
    at: { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 },
  }));
}));

/**
 * The guard of the side or hole of `deckId` that point `p` lies on (edges.09): where a stair's top end arrives, its
 * placement's `at`, the middle of its back edge. Null when `p` is on no edge of that deck's slab.
 */
export function guardAt(doc: Document, deckId: string, p: Point): Guard | null {
  const deck = deckView(doc, deckId);
  if (!deck) return null;
  for (const edge of deck.edges) {
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    const t = alongEdge(edge, length, p);
    if (Math.abs(off(edge, p)) <= ON_EDGE && t >= -ON_EDGE && t <= length + ON_EDGE) return ownerGuard(deck, edge.owner).kind;
  }
  return null;
}

/** About how far apart a Railing's posts stand. */
const POST_SPACING = 1;

/** A run's posts: its two ends, and evenly between them no further apart than POST_SPACING. The plan and 3D share them. */
export function guardPosts(run: Pick<GuardRun, "a" | "b">): Point[] {
  const count = Math.ceil(Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) / POST_SPACING);
  return Array.from({ length: count + 1 }, (_, i) => ({ x: run.a.x + ((run.b.x - run.a.x) * i) / count, y: run.a.y + ((run.b.y - run.a.y) * i) / count }));
}
