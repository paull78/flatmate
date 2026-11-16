import { configOf, type ObjectOptions } from "@fm/domain";
import { computerGear } from "../computer";
import { sofaArm, sofaSeats } from "../piece-counts";
import type { Primitive } from "../scene-types";
import { arc, ellipse, inner, insetOf, rect, roundRect, seg, upTo, type SymbolOf, type SymbolTable } from "./lines";

// Sit & eat, and the desk (the Work group's only kind, shared with the open built-in desk in `sleep.ts`).

/** A sofa: its arms and back, and a rounded cushion per seat (seating.04). */
function sofa(w: number, d: number): Primitive[] {
  const arm = sofaArm(w);
  const back = -d * 0.24;
  const front = -d + upTo(0.04, w, d, 0.1); // the arms stop short of the front
  const gap = upTo(0.025, w, d, 0.05);
  const seats = sofaSeats(w);
  const step = (w - 2 * arm) / seats;
  return [
    seg(-w / 2 + arm, 0, -w / 2 + arm, front),
    seg(w / 2 - arm, 0, w / 2 - arm, front),
    seg(-w / 2 + arm, back, w / 2 - arm, back),
    ...Array.from({ length: seats }, (_, k) => {
      const x0 = -w / 2 + arm + step * k;
      return roundRect(x0 + gap, -d + gap, x0 + step - gap, back - gap, 0.05);
    }).flat(),
  ];
}

/** An armchair: arms and back like a sofa's, and one seat cushion at any width (not `sofa`, which divides seats). */
function armchair(w: number, d: number): Primitive[] {
  const arm = sofaArm(w);
  const back = -d * 0.28;
  const i = insetOf(w, d);
  return [
    seg(-w / 2 + arm, 0, -w / 2 + arm, -d),
    seg(w / 2 - arm, 0, w / 2 - arm, -d),
    seg(-w / 2 + arm, back, w / 2 - arm, back),
    ...roundRect(-w / 2 + arm + i, -d + i, w / 2 - arm - i, back - i, 0.1 * Math.min(w, d)),
  ];
}

/** A coffee table's inset top with round corners. */
function coffeeTable(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  return roundRect(-w / 2 + i, -d + i, w / 2 - i, -i, 0.2 * Math.min(w, d));
}

/** A round table's inner ring at 80 % of its circle (the circle is the outline, `shapes.ts`). */
export const roundTable = (w: number, d: number): Primitive[] => ellipse(0, -d / 2, 0.4 * w, 0.4 * d);

/** An open folding table: the hinge line at the folded depth (the kind's, kept inside the table). */
function openTable(w: number, d: number): Primitive[] {
  const folded = configOf({ kind: "foldingTable" }, "folded")?.d ?? 0.15;
  const y = -Math.min(folded, d / 2);
  return [seg(-w / 2, y, w / 2, y)];
}

/** The gear of "With computer" (seating.12): the monitor and its foot, the keyboard and the mouse (`computerGear`). */
export function computerSymbol(w: number, d: number): Primitive[] {
  const { monitor: m, foot: f, keyboard: k, mouse: o, scale } = computerGear(w, d);
  return [...rect(m.x0, m.y0, m.x1, m.y1), ...rect(f.x0, f.y0, f.x1, f.y1), ...roundRect(k.x0, k.y0, k.x1, k.y1, 0.01 * scale), ...roundRect(o.x0, o.y0, o.x1, o.y1, 0.025 * scale)];
}

/** The desk: its top, no inner lines (seating.04), and the gear when its options have the computer on. */
export const desk = (w: number, d: number, options: ObjectOptions): Primitive[] => (options.computer === true ? computerSymbol(w, d) : []);

/**
 * A chair: the backrest band in its back 0.10 m (the part that never tucks), inset 0.03 m from the sides, and a
 * rounded seat inset 0.04 m up to 0.12 m from the back. Small chairs shrink these to shares of their smaller side.
 */
export function chairSymbol(w: number, d: number): Primitive[] {
  const band = upTo(0.1, w, d, 0.25);
  const rest = upTo(0.04, w, d, 0.1); // the band's front edge, from the back
  const side = upTo(0.03, w, d, 0.1);
  const inset = upTo(0.04, w, d, 0.1);
  const seatBack = upTo(0.12, w, d, 0.3);
  return [...rect(-w / 2 + side, -band, w / 2 - side, -rest), ...roundRect(-w / 2 + inset, -d + inset, w / 2 - inset, -seatBack, 0.04)];
}

/**
 * A round chair's back (library.09): a curved band in its back 0.10 m, between two arcs about the centre of the chair's
 * back square (min(w, d) a side, so each arc's whole circle stays inside), closed by two short lines where the arcs
 * meet the band's front edge.
 *
 *   ─────────────── y = 0
 *       ╭─────╮       outer arc, 0.03 m from the back
 *     ╭─╯ ╭─╮ ╰─╮     inner arc, 0.04 m inside it
 *   ──┴───┘ └───┴── y = −band
 */
export function roundChairBack(w: number, d: number): Primitive[] {
  const m = Math.min(w, d);
  const band = upTo(0.1, w, d, 0.25);
  const outer = m / 2 - upTo(0.03, w, d, 0.1);
  const inner = outer - upTo(0.04, w, d, 0.1);
  const cy = -m / 2;
  const rise = cy + band; // the band's front edge above the centre (negative: below it)
  const half = (r: number) => Math.asin(Math.min(1, -rise / r)); // the angle where an arc meets y = −band
  const [a, b] = [half(outer), half(inner)];
  const end = (r: number, t: number) => ({ x: r * Math.cos(t), y: -band }); // the arc of radius r at angle t
  const [ol, or, il, ir] = [end(outer, Math.PI - a), end(outer, a), end(inner, Math.PI - b), end(inner, b)];
  return [arc(0, cy, outer, a, Math.PI - a), arc(0, cy, inner, b, Math.PI - b), seg(ol.x, ol.y, il.x, il.y), seg(ir.x, ir.y, or.x, or.y)];
}

/** A round chair (library.09): its curved back band, and a seat with round corners in front of it. */
export function roundChairSymbol(w: number, d: number): Primitive[] {
  const band = upTo(0.1, w, d, 0.25);
  const inset = upTo(0.035, w, d, 0.1);
  return [...roundChairBack(w, d), ...roundRect(-w / 2 + inset, -d + inset, w / 2 - inset, -band, upTo(0.1, w, d, 0.25))];
}

export const closedTable =(w: number, d: number) => extendingTable(w, d, false);

/** An extending table's inset top with round corners, without its seams (the dining set's table, seating.15). */
export function tableTop(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  return roundRect(-w / 2 + i, -d + i, w / 2 - i, -i, 0.04);
}

/** An extending table: its inset top, split by one seam closed, or by the leaf's two seams extended. */
function extendingTable(w: number, d: number, extended: boolean): Primitive[] {
  const i = insetOf(w, d);
  const across = (y: number) => seg(-w / 2 + i, y, w / 2 - i, y);
  const seams = extended ? [across(-d / 2 - d * 0.14), across(-d / 2 + d * 0.14)] : [across(-d / 2)];
  return [...tableTop(w, d), ...seams];
}

/** A stool (pieces.07): its round seat and its post, about its centre. */
function stool(w: number, d: number): Primitive[] {
  const m = Math.min(w, d);
  return [arc(0, -d / 2, 0.33 * m, 0, 2 * Math.PI), arc(0, -d / 2, 0.12 * m, 0, 2 * Math.PI)];
}

/** A bar table (pieces.07): its frame inset under the top, and the footrest across the middle, a table read as high. */
function barTable(w: number, d: number): Primitive[] {
  const i = upTo(0.1, w, d, 0.17);
  return [...rect(-w / 2 + i, -d + i, w / 2 - i, -i), seg(-w / 2 + i, -d / 2, w / 2 - i, -d / 2)];
}

/** A bench (pieces.07): its cushions on top, split about every 0.60 m; the cushion's back edge is the lid's hinge line. */
function bench(w: number, d: number): Primitive[] {
  const i = upTo(0.04, w, d, 0.1);
  const back = upTo(0.06, w, d, 0.15);
  const n = Math.max(1, Math.round(w / 0.6 + 1e-9));
  const splits = Array.from({ length: n - 1 }, (_, k) => {
    const x = -w / 2 + i + ((w - 2 * i) * (k + 1)) / n;
    return seg(x, -d + i, x, -back);
  });
  return [...rect(-w / 2 + i, -d + i, w / 2 - i, -back), ...splits];
}

// The folding table's folded configuration has no entry: an outline only (a shelf against the wall).
export const SIT_AND_EAT: SymbolTable = new Map<string, SymbolOf>([
  ["sofaBed.sofa", (w, d) => inner(sofa(w, d))],
  ["sofa.standard", (w, d) => inner(sofa(w, d))],
  ["armchair.standard", (w, d) => inner(armchair(w, d))],
  ["coffeeTable.standard", (w, d) => inner(coffeeTable(w, d))],
  ["foldingTable.open", (w, d) => inner(openTable(w, d))],
  ["extendingTable.closed", (w, d) => inner(closedTable(w, d))],
  ["extendingTable.extended", (w, d) => inner(extendingTable(w, d, true))],
  ["roundTable.standard", (w, d) => inner(roundTable(w, d))],
  ["desk.standard", (w, d, _kind, options) => inner(desk(w, d, options))],
  ["chair.standard", (w, d, _kind, options) => inner((options.roundChairs === true ? roundChairSymbol : chairSymbol)(w, d))],
  ["stool.standard", (w, d) => inner(stool(w, d))],
  ["barTable.standard", (w, d) => inner(barTable(w, d))],
  ["bench.standard", (w, d) => inner(bench(w, d))],
]);
