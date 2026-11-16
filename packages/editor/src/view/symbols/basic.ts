import type { Point } from "@fm/protocol";
import type { Primitive } from "../scene-types";
import { arc, inner, rect, seg, TAU, upTo, type Parts, type SymbolOf, type SymbolTable } from "./lines";

// Basic shapes, the radiator and the rugs (catalog.14); the plants are in plants.ts.

/** A radiator: a section about every 0.05 m, evenly, across its depth less a margin each side. */
function radiator(w: number, d: number): Primitive[] {
  const n = Math.max(2, Math.round(w / 0.05 + 1e-9));
  const margin = upTo(0.015, w, d, 0.15);
  return Array.from({ length: n - 1 }, (_, k) => {
    const x = -w / 2 + ((k + 1) * w) / n;
    return seg(x, -margin, x, -d + margin);
  });
}

/**
 * A rug: fringes on its short ends, the lines where the fringes meet its body, and a border inset in the body. Built in
 * the rug's own frame, along its length and across it, so a rug turned long by its depth keeps them on the short ends.
 */
function rug(w: number, d: number): Parts {
  const wide = w >= d;
  const [long, short] = wide ? [w, d] : [d, w];
  const line = (u0: number, v0: number, u1: number, v1: number): Primitive => (wide ? seg(u0, v0, u1, v1) : seg(v0 + short / 2, u0 - long / 2, v1 + short / 2, u1 - long / 2));
  const fringe = Math.min(0.05, long / 20);
  const border = Math.min(0.1, 0.07 * short);
  const [end, inset] = [long / 2 - fringe, long / 2 - fringe - border];
  const step = Math.max(0.05, short / 60); // at most 60 a side on a very deep rug
  const rows = Array.from({ length: Math.max(0, Math.ceil((short - 0.06) / step)) }, (_, k) => -0.04 - k * step);
  return {
    line: [line(-end, 0, -end, -short), line(end, 0, end, -short)],
    detail: [
      ...[line(-inset, -border, inset, -border), line(inset, -border, inset, -short + border), line(inset, -short + border, -inset, -short + border), line(-inset, -short + border, -inset, -border)],
      ...rows.flatMap((v) => [line(-long / 2, v, -end, v), line(end, v, long / 2, v)]),
    ],
  };
}

/** A round rug: an inner ring, the outline scaled about the centre, so it keeps inside when stretched. */
function roundRug(w: number, d: number): Parts {
  const k = 1 - Math.min(0.1, 0.06 * Math.min(w, d)) / (Math.min(w, d) / 2);
  const n = 32;
  const at = (i: number): Point => ({ x: (k * w * Math.cos((i / n) * TAU)) / 2, y: -d / 2 + (k * d * Math.sin((i / n) * TAU)) / 2 });
  return inner(Array.from({ length: n }, (_, i) => {
    const [a, b] = [at(i), at(i + 1)];
    return seg(a.x, a.y, b.x, b.y);
  }));
}

/** A wood stove (pieces.07): the stove's square toward the back of its hearth, its glass door's line and the flue's collar. */
function woodStove(w: number, d: number): Primitive[] {
  const m = Math.min(w, d);
  const [s, back] = [0.53 * m, 0.107 * m];
  const inset = Math.min(0.04, 0.1 * s);
  const door = -(back + s) + Math.min(0.05, 0.12 * s);
  return [...rect(-s / 2, -(back + s), s / 2, -back), seg(-s / 2 + inset, door, s / 2 - inset, door), arc(0, -(back + 0.3 * s), Math.min(0.075, 0.2 * s), 0, 2 * Math.PI)];
}

/** A wall unit (pieces.07): its box and one diagonal, the plan sign of a unit hung on a wall, for every preset. */
function wallUnit(w: number, d: number): Primitive[] {
  const i = Math.min(0.02, 0.1 * Math.min(w, d));
  return [...rect(-w / 2 + i, -d + i, w / 2 - i, -i), seg(-w / 2 + i, -i, w / 2 - i, -d + i)];
}

/** An electric fireplace (pieces.07): its glass front's line and a row of flame rings, one per about 0.20 m. */
function electricFireplace(w: number, d: number): Primitive[] {
  const i = Math.min(0.03, 0.1 * Math.min(w, d));
  const glass = -d + Math.min(0.05, 0.25 * d);
  const n = Math.max(3, Math.round(w / 0.2 + 1e-9));
  const r = Math.min(0.035, 0.2 * d, (w - 2 * i) / (2 * n));
  const rings = Array.from({ length: n }, (_, k) => arc(-w / 2 + i + ((w - 2 * i) * (k + 0.5)) / n, -d / 2, r, 0, 2 * Math.PI));
  return [seg(-w / 2 + i, glass, w / 2 - i, glass), ...rings];
}

/** A wheel well (trailer.10): a tyre's outline per about 0.90 m of its length, 0.66 m long, inset from its sides. */
function wheelWell(w: number, d: number): Primitive[] {
  const n = Math.max(1, Math.round(w / 0.9 + 1e-9));
  const i = Math.min(0.05, 0.15 * d);
  const long = Math.min(0.66, w / n - 2 * i);
  return Array.from({ length: n }, (_, k) => {
    const x = -w / 2 + (w * (k + 0.5)) / n;
    return rect(x - long / 2, -d + i, x + long / 2, -i);
  }).flat();
}

/** A beam (beams.08, .14): two lines along its length at a third and two thirds of its depth, drawn when it crosses the cut and on its card. */
function beam(w: number, d: number): Primitive[] {
  return [seg(-w / 2, -d / 3, w / 2, -d / 3), seg(-w / 2, (-2 * d) / 3, w / 2, (-2 * d) / 3)];
}

export const BASIC: SymbolTable = new Map<string, SymbolOf>([
  ["block.standard", (w, d) => inner([seg(-w / 2, -d, w / 2, 0), seg(-w / 2, 0, w / 2, -d)])], // an X
  ["roundBlock.standard", (w, d) => { // an X inside the ellipse, between its points at 45°/225° and 135°/315°
    const x = (w / 2) * Math.SQRT1_2;
    const y = (d / 2) * Math.SQRT1_2;
    return inner([seg(x, -d / 2 + y, -x, -d / 2 - y), seg(-x, -d / 2 + y, x, -d / 2 - y)]);
  }],
  ["cornerBlock.standard", (w, d) => inner([seg(-w / 2, 0, 0, -d / 2)])], // the right angle to the long side's middle
  ["radiator.standard", (w, d) => inner(radiator(w, d))],
  ["woodStove.standard", (w, d) => inner(woodStove(w, d))],
  ["wallUnit.standard", (w, d) => inner(wallUnit(w, d))],
  ["electricFireplace.standard", (w, d) => inner(electricFireplace(w, d))],
  ["wheelWell.standard", (w, d) => inner(wheelWell(w, d))],
  ["beam.standard", (w, d) => inner(beam(w, d))],
  ["rug.standard", (w, d) => rug(w, d)],
  ["roundRug.standard", (w, d) => roundRug(w, d)],
]);
