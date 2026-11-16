import { MURPHY_MATTRESS_INSET, clampInsets } from "@fm/domain";
import { bedPillows, builtInCabinetDepth } from "../piece-counts";
import type { Primitive } from "../scene-types";
import { arc, inner, insetOf, roundRect, seg, shiftY, TAU, upTo, type Parts, type SymbolOf, type SymbolTable } from "./lines";
import { closedTable } from "./sit-and-eat";

// Sleep: beds and the built-in units (a Murphy bed, a built-in table and desk), folded and down.

/** A bed w × d: its pillows (`pillows` defaults to the count for its own width) and the duvet's folded band. */
function bed(w: number, d: number, pillows: 1 | 2 = bedPillows(w)): Primitive[] {
  const i = insetOf(w, d);
  const pd = d * 0.16; // pillow depth
  const pw = (w - 3 * i) / 2;
  const heads = pillows === 1
    ? roundRect(-0.3 * w, -i - pd, 0.3 * w, -i, pd * 0.3)
    : [...roundRect(-w / 2 + i, -i - pd, -w / 2 + i + pw, -i, pd * 0.3), ...roundRect(w / 2 - i - pw, -i - pd, w / 2 - i, -i, pd * 0.3)];
  const across = (y: number) => seg(-w / 2, y, w / 2, y);
  return [...heads, across(-d * 0.27), across(-d * 0.36)]; // the duvet's top and its fold (seating.04)
}

/**
 * The open Murphy bed's mattress (furnish.20): inset MURPHY_MATTRESS_INSET from each end of the cabinet, clamped like
 * its front zone, with a side line at each end and the bed drawn at the mattress width. The pillow count follows the
 * piece's width, as the Width field shows it (furnish.06).
 */
function murphyMattress(w: number, d: number): Primitive[] {
  const [s] = clampInsets(w, MURPHY_MATTRESS_INSET, MURPHY_MATTRESS_INSET);
  return [seg(-w / 2 + s, 0, -w / 2 + s, -d), seg(w / 2 - s, 0, w / 2 - s, -d), ...bed(w - 2 * s, d, bedPillows(w))];
}

/** A nightstand: the lamp on top, a ring with a dot at its centre. */
function nightstand(w: number, d: number): Primitive[] {
  const r = 0.2 * Math.min(w, d);
  return [arc(0, -d / 2, r, 0, TAU), arc(0, -d / 2, 0.2 * r, 0, TAU)];
}

/** A built-in unit's cabinet band cd deep: its front, drawn like the outline, and a detail line halfway in. */
function cabinetBand(w: number, cd: number): Parts {
  return { line: [seg(-w / 2, -cd, w / 2, -cd)], detail: [seg(-w / 2, -cd / 2, w / 2, -cd / 2)] };
}

/**
 * An open built-in unit: the cabinet band at the kind's closed depth (at most half the piece), and what comes out
 * fitted to the depth in front of it.
 */
function openUnit(kind: string, w: number, d: number, content: (w: number, d: number) => Primitive[]): Parts {
  const cd = builtInCabinetDepth(kind, d);
  const band = cabinetBand(w, cd);
  return { line: band.line, detail: [...band.detail, ...shiftY(content(w, d - cd), -cd)] };
}

/** A ladder across the foot of a bed w × d, by its right side: two rails and three rungs. */
function ladder(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  const right = w / 2 - i;
  const left = right - Math.min(0.4, w * 0.35);
  const foot = -d + i;
  const head = foot + Math.min(0.5, d * 0.25);
  const rungs = [1, 2, 3].map((k) => foot + ((head - foot) * k) / 4);
  return [seg(left, foot, left, head), seg(right, foot, right, head), ...rungs.map((y) => seg(left, y, right, y))];
}

/** A cot: the mattress inside its rails, a bar about every 0.08 m down each long side, a pillow at its head. */
function cot(w: number, d: number): Primitive[] {
  const i = upTo(0.04, w, d, 0.1);
  const n = Math.max(2, Math.round(d / 0.08 + 1e-9));
  const bars = Array.from({ length: n - 1 }, (_, k) => {
    const y = (-(k + 1) * d) / n;
    return [seg(-w / 2, y, -w / 2 + i, y), seg(w / 2 - i, y, w / 2, y)];
  }).flat();
  const [pw, top, pd] = [Math.min(0.13, 0.2 * w), 1.25 * i, Math.min(0.12, 0.1 * d)];
  return [...roundRect(-w / 2 + i, -d + i, w / 2 - i, -i, upTo(0.03, w, d, 0.075)), ...bars, ...roundRect(-pw, -top - pd, pw, -top, 0.04)];
}

const folded = (w: number, d: number) => cabinetBand(w, d * 0.82);

export const SLEEP: SymbolTable = new Map<string, SymbolOf>([
  ["bed.standard", (w, d) => inner(bed(w, d))],
  ["mattress.standard", (w, d) => inner(bed(w, d))], // a bed without its frame (cleanup.07)
  // A lift bed is a bed, up or down; a loft bed is a bed with its ladder at the foot (heights.49). Raised above the
  // cut both draw dashed with no symbol: these show on tiles, on the ghost and on a lowered piece.
  ["liftBed.up", (w, d) => inner(bed(w, d))],
  ["liftBed.down", (w, d) => inner(bed(w, d))],
  ["loftBed.standard", (w, d) => inner([...bed(w, d), ...ladder(w, d)])],
  ["sofaBed.bed", (w, d) => inner(bed(w, d))],
  ["nightstand.standard", (w, d) => inner(nightstand(w, d))],
  ["cot.standard", (w, d) => inner(cot(w, d))],
  ["murphyBed.folded", folded],
  ["builtInTable.folded", folded],
  ["builtInDesk.folded", folded],
  ["murphyBed.down", (w, d, kind) => openUnit(kind, w, d, murphyMattress)],
  ["builtInTable.down", (w, d, kind) => openUnit(kind, w, d, closedTable)],
  ["builtInDesk.down", (w, d, kind) => openUnit(kind, w, d, () => [])], // the plain desk: the cabinet band only, never a computer (seating.12)
]);
