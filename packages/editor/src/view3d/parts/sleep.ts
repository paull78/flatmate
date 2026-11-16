import { bedBody } from "./bed";
import { MURPHY_MATTRESS_INSET, SEATED_HEIGHT, clampInsets } from "@fm/domain";
import { builtInCabinetDepth } from "../../view/piece-counts";
import { sofaBackDepth, sofaBody } from "./sit-and-eat";
import { barHandle, box, capped, countOf, doorGap, shifted, spans, topThickness } from "./sizes";
import type { Appearance, AppearanceTable, Panel, Part } from "./types";

// Sleep: beds and the built-in units, as in `view/symbols/sleep.ts`. The sofa bed lives here: half of it is a bed.

/** A loft bed (parts.13): frame, mattress and pillows inside its raised box, a rail along its +x long side, no legs. */
function loftBed(w: number, d: number, h: number): Part[] {
  const rail = capped(0.04, 0.1, w);
  const frameTop = capped(0.12, 0.35, h);
  return [...shifted(bedBody(w - rail, d, h, { legs: "none", headboard: false, frame: true, pillowsFor: w }), -rail / 2, 0), box("wood", w / 2 - rail, w / 2, -d / 2, d / 2, frameTop, h)];
}

/**
 * A Murphy bed (parts.03): closed, a laminate cabinet with its front panels; open, the cabinet at the back reaching the
 * top, and the bed lying out in front of it at bed height on two fold-down legs. The box stays the fit's 2.24 m.
 */
function murphyBed(config: string, w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.08, 0.1, h);
  if (config === "folded") {
    const gap = doorGap(w);
    const front = [{ normal: "-y" as const, at: { x0: -w / 2 + gap, x1: w / 2 - gap, y0: -d / 2, y1: -d / 2, z0: plinthH + gap, z1: h - gap }, slot: "laminate" as const }];
    return [box("dark", -w / 2, w / 2, -d / 2, d / 2, 0, plinthH), box("laminate", -w / 2, w / 2, -d / 2, d / 2, plinthH, h, front)];
  }
  const cabinetD = capped(0.4, 0.3, d);
  // The mattress is inset at each end as the plan draws it (furnish.20); the pillows follow the piece's width.
  const [inset] = clampInsets(w, MURPHY_MATTRESS_INSET, MURPHY_MATTRESS_INSET);
  const bed = shifted(bedBody(w - 2 * inset, d - cabinetD, capped(0.5, 0.3, h), { legs: "front", headboard: false, frame: true, pillowsFor: w }), 0, -cabinetD / 2);
  return [box("dark", -w / 2, w / 2, d / 2 - cabinetD, d / 2, 0, plinthH), box("laminate", -w / 2, w / 2, d / 2 - cabinetD, d / 2, plinthH, h), ...bed];
}

/**
 * A built-in table or desk (clarity.05), after the Murphy bed: closed, a laminate cabinet on a plinth with its door and
 * handle; open, the cabinet at the back, as deep as the plan's band, and a top on a leg in front of it. Stored h is the
 * cabinet's, so the top's height can't read it: seated height, less only on a unit too low for that.
 */
const builtInUnit = (kind: string): Appearance => (config, w, d, h) => {
  const plinthH = capped(0.08, 0.1, h);
  if (config === "folded") {
    const gap = doorGap(w);
    const [x0, x1, z0, z1] = [-w / 2 + gap, w / 2 - gap, plinthH + gap, h - gap];
    const door: Panel = { normal: "-y", at: { x0, x1, y0: -d / 2, y1: -d / 2, z0, z1 }, slot: "laminate" };
    return [box("dark", -w / 2, w / 2, -d / 2, d / 2, 0, plinthH), box("laminate", -w / 2, w / 2, -d / 2, d / 2, plinthH, h, [door, barHandle(x0, x1, z1 - capped(0.2, 0.2, z1 - z0), z1, -d / 2)])];
  }
  const front = d / 2 - builtInCabinetDepth(kind, d);
  const topZ = capped(SEATED_HEIGHT, 0.75, h);
  const under = topZ - topThickness(topZ);
  const legSide = capped(0.05, 0.1, Math.min(w, front + d / 2));
  return [
    box("dark", -w / 2, w / 2, front, d / 2, 0, plinthH),
    box("laminate", -w / 2, w / 2, front, d / 2, plinthH, h),
    box("wood", -w / 2, w / 2, -d / 2, front, under, topZ),
    // At the front corners: in the middle a leg would run through a tucked chair, and one leg left a corner floating.
    box("dark", -w / 2, -w / 2 + legSide, -d / 2, -d / 2 + legSide, 0, under),
    box("dark", w / 2 - legSide, w / 2, -d / 2, -d / 2 + legSide, 0, under),
  ];
};

/** A sofa bed: the sofa, or the bed unfolded in front of the sofa's back. */
function sofaBed(config: string, w: number, d: number, h: number): Part[] {
  if (config === "sofa") return sofaBody(w, d, h);
  const backD = sofaBackDepth(d);
  return [box("fabric", -w / 2, w / 2, d / 2 - backD, d / 2, 0, h), ...shifted(bedBody(w, d - backD, capped(0.5, 0.6, h), { legs: "four", headboard: false, frame: true }), 0, -backD / 2)];
}

/**
 * A cot: a frame box, the mattress on it inside the rails, a solid board at each end and, down each long side, slats
 * under a top rail (fewer than the plan's bars: the face cap, parts.06). Slats are thin boxes, so the mattress shows.
 */
function cot(w: number, d: number, h: number): Part[] {
  const t = capped(0.04, 0.1, Math.min(w, d));
  const frameTop = capped(0.3, 0.35, h);
  const railZ = h - capped(0.04, 0.06, h);
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -d / 2, d / 2];
  const n = countOf(d, 0.16, 2);
  const gap = ((d - 2 * t) / n) * 0.3;
  const side = (a: number, b: number): Part[] => [
    box("wood", a, b, y0 + t, y1 - t, railZ, h),
    ...spans(y0 + t, y1 - t, n, gap).map(([s, e]) => box("wood", a, b, s, e, frameTop, railZ)),
  ];
  return [
    box("wood", x0, x1, y0, y1, 0, frameTop),
    box("linen", x0 + t, x1 - t, y0 + t, y1 - t, frameTop, frameTop + capped(0.1, 0.12, h)),
    box("wood", x0, x1, y0, y0 + t, frameTop, h),
    box("wood", x0, x1, y1 - t, y1, frameTop, h),
    ...side(x0, x0 + t),
    ...side(x1 - t, x1),
  ];
}

export const SLEEP: AppearanceTable = new Map<string, Appearance>([
  ["bed", (_c, w, d, h) => bedBody(w, d, h, { legs: "four", headboard: true, frame: true })],
  ["mattress", (_c, w, d, h) => bedBody(w, d, h, { legs: "none", headboard: false, frame: false })],
  // The lift bed hangs or rests on its frame: no legs, no headboard, the same parts up and down (parts.03).
  ["liftBed", (_c, w, d, h) => bedBody(w, d, h, { legs: "none", headboard: false, frame: true })],
  ["loftBed", (_c, w, d, h) => loftBed(w, d, h)],
  ["sofaBed", sofaBed],
  ["cot", (_c, w, d, h) => cot(w, d, h)],
  ["murphyBed", murphyBed],
  ["builtInTable", builtInUnit("builtInTable")],
  ["builtInDesk", builtInUnit("builtInDesk")],
]);
