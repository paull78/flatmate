import type { Point } from "@fm/protocol";
import { add, pointInPolygon, rotateAbout, signedArea, sub } from "../geometry";
import { sortedIds } from "../graph";
import { memo } from "../memo";
import { EPS, type Deck, type DeckHole, type DeckSide, type Document } from "../model";

// A deck's slab in its own frame (stairwell.15): the w × d rectangle centred on the origin less its holes, all
// axis-aligned. The rectangle is cut along every hole side into a grid; the cells in no hole are the slab, as convex
// rectangles every check can test like any solid; the cell sides with no slab across them are its boundary, the
// edges a stair catches (stairwell.17). A hole side within 1 mm of a deck's side or another hole's is on it, as I22 allows:
// holes are stored in plan coordinates to the millimetre, so on a turned deck a flush side lands a little off. Those
// boundaries chained into loops are what fills it (fixes.06), since rings that nearly meet make earcut fill the hole.
// Pure geometry: `deckViews` maps it to plan.

/** An axis-aligned rectangle in a deck's frame. */
export type FrameRect = { x0: number; y0: number; x1: number; y1: number };
/** A boundary segment in a deck's frame: the slab on its left, `normal` pointing off the slab (to its right). */
export type FrameEdge = { a: Point; b: Point; normal: Point };

/** Points closer than this are one point: they come off the same grid lines. */
const SAME = 1e-7;

/** The slab: the rectangle's grid cells in no hole, merged along rows and then down columns, counter-clockwise. */
export function slabCells(w: number, d: number, holes: readonly FrameRect[]): FrameRect[] {
  const grid = slabGrid(w, d, holes);
  const rows: FrameRect[][] = [];
  for (let j = 0; j < grid.ys.length - 1; j++) {
    const row: FrameRect[] = [];
    for (let i = 0; i < grid.xs.length - 1; i++) {
      if (!grid.kept(i, j)) continue;
      const cell = grid.cell(i, j);
      const last = row.at(-1);
      if (last && Math.abs(last.x1 - cell.x0) < SAME) row[row.length - 1] = { ...last, x1: cell.x1 };
      else row.push(cell);
    }
    rows.push(row);
  }
  const out: FrameRect[] = [];
  let open: FrameRect[] = [];
  for (const row of rows) {
    const next: FrameRect[] = [];
    for (const r of row) {
      const above = open.find((o) => Math.abs(o.x0 - r.x0) < SAME && Math.abs(o.x1 - r.x1) < SAME && Math.abs(o.y1 - r.y0) < SAME);
      if (above) {
        open = open.filter((o) => o !== above);
        next.push({ ...above, y1: r.y1 });
      } else {
        next.push(r);
      }
    }
    out.push(...open);
    open = next;
  }
  out.push(...open);
  return out;
}

/** The slab's boundary: grid-cell sides with no slab cell across them, collinear neighbours with one normal merged. */
export function slabEdges(w: number, d: number, holes: readonly FrameRect[]): FrameEdge[] {
  const grid = slabGrid(w, d, holes);
  const pieces: FrameEdge[] = [];
  const nx = grid.xs.length - 1;
  const ny = grid.ys.length - 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!grid.kept(i, j)) continue;
      const { x0, y0, x1, y1 } = grid.cell(i, j);
      if (!grid.kept(i, j - 1)) pieces.push({ a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, normal: { x: 0, y: -1 } });
      if (!grid.kept(i + 1, j)) pieces.push({ a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, normal: { x: 1, y: 0 } });
      if (!grid.kept(i, j + 1)) pieces.push({ a: { x: x1, y: y1 }, b: { x: x0, y: y1 }, normal: { x: 0, y: 1 } });
      if (!grid.kept(i - 1, j)) pieces.push({ a: { x: x0, y: y1 }, b: { x: x0, y: y0 }, normal: { x: -1, y: 0 } });
    }
  }
  return mergeCollinear(pieces);
}

type Grid = { xs: number[]; ys: number[]; kept: (i: number, j: number) => boolean; cell: (i: number, j: number) => FrameRect };

function slabGrid(w: number, d: number, holes: readonly FrameRect[]): Grid {
  const box: FrameRect = { x0: -w / 2, y0: -d / 2, x1: w / 2, y1: d / 2 };
  const clamped = holes.map((h) => ({ x0: clamp(h.x0, box.x0, box.x1), y0: clamp(h.y0, box.y0, box.y1), x1: clamp(h.x1, box.x0, box.x1), y1: clamp(h.y1, box.y0, box.y1) }));
  const xs = lines([box.x0, box.x1], clamped.flatMap((h) => [h.x0, h.x1]));
  const ys = lines([box.y0, box.y1], clamped.flatMap((h) => [h.y0, h.y1]));
  const inside = clamped.map((h) => ({ x0: onto(h.x0, xs), y0: onto(h.y0, ys), x1: onto(h.x1, xs), y1: onto(h.y1, ys) }));
  const cell = (i: number, j: number): FrameRect => ({ x0: xs[i] ?? 0, y0: ys[j] ?? 0, x1: xs[i + 1] ?? 0, y1: ys[j + 1] ?? 0 });
  const keep: boolean[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const c = cell(i, j);
      const mid = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
      keep.push(!inside.some((h) => mid.x > h.x0 && mid.x < h.x1 && mid.y > h.y0 && mid.y < h.y1));
    }
  }
  const kept = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && keep[j * (xs.length - 1) + i] === true;
  return { xs, ys, kept, cell };
}

/** Sorted grid lines: the rectangle's own sides, then each hole side more than 1 mm from every line so far. */
function lines(sides: readonly number[], values: readonly number[]): number[] {
  const out = [...sides];
  for (const v of [...values].sort((a, b) => a - b)) if (out.every((l) => Math.abs(l - v) >= EPS)) out.push(v);
  return out.sort((a, b) => a - b);
}

/** The grid line a hole's side lies on. */
function onto(v: number, grid: readonly number[]): number {
  return grid.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best), v + 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Joins boundary pieces that share a line and a normal and meet end to start. */
function mergeCollinear(pieces: readonly FrameEdge[]): FrameEdge[] {
  const out: FrameEdge[] = [];
  const along = (e: FrameEdge): number => (e.normal.x === 0 ? e.a.x * -e.normal.y : e.a.y * e.normal.x); // increases along the edge
  const key = (e: FrameEdge): string => `${e.normal.x},${e.normal.y},${Math.round((e.normal.x === 0 ? e.a.y : e.a.x) / SAME)}`;
  const groups = new Map<string, FrameEdge[]>();
  for (const e of pieces) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  for (const group of groups.values()) {
    const sorted = [...group].sort((p, q) => along(p) - along(q));
    let run: FrameEdge | null = null;
    for (const e of sorted) {
      if (run !== null && Math.abs(run.b.x - e.a.x) < SAME && Math.abs(run.b.y - e.a.y) < SAME) run = { a: run.a, b: e.b, normal: run.normal };
      else {
        if (run) out.push(run);
        run = e;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

/** A piece of slab to fill: a counter-clockwise ring and its clockwise holes, none nearly touching another. */
export type SlabFill<P = Point> = { ring: P[]; holes: P[][] };

/** The slab's boundary chained into loops, and each hole loop given to the piece around it. */
export function slabFills(w: number, d: number, holes: readonly FrameRect[]): SlabFill[] {
  const loops = chained(slabEdges(w, d, holes));
  const outer = loops.filter((l) => signedArea(l) > 0);
  const inner = loops.filter((l) => signedArea(l) < 0);
  return outer.map((ring) => ({ ring, holes: inner.filter((h) => h[0] !== undefined && pointInPolygon(h[0], ring)) }));
}

/**
 * Follows each edge to the next. The slab lies on the left, so where holes touch at a corner and two edges leave one point,
 * the tighter left turn stays on the same piece of slab.
 */
function chained(edges: readonly FrameEdge[]): Point[][] {
  const at = (p: Point): string => `${Math.round(p.x / SAME)},${Math.round(p.y / SAME)}`;
  const leaving = new Map<string, FrameEdge[]>();
  for (const e of edges) leaving.set(at(e.a), [...(leaving.get(at(e.a)) ?? []), e]);
  const used = new Set<FrameEdge>();
  const loops: Point[][] = [];
  for (const first of edges) {
    if (used.has(first)) continue;
    const loop: Point[] = [];
    let e: FrameEdge | undefined = first;
    while (e && !used.has(e)) {
      used.add(e);
      loop.push(e.a);
      const from: FrameEdge = e;
      e = (leaving.get(at(from.b)) ?? []).filter((n) => !used.has(n)).sort((p, q) => leftTurn(from, q) - leftTurn(from, p))[0];
    }
    loops.push(loop);
  }
  return loops;
}

/** How far `to` turns left of `from`: 1 left, 0 straight on, -1 right. Boundary edges run along the axes. */
function leftTurn(from: FrameEdge, to: FrameEdge): number {
  const [a, b] = [sub(from.b, from.a), sub(to.b, to.a)];
  return Math.sign(a.x * b.y - a.y * b.x);
}

/** Plan coordinates to a deck's own frame (origin at its centre, axes along its sides) and back. */
export type DeckFrame = { toDeck: (p: Point) => Point; toPlan: (q: Point) => Point; vectorToPlan: (v: Point) => Point };

export function deckFrame(deck: Pick<Deck, "at" | "rotation">): DeckFrame {
  const origin = { x: 0, y: 0 };
  return {
    toDeck: (p) => rotateAbout(sub(p, deck.at), origin, -deck.rotation),
    toPlan: (q) => add(rotateAbout(q, origin, deck.rotation), deck.at),
    vectorToPlan: (v) => rotateAbout(v, origin, deck.rotation),
  };
}

/** A hole's rectangle in its deck's frame. */
export function holeRect(deck: Pick<Deck, "at" | "rotation">, hole: Pick<DeckHole, "at" | "w" | "d">): FrameRect {
  const c = deckFrame(deck).toDeck(hole.at);
  return { x0: c.x - hole.w / 2, y0: c.y - hole.d / 2, x1: c.x + hole.w / 2, y1: c.y + hole.d / 2 };
}

/** A hole as the rules see it: its row and its ring on plan (counter-clockwise, turned with its deck). */
export type HoleView = DeckHole & { ring: Point[] };
/** What a slab edge lies on (edges.01, .09): a side of its deck's rectangle, or one of its holes. */
export type EdgeOwner = { side: DeckSide } | { hole: string };
/**
 * A boundary segment of a slab on plan: the slab on its left, `normal` (unit) pointing off it, and the side or hole
 * it lies on, decided in the deck's own frame so a turn can't blur it.
 */
export type SlabEdge = { a: Point; b: Point; normal: Point; owner: EdgeOwner };

/** How far past an edge, in its frame, the point that tells what lies beyond it is: well under the 1 mm a hole snaps by. */
const PROBE = 1e-4;

/**
 * The side or hole beyond a frame edge: past the rectangle, the side its normal faces; inside it, the hole that holds
 * the point just beyond the edge (a cell side with no slab across it is either). The nearest hole if float noise
 * leaves the point in none.
 */
function edgeOwner(w: number, d: number, holes: readonly { id: string; rect: FrameRect }[], e: FrameEdge): EdgeOwner {
  const p = { x: (e.a.x + e.b.x) / 2 + e.normal.x * PROBE, y: (e.a.y + e.b.y) / 2 + e.normal.y * PROBE };
  if (p.y < -d / 2) return { side: "front" };
  if (p.x > w / 2) return { side: "right" };
  if (p.y > d / 2) return { side: "back" };
  if (p.x < -w / 2) return { side: "left" };
  const gap = (r: FrameRect): number => Math.max(r.x0 - p.x, p.x - r.x1, r.y0 - p.y, p.y - r.y1, 0);
  const nearest = holes.reduce<{ id: string; rect: FrameRect } | null>((best, h) => (best === null || gap(h.rect) < gap(best.rect) ? h : best), null);
  // A cell side inside the rectangle has a hole beyond it; a deck with no holes has no such edge.
  return nearest ? { hole: nearest.id } : { side: "front" };
}
/** A deck's slab on plan: its holes, its convex counter-clockwise cells and its boundary edges. */
export type Slab = { holes: HoleView[]; cells: Point[][]; edges: SlabEdge[]; fills: SlabFill[] };

/** A deck with `holes` (its rows) as a slab on plan. */
export function slabOf(deck: Deck, holes: readonly DeckHole[]): Slab {
  const frame = deckFrame(deck);
  const rects = holes.map((h) => holeRect(deck, h));
  const corners = (r: FrameRect): Point[] => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }].map(frame.toPlan);
  return {
    holes: holes.map((h, i) => ({ ...h, ring: corners(rects[i] ?? { x0: 0, y0: 0, x1: 0, y1: 0 }) })),
    cells: slabCells(deck.w, deck.d, rects).map(corners),
    edges: slabEdges(deck.w, deck.d, rects).map((e) => ({
      a: frame.toPlan(e.a), b: frame.toPlan(e.b), normal: frame.vectorToPlan(e.normal),
      owner: edgeOwner(deck.w, deck.d, holes.map((h, i) => ({ id: h.id, rect: rects[i] ?? { x0: 0, y0: 0, x1: 0, y1: 0 } })), e),
    })),
    fills: slabFills(deck.w, deck.d, rects).map((f) => ({ ring: f.ring.map(frame.toPlan), holes: f.holes.map((h) => h.map(frame.toPlan)) })),
  };
}

/** Every deck's slab by its ID, its holes read from the table here and in queries/decks.ts only (stairwell.15). */
export const slabs = memo((doc: Document): ReadonlyMap<string, Slab> => {
  const holes = new Map<string, DeckHole[]>();
  for (const id of sortedIds(doc.deckHoles)) {
    const h = doc.deckHoles[id];
    if (h) holes.set(h.deck, [...(holes.get(h.deck) ?? []), h]);
  }
  const out = new Map<string, Slab>();
  for (const id of sortedIds(doc.decks)) {
    const deck = doc.decks[id];
    if (deck) out.set(id, slabOf(deck, holes.get(id) ?? []));
  }
  return out;
});

