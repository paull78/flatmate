import { MAX_REPEAT, box, capped, countOf, spans } from "./sizes";
import { wallTv } from "./storage";
import type { AppearanceTable, Panel, Part } from "./types";

// The pieces hung on a wall and the coat stand in 3D (hangings.02): x across, y from −d/2 (the front, into the room) to
// d/2 (the back, against the wall), z from 0 to h. A hung piece's back layer fills its width and height and its front
// layer reaches the front, so the parts fill the box (parts AC-03); details are panels on the front.

/** m: how far a framed piece's face sits behind its frame's front. */
const FACE_BACK = 0.005;

/**
 * A framed piece: a backing against the wall and, in front of it, a frame of four bars around `face`, a slab set back
 * from the frame's front. The face is a part, not a panel: a panel half a millimetre off a dark frame showed through
 * as dark triangles in a large house seen from afar (the user's review).
 *
 *   ┌──────────┐
 *   │┌────────┐│   bars: top and bottom full width, the sides between them
 *   ││  face  ││
 *   │└────────┘│
 *   └──────────┘
 */
function framed(w: number, d: number, h: number, back: Part["slot"], frame: Part["slot"], face: Part["slot"]): Part[] {
  const rim = capped(0.03, 0.15, Math.min(w, h));
  const [l, r, front] = [-w / 2, w / 2, -d / 2];
  return [
    box(back, l, r, 0, d / 2, 0, h),
    box(frame, l, r, front, 0, 0, rim),
    box(frame, l, r, front, 0, h - rim, h),
    box(frame, l, l + rim, front, 0, rim, h - rim),
    box(frame, r - rim, r, front, 0, rim, h - rim),
    box(face, l + rim, r - rim, front + Math.min(FACE_BACK, d / 4), 0, rim, h - rim),
  ];
}

/** A clock: a round face approximated by three bands, its middle widest, with a pale dial on the middle band's front. */
function clock(w: number, d: number, h: number): Part[] {
  const [lo, hi] = [h * 0.2, h * 0.8];
  const narrow = w * 0.35;
  const dial: Panel = { normal: "-y", at: { x0: -w * 0.4, x1: w * 0.4, y0: -d / 2, y1: -d / 2, z0: lo + h * 0.05, z1: hi - h * 0.05 }, slot: "ceramic" };
  return [
    box("dark", -narrow, narrow, -d / 2, d / 2, 0, lo),
    box("dark", -w / 2, w / 2, -d / 2, d / 2, lo, hi, [dial]),
    box("dark", -narrow, narrow, -d / 2, d / 2, hi, h),
  ];
}

/**
 * A pegboard (hangings, the user's review): the board against the wall and, hung on it, a drill (an orange body over a
 * dark grip and battery, a steel nose), screwdrivers (a coloured handle over a thin steel shaft), a hammer (a dark head
 * over a wood handle) and, along the bottom, small labelled bins; a wider board holds more screwdrivers and bins.
 *
 *   ▄▄▄▄▄▄▬  ▐▌ ▐▌ ▐▌   ▄█▄      drill, screwdrivers, hammer
 *    ▐█▌     │  │  │     █
 *   ┌───┐ ┌───┐ ┌───┐ ┌───┐      bins
 */
const MAX_SCREWDRIVERS = 6;
function pegboard(w: number, d: number, h: number): Part[] {
  const board = d / 2 - capped(0.02, 0.3, d);
  const [front, near] = [-d / 2, Math.max(-d / 2, board - 0.03)]; // a drill and a bin stand out to the front; a hand tool hangs close
  const margin = Math.min(0.04, 0.06 * w);
  const [left, right] = [-w / 2 + margin, w / 2 - margin];
  const z = (share: number): number => share * h;

  const dw = Math.min(0.2, 0.3 * w);
  const nose = Math.min(0.03, 0.05 * w);
  const drill = [
    box("flame", left, left + dw, front, board, z(0.76), z(0.88)),
    box("metal", left + dw, left + dw + nose, front, board, z(0.79), z(0.85)),
    box("dark", left + 0.3 * dw, left + 0.55 * dw, front, board, z(0.58), z(0.76)),
    box("dark", left + 0.2 * dw, left + 0.65 * dw, front, board, z(0.52), z(0.58)),
  ];

  const hammerW = Math.min(0.12, 0.16 * w);
  const hx = right - hammerW / 2;
  const handle = Math.min(0.015, hammerW / 8);
  const hammer = [box("wood", hx - handle, hx + handle, near, board, z(0.55), z(0.86)), box("dark", right - hammerW, right, near, board, z(0.86), z(0.92))];

  const pitch = Math.min(0.055, 0.1 * w);
  const space = Math.min(0.03, 0.05 * w);
  const [from, to] = [left + dw + nose + space, right - hammerW - space];
  const n = Math.max(0, Math.min(MAX_SCREWDRIVERS, Math.floor((to - from) / pitch)));
  const start = from + (to - from - n * pitch) / 2;
  const screwdrivers = Array.from({ length: n }, (_, i): Part[] => {
    const cx = start + pitch * (i + 0.5);
    const [grip, shaft] = [0.25 * pitch, 0.07 * pitch];
    return [box(i % 2 === 0 ? "flame" : "fabric", cx - grip, cx + grip, near, board, z(0.76), z(0.88)), box("metal", cx - shaft, cx + shaft, near, board, z(0.58), z(0.76))];
  }).flat();

  const [binW, gap] = [Math.min(0.12, 0.2 * w), Math.min(0.03, 0.05 * w)];
  const bins = Math.max(1, Math.min(MAX_REPEAT, Math.floor((right - left + gap) / (binW + gap))));
  const binStart = (left + right - (bins * binW + (bins - 1) * gap)) / 2;
  const binParts = Array.from({ length: bins }, (_, i): Part => {
    const x0 = binStart + i * (binW + gap);
    const label: Panel = { normal: "-y", at: { x0: x0 + 0.2 * binW, x1: x0 + 0.8 * binW, y0: front, y1: front, z0: z(0.17), z1: z(0.24) }, slot: "laminate" };
    return box("fabric", x0, x0 + binW, front, board, z(0.08), z(0.3), [label]);
  });

  return [box("wood", -w / 2, w / 2, board, d / 2, 0, h), ...drill, ...screwdrivers, ...hammer, ...binParts];
}

/** Coat hooks: a wood rail against the wall and a metal hook every 15 cm reaching out, in the rail's lower half. */
function coatHooks(w: number, d: number, h: number): Part[] {
  const rail = d / 2 - capped(0.02, 0.4, d);
  const hook = capped(0.015, 0.5, w / countOf(w, 0.15, 2));
  const hooks = spans(-w / 2, w / 2, countOf(w, 0.15, 2)).map(([a, b]): Part => {
    const x = (a + b) / 2;
    return box("metal", x - hook / 2, x + hook / 2, -d / 2, rail, h * 0.1, h * 0.6);
  });
  return [box("wood", -w / 2, w / 2, rail, d / 2, 0, h), ...hooks];
}

/** A coat stand: a disc of a base filling its ring, a pole up the middle, and four hooks out from the pole's top. */
function coatStand(w: number, d: number, h: number): Part[] {
  const baseTop = capped(0.03, 0.05, h);
  const pole = capped(0.02, 0.1, Math.min(w, d));
  const reach = Math.min(w, d) * 0.3;
  const [z0, z1] = [h - capped(0.2, 0.15, h), h - capped(0.12, 0.08, h)];
  const t = capped(0.015, 0.5, pole);
  const hooks: Part[] = [
    box("metal", pole, reach, -t, t, z0, z1),
    box("metal", -reach, -pole, -t, t, z0, z1),
    box("metal", -t, t, pole, reach, z0, z1),
    box("metal", -t, t, -reach, -pole, z0, z1),
  ];
  return [
    { shape: "outline", z0: 0, z1: baseTop, slot: "dark" },
    { shape: "cylinder", at: { x0: -pole, x1: pole, y0: -pole, y1: pole, z0: baseTop, z1: h }, slot: "wood" },
    ...hooks,
  ];
}

export const HUNG: AppearanceTable = new Map([
  ["picture", (_c: string, w: number, d: number, h: number) => framed(w, d, h, "laminate", "dark", "linen")],
  ["mirror", (_c: string, w: number, d: number, h: number) => framed(w, d, h, "laminate", "wood", "metal")],
  ["clock", (_c: string, w: number, d: number, h: number) => clock(w, d, h)],
  ["wallTv", (_c: string, w: number, d: number, h: number) => wallTv(w, d, h)],
  ["pegboard", (_c: string, w: number, d: number, h: number) => pegboard(w, d, h)],
  ["coatHooks", (_c: string, w: number, d: number, h: number) => coatHooks(w, d, h)],
  ["coatStand", (_c: string, w: number, d: number, h: number) => coatStand(w, d, h)],
]);
