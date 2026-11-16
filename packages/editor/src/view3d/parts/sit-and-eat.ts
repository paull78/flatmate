import type { ObjectOptions } from "@fm/domain";
import { computerGear, type GearRect } from "../../view/computer";
import { sofaArm, sofaSeats } from "../../view/piece-counts";
import { MAX_REPEAT, box, capped, legs, spans, topThickness } from "./sizes";
import type { Appearance, AppearanceTable, Part } from "./types";

// Sit & eat, and the desk, as in `view/symbols/sit-and-eat.ts`.

/** A sofa's back depth, shared by the sofa and the open sofa bed. */
export const sofaBackDepth = (d: number): number => capped(0.22, 0.28, d);

/** A sofa (parts.02): dark legs, a fabric base, the plan's arms (sofaArm) and seats (sofaSeats), a back to the top. */
export function sofaBody(w: number, d: number, h: number, seats = Math.min(MAX_REPEAT, sofaSeats(w))): Part[] {
  const legH = capped(0.08, 0.12, h);
  const legSide = capped(0.05, 0.1, Math.min(w, d));
  const arm = sofaArm(w);
  const armTop = legH + capped(0.54, 0.6, h);
  const back = d / 2 - sofaBackDepth(d);
  const seatBase = legH + capped(0.2, 0.25, h);
  const seatTop = seatBase + capped(0.15, 0.17, h);
  return [
    ...legs("dark", -w / 2, w / 2, -d / 2, d / 2, legSide, legH),
    box("fabric", -w / 2, -w / 2 + arm, -d / 2, d / 2, legH, armTop),
    box("fabric", w / 2 - arm, w / 2, -d / 2, d / 2, legH, armTop),
    box("fabric", -w / 2 + arm, w / 2 - arm, back, d / 2, legH, h),
    box("fabric", -w / 2 + arm, w / 2 - arm, -d / 2, back, legH, seatBase),
    ...spans(-w / 2 + arm, w / 2 - arm, seats).map(([a, b]) => box("fabric", a, b, -d / 2, back, seatBase, seatTop)),
  ];
}

/** A table: a top as large as the box and four legs inset under it; `leaf` marks the extension on top. */
export function tableBody(w: number, d: number, h: number, leaf: boolean): Part[] {
  const topT = topThickness(h);
  const inset = capped(0.05, 0.1, Math.min(w, d));
  const legSide = capped(0.05, 0.12, Math.min(w, d));
  const leafD = capped(0.46, 0.3, d);
  const panels = leaf ? [{ normal: "+z" as const, at: { x0: -w / 2, x1: w / 2, y0: -leafD / 2, y1: leafD / 2, z0: h, z1: h }, slot: "wood" as const }] : [];
  return [
    ...legs("wood", -w / 2 + inset, w / 2 - inset, -d / 2 + inset, d / 2 - inset, legSide, h - topT),
    box("wood", -w / 2, w / 2, -d / 2, d / 2, h - topT, h, panels),
  ];
}

/** A round table: its top is the drawn ellipse (parts.12); a pedestal and a foot, both cylinders well inside it. */
function roundTable(w: number, d: number, h: number): Part[] {
  const topT = topThickness(h);
  const footH = capped(0.04, 0.08, h);
  const m = Math.min(w, d);
  const foot = capped(0.5, 0.55, m);
  const post = capped(0.1, 0.15, m);
  return [
    { shape: "cylinder", at: { x0: -foot / 2, x1: foot / 2, y0: -foot / 2, y1: foot / 2, z0: 0, z1: footH }, slot: "dark" },
    { shape: "cylinder", at: { x0: -post / 2, x1: post / 2, y0: -post / 2, y1: post / 2, z0: footH, z1: h - topT }, slot: "dark" },
    { shape: "outline", z0: h - topT, z1: h, slot: "wood" },
  ];
}

/** A wall-hung folding table: folded, a batten at the back and the leaf hanging in front; open, the top on the batten and two front legs. */
function foldingTable(config: string, w: number, d: number, h: number): Part[] {
  const topT = capped(0.025, 0.08, h);
  const batten = capped(0.04, 0.3, d);
  const battenH = capped(0.08, 0.15, h);
  if (config === "folded") {
    return [box("wood", -w / 2, w / 2, d / 2 - batten, d / 2, h - battenH, h), box("wood", -w / 2, w / 2, -d / 2, -d / 2 + capped(0.025, 0.3, d), 0, h)];
  }
  const legSide = capped(0.04, 0.1, Math.min(w, d));
  const inset = capped(0.05, 0.1, w);
  return [
    box("wood", -w / 2, w / 2, d / 2 - batten, d / 2, h - topT - battenH, h - topT),
    box("dark", -w / 2 + inset, -w / 2 + inset + legSide, -d / 2, -d / 2 + legSide, 0, h - topT),
    box("dark", w / 2 - inset - legSide, w / 2 - inset, -d / 2, -d / 2 + legSide, 0, h - topT),
    box("wood", -w / 2, w / 2, -d / 2, d / 2, h - topT, h),
  ];
}

/** A chair: four legs, a seat at about 0.45 m (capped by its height), a back at the rear up to the top. */
export function chair(w: number, d: number, h: number): Part[] {
  const seatZ = capped(0.42, 0.47, h);
  const seatT = capped(0.03, 0.05, h);
  const backT = capped(0.03, 0.1, d);
  const legSide = capped(0.035, 0.12, Math.min(w, d));
  return [
    ...legs("wood", -w / 2, w / 2, -d / 2, d / 2, legSide, seatZ),
    box("wood", -w / 2, w / 2, -d / 2, d / 2, seatZ, seatZ + seatT),
    box("wood", -w / 2, w / 2, d / 2 - backT, d / 2, seatZ + seatT, h),
  ];
}

/**
 * A round chair (library.09): four legs under a round seat, and a back of five short pieces along a curve in the back
 * 0.10 m, about the centre of the chair's back square (min(w, d) a side), as the plan draws its back band.
 */
export function roundChair(w: number, d: number, h: number): Part[] {
  const seatZ = capped(0.42, 0.47, h);
  const seatT = capped(0.03, 0.05, h);
  const m = Math.min(w, d);
  const legSide = capped(0.035, 0.12, m);
  const inset = capped(0.035, 0.1, m);
  const [sx, sy] = [(w / 2 - inset) * 0.7, (d / 2 - inset) * 0.7]; // legs inside the seat's circle
  const outer = m / 2;
  const inner = outer - capped(0.03, 0.1, m);
  const cy = d / 2 - m / 2;
  const from = Math.asin((m / 2 - capped(0.1, 0.25, m)) / inner); // where the inner curve meets the band's front edge
  const at = (r: number, t: number) => ({ x: r * Math.cos(t), y: cy + r * Math.sin(t) });
  const back = spans(from, Math.PI - from, 5).map(([a, b]): Part => ({ shape: "ring", ring: [at(outer, a), at(outer, b), at(inner, b), at(inner, a)], z0: seatZ + seatT, z1: h, slot: "wood" }));
  return [
    ...legs("wood", -sx, sx, -sy, sy, legSide, seatZ),
    { shape: "cylinder", at: { x0: -w / 2 + inset, x1: w / 2 - inset, y0: -d / 2 + inset, y1: d / 2 - inset, z0: seatZ, z1: seatZ + seatT }, slot: "wood" },
    ...back,
  ];
}

/** A coffee table: a table body and a shelf between its legs. */
function coffeeTable(w: number, d: number, h: number): Part[] {
  const inset = capped(0.05, 0.1, Math.min(w, d));
  const legSide = capped(0.05, 0.12, Math.min(w, d));
  const inner = inset + legSide;
  const shelfZ = capped(0.1, 0.25, h);
  return [...tableBody(w, d, h, false), box("wood", -w / 2 + inner, w / 2 - inner, -d / 2 + inner, d / 2 - inner, shelfZ, shelfZ + capped(0.02, 0.05, h))];
}

/** A desk: a wood top on four metal legs, and the computer on its top when its options have it on. */
function desk(w: number, d: number, h: number, options: ObjectOptions | undefined): Part[] {
  const topT = topThickness(h);
  const legSide = capped(0.04, 0.1, Math.min(w, d));
  const gear = options?.computer === true ? computerParts(w, d, h) : [];
  return [...legs("metal", -w / 2, w / 2, -d / 2, d / 2, legSide, h - topT), box("wood", -w / 2, w / 2, -d / 2, d / 2, h - topT, h), ...gear];
}

/**
 * "With computer" on a desk's top at h (seating.12), where the plan draws it (`computerGear`): the foot's plate and a
 * neck in metal, the monitor's panel about 0.35 m tall on it, the keyboard 0.02 m thick and the mouse, all dark.
 * Fixed heights scale with the plan's sizes on a small desk.
 */
function computerParts(w: number, d: number, h: number): Part[] {
  const g = computerGear(w, d);
  const s = g.scale;
  const on = (slot: "dark" | "metal", r: GearRect, z0: number, z1: number): Part => box(slot, r.x0, r.x1, r.y0 + d / 2, r.y1 + d / 2, h + z0, h + z1);
  const neck: GearRect = { x0: -0.02 * s, x1: 0.02 * s, y0: g.foot.y0, y1: g.foot.y0 + 0.02 * s };
  return [
    on("metal", g.foot, 0, 0.01 * s),
    on("metal", neck, 0.01 * s, 0.12 * s),
    on("dark", g.monitor, 0.1 * s, 0.45 * s),
    on("dark", g.keyboard, 0, 0.02 * s),
    on("dark", g.mouse, 0, 0.03 * s),
  ];
}

/** A cylinder about the piece's centre, `side` across, from z0 to z1. */
const disc = (slot: "metal", side: number, z0: number, z1: number): Part => ({ shape: "cylinder", at: { x0: -side / 2, x1: side / 2, y0: -side / 2, y1: side / 2, z0, z1 }, slot });

/** A stool (pieces.07): a metal foot, a metal post and its round wood seat at its top, the piece's own drawn ring, as the round table's top. */
function stool(w: number, d: number, h: number): Part[] {
  const m = Math.min(w, d);
  const seatT = capped(0.03, 0.15, h);
  const footT = capped(0.02, 0.05, h);
  return [disc("metal", 0.75 * m, 0, footT), disc("metal", capped(0.05, 0.2, m), footT, h - seatT), { shape: "outline", z0: h - seatT, z1: h, slot: "wood" }];
}

/**
 * A bar table (pieces.07): a wood top on four metal legs with a footrest bar low between the front ones; under 0.30 m
 * high (the wall ledge) a wood top on two metal brackets at its ends.
 */
function barTable(w: number, d: number, h: number): Part[] {
  const topT = topThickness(h);
  if (h < 0.3) {
    const b = capped(0.04, 0.15, w);
    const z = h * 0.4;
    return [box("metal", -w / 2, -w / 2 + b, -d / 2, d / 2, 0, z), box("metal", w / 2 - b, w / 2, -d / 2, d / 2, 0, z), box("wood", -w / 2, w / 2, -d / 2, d / 2, z, h)];
  }
  const leg = capped(0.04, 0.15, Math.min(w, d));
  const inset = capped(0.06, 0.12, Math.min(w, d));
  const [x0, x1, y0] = [-w / 2 + inset, w / 2 - inset, -d / 2 + inset];
  const bar = capped(0.25, 0.3, h);
  const barT = capped(0.025, 0.1, h);
  return [
    ...legs("metal", x0, x1, y0, d / 2 - inset, leg, h - topT),
    box("metal", x0 + leg, x1 - leg, y0, y0 + leg, bar, bar + barT),
    box("wood", -w / 2, w / 2, -d / 2, d / 2, h - topT, h),
  ];
}

/** A bench (pieces.07): a wood box with fabric cushions on top, one per about 0.60 m. */
function bench(w: number, d: number, h: number): Part[] {
  const cushionT = capped(0.07, 0.3, h);
  const n = Math.max(1, Math.min(MAX_REPEAT, Math.round(w / 0.6 + 1e-9)));
  const gap = capped(0.01, 0.02, w);
  return [box("wood", -w / 2, w / 2, -d / 2, d / 2, 0, h - cushionT), ...spans(-w / 2, w / 2, n, gap).map(([a, b]) => box("fabric", a, b, -d / 2, d / 2, h - cushionT, h))];
}

export const SIT_AND_EAT: AppearanceTable = new Map<string, Appearance>([
  ["sofa", (_c, w, d, h) => sofaBody(w, d, h)],
  ["armchair", (_c, w, d, h) => sofaBody(w, d, h, 1)], // one seat at any width, as the plan draws it
  ["coffeeTable", (_c, w, d, h) => coffeeTable(w, d, h)],
  ["foldingTable", foldingTable],
  ["extendingTable", (c, w, d, h) => tableBody(w, d, h, c === "extended")],
  ["roundTable", (_c, w, d, h) => roundTable(w, d, h)],
  ["desk", (_c, w, d, h, options) => desk(w, d, h, options)],
  ["chair", (_c, w, d, h, options) => (options?.roundChairs === true ? roundChair : chair)(w, d, h)],
  ["stool", (_c, w, d, h) => stool(w, d, h)],
  ["barTable", (_c, w, d, h) => barTable(w, d, h)],
  ["bench", (_c, w, d, h) => bench(w, d, h)],
]);
