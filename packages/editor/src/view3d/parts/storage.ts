import { cornerRadius } from "@fm/domain";
import { BOOK_DEPTHS, tvLayout } from "../../view/piece-counts";
import { barHandle, box, capped, countOf, doorFronts, doorGap, drawerFronts, spans } from "./sizes";
import type { AppearanceTable, Panel, Part, Slot } from "./types";

// Storage, as in `view/symbols/storage.ts`, and the nightstand (clarity.05).

/** A wardrobe: a dark plinth set back, a wood carcass, wood doors (one per 0.50 m, 2 to 8) with dark handles. */
function wardrobe(w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.08, 0.1, h);
  const recess = capped(0.04, 0.1, d);
  const t = capped(0.02, 0.1, d);
  const n = countOf(w, 0.5, 2);
  const mid = (plinthH + h) / 2;
  const handle = (a: number, b: number) => {
    const x = (a + b) / 2 < 0 ? b - capped(0.04, 0.2, b - a) : a + capped(0.04, 0.2, b - a);
    const hw = capped(0.015, 0.1, b - a);
    return [{ normal: "-y" as const, at: { x0: x - hw / 2, x1: x + hw / 2, y0: -d / 2, y1: -d / 2, z0: mid - capped(0.15, 0.1, h), z1: mid + capped(0.15, 0.1, h) }, slot: "dark" as const }];
  };
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("wood", -w / 2, w / 2, -d / 2 + t, d / 2, plinthH, h),
    ...doorFronts("wood", -w / 2, w / 2, d, t, plinthH, h, n, doorGap(w), handle),
  ];
}

const BOOK_SLOTS: readonly Slot[] = ["fabric", "linen", "dark"];
const BOOK_HEIGHTS = [1, 0.82, 0.92]; // shares of a block's height, cycling
/** Blocks a level: an 8-level shelf's frame (12 boxes, 5 faces each) leaves 90 of the 150 faces, and a block costs 7. */
const blocksOn = (levels: number): number => Math.min(3, Math.floor(90 / (7 * levels)));

/** A block of books standing on a board, its back at the shelf's back, with two spines of the other book slots on its front. */
function bookBlock(k: number, x0: number, x1: number, d: number, back: number, z0: number, height: number): Part {
  const y0 = d / 2 - d * (BOOK_DEPTHS[k % BOOK_DEPTHS.length] ?? 0);
  const z1 = z0 + height * (BOOK_HEIGHTS[k % BOOK_HEIGHTS.length] ?? 0);
  const spine = (a: number, b: number, offset: number): Panel => ({
    normal: "-y",
    at: { x0: x0 + a * (x1 - x0), x1: x0 + b * (x1 - x0), y0, y1: y0, z0, z1 },
    slot: BOOK_SLOTS[(k + offset) % BOOK_SLOTS.length] ?? "dark",
  });
  return box(BOOK_SLOTS[k % BOOK_SLOTS.length] ?? "dark", x0, x1, y0, d / 2 - back, z0, z1, [spine(0.2, 0.38, 1), spine(0.62, 0.76, 2)]);
}

/**
 * An open shelf: two sides, a thin back, a top board, and shelves counted from the height (one per 0.35 m, 2 to 8), each
 * with blocks of books, fewer on very tall shelves (clarity.05).
 */
function shelf(w: number, d: number, h: number): Part[] {
  const side = capped(0.018, 0.1, w);
  const back = capped(0.006, 0.05, d);
  const t = capped(0.018, 0.04, h);
  const n = countOf(h, 0.35, 2);
  const levels = spans(0, h, n).map(([a]) => a);
  const [x0, x1] = [-w / 2 + side, w / 2 - side];
  const blocks = blocksOn(n);
  const bookH = capped(0.24, 0.75, h / n - 2 * t);
  const books = levels.flatMap((z, level) => spans(x0, x1, blocks).map(([a, b], i) => {
    const bw = capped(0.24, 0.7, b - a);
    const left = (level + i) % 2 === 0; // not stacked in columns
    return bookBlock(level * 2 + i, left ? a : b - bw, left ? a + bw : b, d, back, z + t, bookH);
  }));
  return [
    box("wood", -w / 2, x0, -d / 2, d / 2, 0, h),
    box("wood", x1, w / 2, -d / 2, d / 2, 0, h),
    box("wood", x0, x1, d / 2 - back, d / 2, 0, h),
    ...levels.map((z) => box("wood", x0, x1, -d / 2, d / 2 - back, z, z + t)),
    box("wood", x0, x1, -d / 2, d / 2 - back, h - t, h),
    ...books,
  ];
}

/** A chest: a dark plinth set back, a wood carcass, `n` drawer fronts with handles up to a top `topT` thick (0: none). */
function chest(w: number, d: number, h: number, n: number, topT: number): Part[] {
  const plinthH = capped(0.08, 0.1, h);
  const recess = capped(0.04, 0.1, d);
  const t = capped(0.02, 0.1, d);
  const under = h - topT;
  return [
    box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, 0, plinthH),
    box("wood", -w / 2, w / 2, -d / 2 + t, d / 2, plinthH, under),
    ...drawerFronts("wood", -w / 2, w / 2, d, t, plinthH, under, n, doorGap(w)),
    ...(topT > 0 ? [box("wood", -w / 2, w / 2, -d / 2, d / 2, under, h)] : []),
  ];
}

/**
 * A nightstand: its soft ring in three layers, a dark plinth, a wood body and a thin wood top. Its two drawers are panels
 * on the body's front, on the straight part between the rounded corners, so nothing leaves the ring (symbols.05).
 */
function nightstand(w: number, d: number, h: number): Part[] {
  const plinthH = capped(0.08, 0.1, h);
  const under = h - capped(0.02, 0.06, h);
  const edge = w / 2 - cornerRadius(w, d);
  const y = -d / 2;
  const drawers = spans(plinthH, under, 2, doorGap(w)).flatMap(([a, b]): Panel[] => [
    { normal: "-y", at: { x0: -edge, x1: edge, y0: y, y1: y, z0: a, z1: b }, slot: "wood" },
    barHandle(-edge, edge, a, b, y),
  ]);
  return [{ shape: "outline", z0: 0, z1: plinthH, slot: "dark" }, { shape: "outline", z0: plinthH, z1: under, slot: "wood", panels: drawers }, { shape: "outline", z0: under, z1: h, slot: "wood" }];
}

/** Under this depth a TV unit is the screen alone: the wall TV (studio.02, clarity.05). */
const TV_CABINET_MIN_DEPTH = 0.25;

/** A wall TV: a dark screen across the box at its front, on a metal bracket back to the wall. */
export function wallTv(w: number, d: number, h: number): Part[] {
  const thick = capped(0.06, 0.6, d);
  const [bw, bh] = [capped(0.3, 0.4, w), capped(0.2, 0.4, h)];
  return [box("dark", -w / 2, w / 2, -d / 2, -d / 2 + thick, 0, h), box("metal", -bw / 2, bw / 2, -d / 2 + thick, d / 2, (h - bh) / 2, (h + bh) / 2)];
}

/** A TV unit: a low wood cabinet with its doors and stand plate (`tvLayout`, as the plan), and the dark screen above on a metal neck. */
function tvUnit(w: number, d: number, h: number): Part[] {
  if (d < TV_CABINET_MIN_DEPTH) return wallTv(w, d, h);
  const cabinetH = capped(0.45, 0.4, h);
  const neckTop = cabinetH + capped(0.05, 0.05, h);
  const tv = tvLayout(w, d);
  const gap = doorGap(w);
  const [screenFront, screenBack] = [d / 2 - tv.screenFront, d / 2 - tv.screenBack];
  const onTop: Panel = { normal: "+z", at: { x0: -tv.plateWidth / 2, x1: tv.plateWidth / 2, y0: d / 2 - tv.plateFront, y1: screenFront, z0: cabinetH, z1: cabinetH }, slot: "dark" };
  const doors = spans(-w / 2, w / 2, countOf(w, 0.6, 2), gap).flatMap(([a, b]): Panel[] => [
    { normal: "-y", at: { x0: a, x1: b, y0: -d / 2, y1: -d / 2, z0: gap, z1: cabinetH - gap }, slot: "wood" },
    barHandle(a, b, cabinetH * 0.7, cabinetH - gap, -d / 2),
  ]);
  const neck = capped(0.12, 0.5, tv.plateWidth);
  return [
    box("wood", -w / 2, w / 2, -d / 2, d / 2, 0, cabinetH, [onTop, ...doors]),
    box("metal", -neck / 2, neck / 2, screenFront, screenBack, cabinetH, neckTop),
    box("dark", -tv.screenWidth / 2, tv.screenWidth / 2, screenFront, screenBack, neckTop, h),
  ];
}

/** A storage chest (pieces.07): a wood body under a wood lid, a dark handle on its front. */
function storageChest(w: number, d: number, h: number): Part[] {
  const lid = capped(0.04, 0.12, h);
  const hw = capped(0.12, 0.3, w);
  const hz = h - lid - capped(0.08, 0.2, h);
  const handle: Panel = { normal: "-y", at: { x0: -hw / 2, x1: hw / 2, y0: -d / 2, y1: -d / 2, z0: hz - capped(0.02, 0.05, h), z1: hz }, slot: "dark" };
  return [box("wood", -w / 2, w / 2, -d / 2, d / 2, 0, h - lid, [handle]), box("wood", -w / 2, w / 2, -d / 2, d / 2, h - lid, h)];
}

/**
 * A tall bookcase with glass doors (the user's request after hangings): a white carcass on a plinth with shelves (one
 * per 0.36 m of its inside, 2 to 7 spaces), and its doors (one under 0.60 m wide, else two) as frames whose panes stay
 * open, so what stands inside shows (no transparency, as the sheer, hangings.13): books in the lowest spaces, a vase
 * and a box higher up; `half`, the doors solid below their middle, the spaces behind them left empty.
 *
 *   ┌──┬──┐   glass                 ┌──┬──┐   half glass
 *   │▯▫│▫▯│   a vase and a box      │▯▫│▫▯│
 *   │──┼──│                         │──┼──│
 *   │▯▫│▫▯│                         ├──┼──┤   mid rail
 *   │──┼──│                         │▓▓│▓▓│   solid panels
 *   │▮▮│▮▮│   books                 │▓▓│▓▓│
 *   └──┴──┘                         └──┴──┘
 */
function glassCabinet(w: number, d: number, h: number, half: boolean): Part[] {
  const t = capped(0.02, 0.08, d); // the doors' layer
  const side = capped(0.018, 0.1, w);
  const back = capped(0.006, 0.05, d);
  const plinth = capped(0.06, 0.05, h);
  const board = capped(0.018, 0.04, h);
  const [x0, x1] = [-w / 2 + side, w / 2 - side];
  const [y0, y1] = [-d / 2 + t, d / 2 - back];
  const inside = h - board - plinth;
  const n = Math.max(2, Math.min(7, Math.round(inside / 0.36)));
  const level = (k: number): number => plinth + (k * inside) / n; // the bottom of space k (its shelf's bottom from k = 1)
  const shelves = Array.from({ length: n - 1 }, (_, i) => box("laminate", x0, x1, y0, y1, level(i + 1), level(i + 1) + board));
  const carcass = [
    box("laminate", -w / 2, x0, y0, d / 2, 0, h),
    box("laminate", x1, w / 2, y0, d / 2, 0, h),
    box("laminate", x0, x1, y1, d / 2, 0, h),
    box("laminate", x0, x1, y0, y1, 0, plinth),
    box("laminate", x0, x1, y0, y1, h - board, h),
  ];

  const mid = plinth + 0.5 * (h - plinth);
  const doors = w < 0.6 ? 1 : 2;
  const gap = capped(0.003, 0.01, w);
  const frame = capped(0.05, 0.15, Math.min(w / doors, h));
  const doorParts = spans(-w / 2, w / 2, doors).flatMap(([a0, b0], i): Part[] => {
    const [a, b] = [i > 0 ? a0 + gap / 2 : a0, i < doors - 1 ? b0 - gap / 2 : b0];
    const meet = doors === 1 ? b : i === 0 ? b : a; // the knob's side: the meeting edge, or the free edge of a single door
    const knobX = meet === b ? b - frame / 2 : a + frame / 2;
    const [kw, kh] = [Math.min(0.006, frame / 4), Math.min(0.03, (h - plinth) / 8)];
    const knob: Panel = { normal: "-y", at: { x0: knobX - kw, x1: knobX + kw, y0: -d / 2, y1: -d / 2, z0: mid - kh, z1: mid + kh }, slot: "metal" };
    const stiles = [box("laminate", a, a + frame, -d / 2, y0, plinth, h, meet === a ? [knob] : []), box("laminate", b - frame, b, -d / 2, y0, plinth, h, meet === b ? [knob] : [])];
    const rails = [box("laminate", a + frame, b - frame, -d / 2, y0, plinth, plinth + frame), box("laminate", a + frame, b - frame, -d / 2, y0, h - frame, h)];
    const solid = half ? [box("laminate", a + frame, b - frame, -d / 2, y0, plinth + frame, mid), box("laminate", a + frame, b - frame, -d / 2, y0, mid, mid + frame)] : [];
    return [...stiles, ...rails, ...solid];
  });

  // What shows behind the glass: books in the two lowest spaces seen, then a vase and a box in up to two more.
  const seen = Array.from({ length: n }, (_, k) => k).filter((k) => !half || level(k) >= mid);
  const room = (k: number): number => level(k + 1) - (k === 0 ? plinth : level(k) + board); // the space's clear height
  const floor = (k: number): number => (k === 0 ? plinth : level(k) + board);
  const contents = seen.slice(0, 4).flatMap((k, i): Part[] => {
    const z = floor(k);
    const clear = room(k);
    if (!half && i < 2) return [bookBlock(k, x0 + 0.04 * (x1 - x0), x0 + 0.62 * (x1 - x0), d, back, z, 0.8 * clear)];
    const vase = Math.min(capped(0.1, 0.2, x1 - x0), 0.8 * (y1 - y0)); // square, inside a shallow cabinet too
    const vx = i % 2 === 0 ? x0 + 0.18 * (x1 - x0) : x1 - 0.18 * (x1 - x0) - vase;
    const bx = i % 2 === 0 ? x1 - 0.1 * (x1 - x0) - capped(0.2, 0.35, x1 - x0) : x0 + 0.1 * (x1 - x0);
    const bw = capped(0.2, 0.35, x1 - x0);
    const yc = (y0 + y1) / 2;
    return [
      box("ceramic", vx, vx + vase, yc - vase / 2, yc + vase / 2, z, z + 0.75 * clear),
      box(i % 2 === 0 ? "wood" : "linen", bx, bx + bw, yc - 0.3 * (y1 - y0), yc + 0.3 * (y1 - y0), z, z + 0.35 * clear),
    ];
  });
  return [...carcass, ...shelves, ...doorParts, ...contents];
}

export const STORAGE: AppearanceTable = new Map([
  ["wardrobe", (_c, w, d, h) => wardrobe(w, d, h)],
  ["drawers", (_c, w, d, h) => chest(w, d, h, countOf(h, 0.2, 2), 0)],
  ["nightstand", (_c, w, d, h) => nightstand(w, d, h)],
  ["shelf", (_c, w, d, h) => shelf(w, d, h)],
  ["glassCabinet", (_c, w, d, h) => glassCabinet(w, d, h, false)],
  ["halfGlassCabinet", (_c, w, d, h) => glassCabinet(w, d, h, true)],
  ["tvUnit", (_c, w, d, h) => tvUnit(w, d, h)],
  ["storageChest", (_c, w, d, h) => storageChest(w, d, h)],
]);
