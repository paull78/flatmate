import { BOOK_DEPTHS, tvLayout } from "../piece-counts";
import type { Primitive } from "../scene-types";
import { inner, rect, roundRect, seg, upTo, type SymbolOf, type SymbolTable } from "./lines";

// Storage (seating.04). Fixed sizes shrink on small pieces (`upTo`).

/**
 * A wardrobe: the rail at −0.45·d with a straight hanger across it every ~0.09 m, and the front band at −0.90·d with the
 * joints between its door leaves (one per ~0.50 m).
 */
function wardrobe(w: number, d: number): Primitive[] {
  const rail = -0.45 * d;
  const band = -0.9 * d;
  const end = upTo(0.03, w, d, 0.1); // the rail stops short of the sides
  const n = Math.max(3, Math.floor(w / 0.09 + 1e-9));
  const half = Math.min(0.2, 0.32 * d); // a hanger's half-length
  const hangers = Array.from({ length: n - 1 }, (_, k) => {
    const x = -w / 2 + (w * (k + 1)) / n;
    return seg(x, rail + half, x, rail - half);
  });
  const leaves = Math.max(1, Math.round(w / 0.5 + 1e-9));
  const joints = Array.from({ length: leaves - 1 }, (_, k) => {
    const x = -w / 2 + (w * (k + 1)) / leaves;
    return seg(x, band, x, -d);
  });
  return [seg(-w / 2 + end, rail, w / 2 - end, rail), ...hangers, seg(-w / 2, band, w / 2, band), ...joints];
}

/** A chest of drawers: an inset top, the drawer-front strip split into columns of about 0.45 m, each with a pull. */
function drawers(w: number, d: number): Primitive[] {
  const i = upTo(0.03, w, d, 0.1);
  const strip = -d * 0.86;
  const n = Math.max(2, Math.round(w / 0.45));
  const pull = Math.min(0.06, w / (4 * n)); // half a pull's length
  const pulls = Array.from({ length: n }, (_, k) => {
    const cx = -w / 2 + (w * (k + 0.5)) / n;
    return seg(cx - pull, -d * 0.93, cx + pull, -d * 0.93);
  });
  const dividers = Array.from({ length: n - 1 }, (_, k) => {
    const x = -w / 2 + (w * (k + 1)) / n;
    return seg(x, strip, x, -d);
  });
  return [...rect(-w / 2 + i, strip + i, w / 2 - i, -i), seg(-w / 2, strip, w / 2, strip), ...pulls, ...dividers];
}

const BOOK_WIDTHS = [0.03, 0.025, 0.035, 0.03, 0.02, 0.04, 0.03, 0.025];
const BOOKS_PER_RUN = BOOK_WIDTHS.length;
const RUN_GAP = 0.06;
const SHELF_END = 0.03; // books stay this clear of each end

/**
 * A shelf: book spines from the back, of cycling widths and depths, in runs of eight with a 0.06 m gap between runs.
 * Each book is its left side and its front; the last book of a run closes with its right side.
 */
/** A glass cabinet from above: its books, a line along its doors' back face and a joint between two doors. */
function glassCabinet(w: number, d: number): Primitive[] {
  const band = -0.9 * d;
  const doors = w < 0.6 ? 1 : 2;
  return [...shelf(w, 0.85 * d), seg(-w / 2, band, w / 2, band), ...(doors === 2 ? [seg(0, band, 0, -d)] : [])];
}

function shelf(w: number, d: number): Primitive[] {
  const widthOf = (k: number) => BOOK_WIDTHS[k % BOOKS_PER_RUN] ?? 0;
  const last = w / 2 - SHELF_END;
  const out: Primitive[] = [];
  let x = -w / 2 + SHELF_END;
  for (let k = 0; x + widthOf(k) <= last + 1e-9; k++) {
    const bd = d * (BOOK_DEPTHS[k % BOOKS_PER_RUN] ?? 0);
    out.push(seg(x, 0, x, -bd), seg(x, -bd, x + widthOf(k), -bd));
    x += widthOf(k);
    const gap = (k + 1) % BOOKS_PER_RUN === 0 ? RUN_GAP : 0;
    if (gap > 0 || x + widthOf(k + 1) > last + 1e-9) out.push(seg(x, 0, x, -bd));
    x += gap;
  }
  return out;
}

/** A TV unit: a thin screen near the back (`tvLayout`), on a rounded stand plate. */
function tvUnit(w: number, d: number): Primitive[] {
  const tv = tvLayout(w, d);
  return [...rect(-tv.screenWidth / 2, -tv.screenFront, tv.screenWidth / 2, -tv.screenBack), ...roundRect(-tv.plateWidth / 2, -tv.plateFront, tv.plateWidth / 2, -tv.screenFront, 0.02)];
}

/** A storage chest (pieces.07): the lid's hinge line near the back and a handle at the front, no drawer strip. */
function storageChest(w: number, d: number): Primitive[] {
  const hinge = -upTo(0.07, w, d, 0.15);
  const handle = upTo(0.06, w, d, 0.1);
  const y = -d + upTo(0.03, w, d, 0.07);
  return [seg(-w / 2, hinge, w / 2, hinge), seg(-handle, y, handle, y)];
}

export const STORAGE: SymbolTable = new Map<string, SymbolOf>([
  ["wardrobe.standard", (w, d) => inner(wardrobe(w, d))],
  ["drawers.standard", (w, d) => inner(drawers(w, d))],
  ["shelf.standard", (w, d) => inner(shelf(w, d))],
  ["glassCabinet.standard", (w, d) => inner(glassCabinet(w, d))],
  ["halfGlassCabinet.standard", (w, d) => inner(glassCabinet(w, d))],
  ["tvUnit.standard", (w, d) => inner(tvUnit(w, d))],
  ["storageChest.standard", (w, d) => inner(storageChest(w, d))],
]);
