import { TAU, arc, inner, seg, type SymbolOf, type SymbolTable } from "./lines";
import type { Primitive } from "../scene-types";

// The pieces hung on a wall and the coat stand (hangings.02), in footprint space: x from −w/2 to w/2, y from −d (the
// front, into the room) to 0 (the back, against the wall). A hung piece is a thin strip: its detail runs along it.
// Above the plan's cut a hung piece draws its dashed outline; its card still shows this symbol (pieces.01).

/** One mark every `every` m along a strip w wide, at least one, at most 12, centred. */
function along(w: number, every: number): number[] {
  const n = Math.max(1, Math.min(12, Math.floor(w / every)));
  return Array.from({ length: n }, (_, k) => -w / 2 + (w * (k + 0.5)) / n);
}

/** A picture: the glass along its face, the frame's two ends inset from the sides. */
function picture(w: number, d: number): Primitive[] {
  const i = Math.min(0.03, w / 8);
  return [seg(-w / 2 + i, -d / 2, w / 2 - i, -d / 2), seg(-w / 2 + i, -d, -w / 2 + i, 0), seg(w / 2 - i, -d, w / 2 - i, 0)];
}

/** A mirror: its glass along the face and a short glint across it near its left end. */
function mirror(w: number, d: number): Primitive[] {
  const x = -w / 2 + Math.min(0.08, w / 4);
  return [seg(-w / 2, -d * 0.6, w / 2, -d * 0.6), seg(x, -d, x + Math.min(0.04, w / 6), 0)];
}

/** A clock: its face along the front and the hands' spindle at its middle. */
function clock(w: number, d: number): Primitive[] {
  return [seg(-w / 2, -d * 0.6, w / 2, -d * 0.6), seg(0, -d, 0, -d * 0.6)];
}

/** A wall TV: its screen near the front and its bracket at the middle of the back. */
function wallTv(w: number, d: number): Primitive[] {
  const b = Math.min(0.1, w / 6);
  return [seg(-w / 2, -d * 0.75, w / 2, -d * 0.75), seg(-b, -d * 0.3, b, -d * 0.3)];
}

/** A pegboard: the board against the wall, and a tool hung on it every 15 cm, reaching toward the front. */
function pegboard(w: number, d: number): Primitive[] {
  const board = -d * 0.3;
  return [seg(-w / 2, board, w / 2, board), ...along(w, 0.15).map((x) => seg(x, board, x, -d * 0.9))];
}

/** Coat hooks: the rail against the wall and a hook every 15 cm, out to the front. */
function coatHooks(w: number, d: number): Primitive[] {
  const rail = -d * 0.35;
  return [seg(-w / 2, rail, w / 2, rail), ...along(w, 0.15).map((x) => seg(x, rail, x, -d))];
}

/** A coat stand from above: its pole at the middle and four hooks out toward its base's rim. */
function coatStand(w: number, d: number): Primitive[] {
  const r = Math.min(w, d) / 2;
  const pole = Math.min(0.025, r / 4);
  const reach = r * 0.6;
  const cy = -d / 2;
  const hooks = [0, 1, 2, 3].map((k) => {
    const a = (k * TAU) / 4 + TAU / 8;
    return seg(Math.cos(a) * pole, cy + Math.sin(a) * pole, Math.cos(a) * reach, cy + Math.sin(a) * reach);
  });
  return [arc(0, cy, pole, 0, TAU), ...hooks];
}

export const HUNG: SymbolTable = new Map<string, SymbolOf>([
  ["picture.standard", (w, d) => inner(picture(w, d))],
  ["mirror.standard", (w, d) => inner(mirror(w, d))],
  ["clock.standard", (w, d) => inner(clock(w, d))],
  ["wallTv.standard", (w, d) => inner(wallTv(w, d))],
  ["pegboard.standard", (w, d) => inner(pegboard(w, d))],
  ["coatHooks.standard", (w, d) => inner(coatHooks(w, d))],
  ["coatStand.standard", (w, d) => inner(coatStand(w, d))],
]);
