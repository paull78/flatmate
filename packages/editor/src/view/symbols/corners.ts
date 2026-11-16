import { armsFor } from "@fm/domain";
import { cornerSofaEnds, cornerSofaSeats } from "../piece-counts";
import type { Primitive } from "../scene-types";
import { inner, roundRect, seg, upTo, type SymbolOf, type SymbolTable } from "./lines";

// The corner pieces on the `L` outline (catalog.05, .14, .17): the outline is the kind's six corners (furniture.ts);
// the detail follows the approved mockup (docs/current/mockup-corners.mjs.txt). Each symbol reads `armsFor`'s arms:
// the object's, or the kind's default for a tile or a new piece. t1 is the back arm's depth, t2 the left arm's.

/** The mitre from the inner corner to the outer back-left corner, where the two arms meet. */
const mitreOf = (w: number, t1: number, t2: number): Primitive => seg(-w / 2 + t2, -t1, -w / 2, 0);

/** Values from `from` toward `to` (exclusive) every `each` metres, `each` signed. */
function every(from: number, to: number, each: number): number[] {
  const n = Math.max(0, Math.ceil((to - from) / each - 1e-9));
  return Array.from({ length: n }, (_, k) => from + k * each);
}

/** A corner desk: a plain top in two pieces joined on the mitre. */
const cornerDesk: SymbolOf = (w, d, kind, _options, arms) => {
  const { back, left } = armsFor(kind, w, d, arms);
  return inner([mitreOf(w, back, left)]);
};

/**
 * A corner wardrobe: a rail down each arm at 0.45 of its depth with a hanger across it every 0.09 m, the door band at
 * 0.90 of each arm's depth along the inner edges with a joint about every 0.50 m, and the corner door's hinge line.
 */
const cornerWardrobe: SymbolOf = (w, d, kind, _options, arms) => {
  const { back: t1, left: t2 } = armsFor(kind, w, d, arms);
  const [rb, rl] = [-0.45 * t1, -w / 2 + 0.45 * t2]; // the rails
  const end = upTo(0.03, w, d, 0.1); // the rails stop short of the arm ends
  const [hb, hl] = [Math.min(0.2, 0.32 * t1), Math.min(0.2, 0.32 * t2)]; // a hanger's half-length on each arm
  const hangers = [
    ...every(-w / 2 + t2 + 0.06, w / 2 - 0.05, 0.09).map((x) => seg(x, rb + hb, x, rb - hb)),
    ...every(-t1 - 0.06, -d + 0.05, -0.09).map((y) => seg(rl - hl, y, rl + hl, y)),
  ];
  const [bb, bl] = [-0.9 * t1, -w / 2 + 0.9 * t2]; // the door band
  const [backRun, leftRun] = [w / 2 - bl, d + bb];
  const [nb, nl] = [Math.max(1, Math.round(backRun / 0.5)), Math.max(1, Math.round(leftRun / 0.5))];
  const joints = [
    ...Array.from({ length: nb - 1 }, (_, k) => bl + (backRun * (k + 1)) / nb).map((x) => seg(x, bb, x, -t1)),
    ...Array.from({ length: nl - 1 }, (_, k) => bb - (leftRun * (k + 1)) / nl).map((y) => seg(bl, y, -w / 2 + t2, y)),
  ];
  return inner([
    seg(rl, rb, w / 2 - end, rb), seg(rl, rb, rl, -d + end), ...hangers,
    seg(bl, bb, w / 2, bb), seg(bl, bb, bl, -d), ...joints,
    seg(bl, bb, -w / 2 + t2, -t1), // the corner door's hinge line
  ]);
};

/** A corner counter: the worktop's front edge inset along both inner edges, and its mitre. */
const cornerCounter: SymbolOf = (w, d, kind, _options, arms) => {
  const { back: t1, left: t2 } = armsFor(kind, w, d, arms);
  const i = Math.min(0.036, 0.3 * Math.min(t1, t2));
  const corner = { x: -w / 2 + t2 - i, y: -t1 + i };
  return inner([seg(corner.x, -d, corner.x, corner.y), seg(corner.x, corner.y, w / 2, corner.y), mitreOf(w, t1, t2)]);
};

/**
 * A corner sofa: the back along the outer edges at 0.24 of each arm's depth, an armrest across each far end, a rounded
 * cushion per seat down each run (`cornerSofaSeats`, the count the 3D parts read) and the corner seat.
 */
const cornerSofa: SymbolOf = (w, d, kind, _options, given) => {
  const arms = armsFor(kind, w, d, given);
  const { back: t1, left: t2 } = arms;
  const ends = cornerSofaEnds(w, d, arms);
  const n = cornerSofaSeats(w, d, arms);
  const [bx, by] = [-w / 2 + 0.24 * t2, -0.24 * t1]; // the back's inner corner
  const ix = -w / 2 + t2; // the left arm's inner face
  const [backRun, leftRun] = [w / 2 - ends.back - ix, d - ends.left - t1];
  const gap = Math.min(0.025, 0.1 * Math.min(0.76 * t1, 0.76 * t2, backRun / n.back, leftRun / n.left));
  const cushion = (x0: number, y0: number, x1: number, y1: number) => roundRect(x0 + gap, y0 + gap, x1 - gap, y1 - gap, 0.05);
  return inner([
    seg(bx, by, w / 2 - ends.back, by), seg(bx, by, bx, -d + ends.left), // the back
    seg(w / 2 - ends.back, 0, w / 2 - ends.back, -t1 + Math.min(0.04, 0.1 * t1)), // the armrests
    seg(-w / 2, -d + ends.left, ix - Math.min(0.04, 0.1 * t2), -d + ends.left),
    ...Array.from({ length: n.back }, (_, k) => cushion(ix + (backRun * k) / n.back, -t1, ix + (backRun * (k + 1)) / n.back, by)).flat(),
    ...Array.from({ length: n.left }, (_, k) => cushion(bx, -t1 - (leftRun * (k + 1)) / n.left, ix, -t1 - (leftRun * k) / n.left)).flat(),
    ...cushion(bx, -t1, ix, by), // the corner seat
  ]);
};

export const CORNERS: SymbolTable = new Map<string, SymbolOf>([
  ["cornerDesk.standard", cornerDesk],
  ["cornerWardrobe.standard", cornerWardrobe],
  ["cornerCounter.standard", cornerCounter],
  ["cornerSofa.standard", cornerSofa],
]);
