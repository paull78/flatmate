import { MIN_DECK_SIZE, add, deckFrame, dot, holeView, roundMm, scale, sub, type Command, type DeckView, type Document, type HoleView, type ResizeSide } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roundCm } from "../snapping/drawn-footprint";
import { pullToLine } from "./deck-edit";
import { sideOf, widthSide } from "../snapping/resize";
import type { SnapResult } from "../types";

// Editing a hole on the canvas (stairwell.08, .35, smalls.12), at the floor or its deck's level, as a deck is edited (decks.30): a drag moves
// its centre by the snap step's grid-rounded delta (drag.ts), then snapHoleAt puts a side within the tolerance on its
// deck's edge or another hole's side, as the Hole tool's corners snap (hole-draft.ts); a side grip moves that side along its normal with the opposite
// side fixed, landing on the same lines (riser.21), else the size to the centimetre, at least MIN_DECK_SIZE. Sides are named as a deck's.

/** A hole side's middle and outward normal, from its ring (counter-clockwise from −w/2, −d/2 in its deck's frame). */
export function holeSide(hole: Pick<HoleView, "ring">, side: ResizeSide): { mid: Point; normal: Point } | null {
  return sideOf(hole.ring, side);
}

/**
 * The hole a side grip dragged by `drag` (world) leaves: its new centre and size, or null for a gone hole. The side lands
 * on a line within `tol` metres (riser.21): its deck's edges and its other holes' sides; else the size is to the
 * centimetre. `tol` 0 (Ctrl) lands on none. The opposite side stays.
 */
export function holeResize(doc: Document, holeId: string, side: ResizeSide, drag: Point, tol: number): { at: Point; w: number; d: number } | null {
  const found = holeView(doc, holeId);
  const hole = found?.hole;
  const s = hole ? holeSide(hole, side) : null;
  if (!found || !hole || !s) return null;
  const was = widthSide(side) ? hole.w : hole.d;
  const raw = was + dot(drag, s.normal);
  const size = Math.max(MIN_DECK_SIZE, landedSize(found, side, s.mid, raw, was, tol) ?? roundCm(raw));
  const at = add(hole.at, scale(s.normal, (size - was) / 2)); // the opposite side stays
  return widthSide(side) ? { at, w: size, d: hole.d } : { at, w: hole.w, d: size };
}

/** The size that puts the dragged side on the nearest of its deck's lines within `tol`, in the deck's frame; null when none is. */
function landedSize({ deck, hole }: NonNullable<ReturnType<typeof holeView>>, side: ResizeSide, mid: Point, raw: number, was: number, tol: number): number | null {
  if (tol <= 0) return null;
  const lines = deckLines(deck, hole.id);
  const frame = deckFrame(deck);
  const across = widthSide(side);
  const sideAt = across ? frame.toDeck(mid).x : frame.toDeck(mid).y;
  const centre = across ? frame.toDeck(hole.at).x : frame.toDeck(hole.at).y;
  const sign = sideAt >= centre ? 1 : -1;
  const moved = sideAt + sign * (raw - was);
  const near = (across ? lines.xs : lines.ys).filter((l) => Math.abs(l - moved) <= tol).sort((a, b) => Math.abs(a - moved) - Math.abs(b - moved))[0];
  return near === undefined ? null : roundMm(Math.abs(near - (sideAt - sign * was)));
}

/** The lines a hole's sides land on, in its deck's frame: the deck's edges and its other holes' sides. */
function deckLines(deck: NonNullable<ReturnType<typeof holeView>>["deck"], holeId: string | null): { xs: number[]; ys: number[] } {
  const frame = deckFrame(deck);
  const others = deck.holes.filter((h) => h.id !== holeId).map((h) => ({ c: frame.toDeck(h.at), w: h.w, d: h.d }));
  return {
    xs: [-deck.w / 2, deck.w / 2, ...others.flatMap((o) => [o.c.x - o.w / 2, o.c.x + o.w / 2])],
    ys: [-deck.d / 2, deck.d / 2, ...others.flatMap((o) => [o.c.y - o.d / 2, o.c.y + o.d / 2])],
  };
}

/**
 * A dragged hole's centre `at`, moved on each of its deck's axes so that the side nearer a line, within `tol` metres,
 * lies on it: the deck's edges and its other holes' sides. `at` as given when nothing is near, or with `tol` 0 (Ctrl).
 */
export function snapHoleAt(doc: Document, holeId: string, at: Point, tol: number): Point {
  const found = holeView(doc, holeId);
  if (!found || tol <= 0) return at;
  const { deck, hole } = found;
  const frame = deckFrame(deck);
  const { xs, ys } = deckLines(deck, holeId);
  const c = frame.toDeck(at);
  return frame.toPlan({ x: pullToLine(c.x, hole.w / 2, xs, tol), y: pullToLine(c.y, hole.d / 2, ys, tol) });
}

/** The sides a hole's gaps are listed in: its deck's −x, +x, −y and +y. */
export const GAP_SIDES: readonly ResizeSide[] = ["left", "right", "front", "back"];

/** How near a side must lie to a line to count as on it: `at` and the size are each kept to the millimetre. */
const ON_LINE = 0.0015;

/**
 * The mark for a hole's `sides` that lie on a line of its deck (AC-03): the side's middle, with "Edge" for its deck's
 * edge, else "Hole" for another hole's side. Null when none does, or with `tol` 0 (Ctrl), when nothing snapped.
 */
export function holeSnapMark(deck: DeckView, holeId: string | null, hole: { at: Point; w: number; d: number }, sides: readonly ResizeSide[], tol: number): SnapResult | null {
  if (tol <= 0) return null;
  const frame = deckFrame(deck);
  const c = frame.toDeck(hole.at);
  const { xs, ys } = deckLines(deck, holeId);
  const at = (side: ResizeSide): { line: number; lines: number[]; edge: number; mid: Point } => {
    if (widthSide(side)) {
      const sign = side === "left" ? -1 : 1;
      const line = c.x + (sign * hole.w) / 2;
      return { line, lines: xs, edge: deck.w / 2, mid: { x: line, y: c.y } };
    }
    const sign = side === "front" ? -1 : 1;
    const line = c.y + (sign * hole.d) / 2;
    return { line, lines: ys, edge: deck.d / 2, mid: { x: c.x, y: line } };
  };
  const onLine = sides.map(at).filter((s) => s.lines.some((l) => Math.abs(l - s.line) <= ON_LINE));
  const edge = onLine.find((s) => Math.abs(Math.abs(s.line) - s.edge) <= ON_LINE);
  const found = edge ?? onLine[0];
  return found ? { kind: "edge", word: edge ? "Edge" : "Hole", point: frame.toPlan(found.mid) } : null;
}

/** One gap: from the middle of a hole's side, along its outward normal, to its deck's side of that name. */
export type HoleGap = { side: ResizeSide; from: Point; to: Point; normal: Point; length: number };

/**
 * A hole's gaps to its deck's edges (stairwell.36), along the deck's axes, in GAP_SIDES order; a side within 1 mm of
 * the edge (a notch's) has none. Both rings run counter-clockwise from −w/2, −d/2 in the deck's frame.
 */
export function holeGaps(doc: Document, holeId: string): HoleGap[] {
  const found = holeView(doc, holeId);
  if (!found) return [];
  return GAP_SIDES.flatMap((side) => {
    const h = sideOf(found.hole.ring, side);
    const d = sideOf(found.deck.ring, side);
    const length = h && d ? dot(sub(d.mid, h.mid), h.normal) : 0;
    return h && length > 0.001 ? [{ side, from: h.mid, to: add(h.mid, scale(h.normal, length)), normal: h.normal, length }] : [];
  });
}

/** The setDeckHole that makes the gap on `side` read `value`, the size kept; null for a gone hole or deck. */
export function gapCommand(doc: Document, holeId: string, side: ResizeSide, value: number): Command | null {
  const found = holeView(doc, holeId);
  const h = found ? sideOf(found.hole.ring, side) : null;
  const d = found ? sideOf(found.deck.ring, side) : null;
  if (!found || !h || !d) return null;
  const at = add(found.hole.at, scale(h.normal, dot(sub(d.mid, h.mid), h.normal) - value));
  return { type: "setDeckHole", holeId, at: { x: roundMm(at.x), y: roundMm(at.y) } };
}

