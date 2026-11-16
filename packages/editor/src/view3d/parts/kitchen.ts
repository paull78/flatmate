import { hobRings } from "../../view/piece-counts";
import { barHandle, box, capped, countOf, doorFronts, doorGap, spans } from "./sizes";
import type { AppearanceTable, Panel, Part } from "./types";

// The kitchen, as in `view/symbols/kitchen.ts`. A run reads as one: every base unit shares the plinth, the carcass with
// its doors, and the worktop (parts step 03).

/** A base unit: a dark plinth set back, a laminate carcass with door fronts, a wood worktop; `top` panels on the worktop. */
export function baseUnit(w: number, d: number, h: number, top: readonly Panel[] = []): Part[] {
  const plinthH = capped(0.1, 0.12, h);
  const recess = capped(0.05, 0.1, d);
  const worktopT = capped(0.04, 0.06, h);
  const doors = countOf(w, 0.6);
  const gap = doorGap(w);
  const fronts: Panel[] = spans(-w / 2, w / 2, doors, gap).map(([a, b]) => ({ normal: "-y", at: { x0: a, x1: b, y0: -d / 2, y1: -d / 2, z0: plinthH + gap, z1: h - worktopT - gap }, slot: "laminate" }));
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("laminate", -w / 2, w / 2, -d / 2, d / 2, plinthH, h - worktopT, fronts), // the fronts stand off it (parts.31)
    box("wood", -w / 2, w / 2, -d / 2, d / 2, h - worktopT, h, top),
  ];
}

/** The hob's rings as squares on the worktop, one under each of the plan's. */
function rings(w: number, d: number, h: number): Panel[] {
  const s = capped(0.18, 0.3, Math.min(w, d));
  return hobRings(w, d).map(({ x, y }): Panel => ({ normal: "+z", at: { x0: x - s / 2, x1: x + s / 2, y0: y - s / 2, y1: y + s / 2, z0: h, z1: h }, slot: "dark" }));
}

/** The sink's bowl on the worktop. */
function bowl(w: number, d: number, h: number): Panel[] {
  const bw = capped(0.4, 0.7, w);
  const bd = capped(0.36, 0.6, d);
  return [{ normal: "+z", at: { x0: -bw / 2, x1: bw / 2, y0: -bd / 2, y1: bd / 2, z0: h, z1: h }, slot: "metal" }];
}

/** A fridge-freezer: a metal body and two metal doors at the front, the freezer's below at about a third, dark handles. */
function fridge(w: number, d: number, h: number): Part[] {
  const t = capped(0.04, 0.15, d);
  const gap = capped(0.004, 0.01, h);
  const split = h * 0.34;
  const handle = (z0: number, z1: number): Panel[] => {
    const hw = capped(0.02, 0.1, w);
    const hz = capped(0.3, 0.4, z1 - z0);
    const x = w / 2 - capped(0.05, 0.15, w);
    const zc = z0 < split ? z1 - hz / 2 - gap * 4 : z0 + hz / 2 + gap * 4;
    return [{ normal: "-y", at: { x0: x - hw, x1: x, y0: -d / 2, y1: -d / 2, z0: zc - hz / 2, z1: zc + hz / 2 }, slot: "dark" }];
  };
  return [
    box("metal", -w / 2, w / 2, -d / 2 + t, d / 2, 0, h),
    box("metal", -w / 2, w / 2, -d / 2, -d / 2 + t, 0, split - gap, handle(0, split - gap)),
    box("metal", -w / 2, w / 2, -d / 2, -d / 2 + t, split + gap, h, handle(split + gap, h)),
  ];
}

/** A wall cabinet: a laminate carcass behind laminate doors counted as a counter's are. */
function wallCabinet(w: number, d: number, h: number): Part[] {
  const t = capped(0.018, 0.1, d);
  return [box("laminate", -w / 2, w / 2, -d / 2 + t, d / 2, 0, h), ...doorFronts("laminate", -w / 2, w / 2, d, t, 0, h, countOf(w, 0.6), doorGap(w))];
}

/** A dishwasher: a dark plinth set back, a metal carcass, a metal door with its handle, a dark control strip above it. */
function dishwasher(w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.1, 0.12, h);
  const recess = capped(0.05, 0.1, d);
  const t = capped(0.03, 0.1, d);
  const worktopT = capped(0.04, 0.06, h); // the base units' worktop, so a run's wood doesn't break here (clarity.52)
  const top = h - worktopT;
  const strip = top - capped(0.08, 0.12, h);
  const handleZ = strip - capped(0.12, 0.2, h);
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("metal", -w / 2, w / 2, -d / 2 + t, d / 2, plinthH, top),
    ...doorFronts("metal", -w / 2, w / 2, d, t, plinthH, strip, 1, doorGap(w), (a, b) => [barHandle(a, b, handleZ, strip, -d / 2)]),
    box("dark", -w / 2, w / 2, -d / 2, -d / 2 + t, strip, top),
    box("wood", -w / 2, w / 2, -d / 2, d / 2, top, h),
  ];
}

/**
 * An oven column: a dark plinth set back, a laminate carcass, a lower door, the dark oven front at about 0.85 m, 0.60 m
 * tall, with a handle in metal so it shows on the dark, and an upper door to the top.
 */
function ovenColumn(w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.1, 0.12, h);
  const recess = capped(0.05, 0.1, d);
  const t = capped(0.02, 0.1, d);
  const gap = Math.min(doorGap(w), 0.02 * h);
  const ovenZ0 = capped(0.85, 0.4, h);
  const ovenZ1 = ovenZ0 + capped(0.6, 0.28, h);
  const handle = (a: number, b: number): Panel[] => [{ ...barHandle(a, b, ovenZ1 - 0.25 * (ovenZ1 - ovenZ0), ovenZ1, -d / 2), slot: "metal" }];
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("laminate", -w / 2, w / 2, -d / 2 + t, d / 2, plinthH, h),
    ...doorFronts("laminate", -w / 2, w / 2, d, t, plinthH, ovenZ0 - gap, 1, gap),
    ...doorFronts("dark", -w / 2, w / 2, d, t, ovenZ0, ovenZ1, 1, gap, handle),
    ...doorFronts("laminate", -w / 2, w / 2, d, t, ovenZ1 + gap, h, 1, gap),
  ];
}

/**
 * A range (pieces.07): a dark plinth set back, a metal body with the hob's rings on its top, the dark oven door with a
 * metal handle, and a metal control strip above the door.
 */
function range(w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.1, 0.12, h);
  const recess = capped(0.05, 0.1, d);
  const t = capped(0.03, 0.1, d);
  const gap = Math.min(doorGap(w), 0.02 * h);
  const doorTop = h - capped(0.12, 0.2, h);
  const handle = (a: number, b: number): Panel[] => [{ ...barHandle(a, b, doorTop - capped(0.1, 0.2, h), doorTop - capped(0.06, 0.12, h), -d / 2), slot: "metal" }];
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("metal", -w / 2, w / 2, -d / 2 + t, d / 2, plinthH, h, rings(w, d, h)),
    ...doorFronts("dark", -w / 2, w / 2, d, t, plinthH, doorTop - gap, 1, gap, handle),
    box("metal", -w / 2, w / 2, -d / 2, -d / 2 + t, doorTop, h),
  ];
}

/**
 * A cooker hood (pieces.07): a metal canopy across its width behind a dark front lip and, above a slim one's height, a
 * chimney at the back to its top.
 */
function cookerHood(w: number, d: number, h: number): Part[] {
  const canopyH = h <= 0.2 ? h : capped(0.15, 0.3, h);
  const lip = capped(0.02, 0.1, d);
  const c = Math.min(0.26, 0.45 * w, 0.6 * d); // the chimney's side
  const canopy = [box("dark", -w / 2, w / 2, -d / 2, -d / 2 + lip, 0, canopyH), box("metal", -w / 2, w / 2, -d / 2 + lip, d / 2, 0, canopyH)];
  return h - canopyH <= 0.01 ? canopy : [...canopy, box("metal", -c / 2, c / 2, d / 2 - c, d / 2, canopyH, h)];
}

/** A tall pantry (pieces.07): a dark plinth set back, a laminate carcass and full-height doors of about 0.50 m with bar handles. */
function tallPantry(w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.1, 0.12, h);
  const recess = capped(0.05, 0.1, d);
  const t = capped(0.02, 0.1, d);
  const handleZ = capped(1.0, 0.5, h);
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("laminate", -w / 2, w / 2, -d / 2 + t, d / 2, plinthH, h),
    ...doorFronts("laminate", -w / 2, w / 2, d, t, plinthH, h, countOf(w, 0.5), doorGap(w), (a, b) => [barHandle(a, b, handleZ - capped(0.15, 0.1, h), handleZ, -d / 2)]),
  ];
}

export const KITCHEN: AppearanceTable = new Map([
  ["counter", (_c, w, d, h) => baseUnit(w, d, h)],
  ["hobUnit", (_c, w, d, h) => baseUnit(w, d, h, rings(w, d, h))],
  ["sinkUnit", (_c, w, d, h) => baseUnit(w, d, h, bowl(w, d, h))],
  ["fridge", (_c, w, d, h) => fridge(w, d, h)],
  ["dishwasher", (_c, w, d, h) => dishwasher(w, d, h)],
  ["ovenColumn", (_c, w, d, h) => ovenColumn(w, d, h)],
  ["wallCabinet", (_c, w, d, h) => wallCabinet(w, d, h)],
  ["range", (_c, w, d, h) => range(w, d, h)],
  ["cookerHood", (_c, w, d, h) => cookerHood(w, d, h)],
  ["tallPantry", (_c, w, d, h) => tallPantry(w, d, h)],
]);
