import { pullToLine } from "./pull-line";
import { MIN_DECK_SIZE, add, deckFrame, deckView, deckViews, dot, scale, sub, type DeckView, type Document, type ResizeSide } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { faceSegments } from "../snapping/dimension-policies";
import { roundCm } from "../snapping/drawn-footprint";
import { sideOf, widthSide } from "../snapping/resize";

// Editing a deck on the canvas (spec "The Deck tool and editing", decks.06, .13): a drag moves its centre by the
// snap step's grid-rounded delta (drag.ts), then snapDeckAt puts a side within the tolerance on a wall face or another
// deck's edge parallel to it; a side grip moves that side along its normal with the opposite side fixed,
// the size to the centimetre and at least MIN_DECK_SIZE. Sides are named as a piece's: right and left change the
// width, front (−y before rotation) and back the depth. No rotation grip (decks.13).

/** A deck side's middle and outward normal, from its ring (counter-clockwise from −w/2, −d/2, like a footprint's). */
export function deckSide(deck: DeckView, side: ResizeSide): { mid: Point; normal: Point } | null {
  return sideOf(deck.ring, side);
}

/** The deck a side grip dragged by `drag` (world) leaves: its new centre and size, or null for a gone deck. */
export function deckResize(doc: Document, deckId: string, side: ResizeSide, drag: Point): { at: Point; w: number; d: number } | null {
  const deck = deckView(doc, deckId);
  const s = deck ? deckSide(deck, side) : null;
  if (!deck || !s) return null;
  const was = widthSide(side) ? deck.w : deck.d;
  const size = Math.max(MIN_DECK_SIZE, roundCm(was + dot(drag, s.normal)));
  const at = add(deck.at, scale(s.normal, (size - was) / 2)); // the opposite side stays
  return widthSide(side) ? { at, w: size, d: deck.d } : { at, w: deck.w, d: size };
}

const PARALLEL_SIN = Math.sin(Math.PI / 180); // a line counts within 1° of the deck's axes, as the domain's faces

/**
 * A dragged deck's centre `at`, moved on each of its axes so that the side nearer a line, within `tol` metres, lies on
 * it: the wall faces and the other decks' edges parallel to its sides (stairwell.37). `at` as given when nothing is
 * near, or with `tol` 0 (Ctrl).
 */
export function snapDeckAt(doc: Document, deckId: string, at: Point, tol: number): Point {
  const deck = deckView(doc, deckId);
  if (!deck || tol <= 0) return at;
  const frame = deckFrame(deck);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const f of faceSegments(doc)) {
    const p = frame.toDeck(f.start);
    const dir = sub(frame.toDeck(add(f.start, f.dir)), p);
    if (Math.abs(dir.y) <= PARALLEL_SIN) ys.push(p.y);
    else if (Math.abs(dir.x) <= PARALLEL_SIN) xs.push(p.x);
  }
  for (const other of deckViews(doc)) {
    if (other.id === deckId || (other.rotation - deck.rotation) % 90 !== 0) continue;
    const ring = other.ring.map(frame.toDeck);
    xs.push(Math.min(...ring.map((q) => q.x)), Math.max(...ring.map((q) => q.x)));
    ys.push(Math.min(...ring.map((q) => q.y)), Math.max(...ring.map((q) => q.y)));
  }
  const c = frame.toDeck(at);
  return frame.toPlan({ x: pullToLine(c.x, deck.w / 2, xs, tol), y: pullToLine(c.y, deck.d / 2, ys, tol) });
}

export { pullToLine }; // its own leaf module (pull-line.ts), re-exported so imports stay here
