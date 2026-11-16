import { deckFrame, deckUnder, deckViews, inConvex, isFloor, levelDeckAt, ownsDeck, roundMm, type Command, type DeckView, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roundCm } from "../snapping/drawn-footprint";
import type { SnapResult } from "../types";
import { holeSnapMark } from "./hole-edit";

// The Hole tool (stairwell.08, smalls.12): the hole a drag or a click cuts, in the deck its press lies in, along that
// deck's axes. A corner within the snap tolerance of the deck's side or of another hole's side goes onto it, in the
// deck's frame, after the wall-face snap the tool already made; so a notch along a wall and up to the deck's edge is
// one drag. Plan coordinates go to the domain (stairwell.14), which keeps them to the millimetre.

/** A click's hole: 1.00 × 1.00 centred on the pointer, to the cm. */
export const CLICKED_HOLE = 1;

/**
 * The deck a hole is drawn in: the one under the press (stairwell.17: it may stand in another deck's hole), else the one whose
 * rectangle holds `p`, holes and all, the lowest ID first; or null. At an upper level, only that level's decks (smalls.12).
 */
export function deckForHole(doc: Document, p: Point, level: Level): DeckView | null {
  if (isFloor(level)) return deckUnder(doc, p) ?? deckViews(doc).find((d) => inConvex(p, d.ring, 1e-6)) ?? null;
  return levelDeckAt(doc, level, p) ?? deckViews(doc).find((d) => ownsDeck(doc, level, d.id) && inConvex(p, d.ring, 1e-6)) ?? null;
}

/** The hole between two corners in `deck`'s axes, each snapped to its sides and its holes' sides within `tol` metres. */
export function drawnHole(deck: DeckView, a: Point, b: Point, tol: number, opId: string): Command {
  const frame = deckFrame(deck);
  const xs = [-deck.w / 2, deck.w / 2, ...deck.holes.flatMap((h) => holeSpan(deck, h.ring, "x"))];
  const ys = [-deck.d / 2, deck.d / 2, ...deck.holes.flatMap((h) => holeSpan(deck, h.ring, "y"))];
  const snap = (v: number, lines: readonly number[]): number => {
    const near = lines.filter((l) => Math.abs(l - v) <= tol).sort((p, q) => Math.abs(p - v) - Math.abs(q - v))[0];
    return near ?? v;
  };
  const qa = frame.toDeck(a);
  const qb = frame.toDeck(b);
  const p = { x: snap(qa.x, xs), y: snap(qa.y, ys) };
  const q = { x: snap(qb.x, xs), y: snap(qb.y, ys) };
  const at = frame.toPlan({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  return { type: "addDeckHole", opId, deck: deck.id, at, w: roundMm(Math.abs(q.x - p.x)), d: roundMm(Math.abs(q.y - p.y)) };
}

/** The mark for the sides the moving corner `b` of a drawn hole lands on (AC-03). */
export function drawnHoleMark(deck: DeckView, a: Point, b: Point, tol: number, opId: string): SnapResult | null {
  const cmd = drawnHole(deck, a, b, tol, opId);
  if (cmd.type !== "addDeckHole") return null;
  const frame = deckFrame(deck);
  const [p, q] = [frame.toDeck(a), frame.toDeck(b)];
  return holeSnapMark(deck, null, cmd, [q.x >= p.x ? "right" : "left", q.y >= p.y ? "back" : "front"], tol);
}

/** A click's hole in `deck`: CLICKED_HOLE square, centred on the pointer to the cm. */
export function clickedHole(deck: DeckView, world: Point, opId: string): Command {
  return { type: "addDeckHole", opId, deck: deck.id, at: { x: roundCm(world.x), y: roundCm(world.y) }, w: CLICKED_HOLE, d: CLICKED_HOLE };
}

/** A hole ring's span along the deck's x or y axis, in the deck's frame. */
function holeSpan(deck: DeckView, ring: readonly Point[], axis: "x" | "y"): number[] {
  const frame = deckFrame(deck);
  const vs = ring.map((p) => frame.toDeck(p)[axis]);
  return [Math.min(...vs), Math.max(...vs)];
}
