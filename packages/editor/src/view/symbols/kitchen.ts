import { hobRings } from "../piece-counts";
import type { Primitive } from "../scene-types";
import { arc, inner, insetOf, rect, roundRect, seg, TAU, type SymbolOf, type SymbolTable } from "./lines";

// Kitchen: the modules a run is built from, side by side along a wall (furnish.11), and the retired kitchen block.

/** The retired kitchen block: a four-burner hob and a sink. */
function kitchen(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  const hob = Math.min(d - 2 * i, w * 0.4); // the hob's square side
  const hx = -w / 2 + i + hob / 2;
  const r = hob * 0.18;
  const sw = Math.min(w * 0.3, d * 0.8);
  const sd = d * 0.6;
  const burners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => arc(hx + (sx * hob) / 4, -d / 2 + (sy * hob) / 4, r, 0, TAU)));
  return [...burners, ...roundRect(w / 2 - i - sw, -d / 2 - sd / 2, w / 2 - i, -d / 2 + sd / 2, Math.min(sw, sd) * 0.2)];
}

/** The glass plate and the rings its width gives. */
function hobUnit(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  return [...rect(-w / 2 + i, -d + i, w / 2 - i, -i), ...hobRings(w, d).map((r) => arc(r.x, r.y - d / 2, r.r, 0, TAU))];
}

/** A rounded bowl with its drain on the left half, and four drainer ribs (the dish rack) on the right half. */
function sinkUnit(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  const m = Math.min(w, d);
  const ribs = [1, 2, 3, 4].map((k) => {
    const y = -2 * i - (k * (d - 4 * i)) / 5;
    return seg(i, y, w / 2 - 2 * i, y);
  });
  return [...roundRect(-w / 2 + 2 * i, -d + 2 * i, -i, -2 * i, 0.15 * m), arc(-w / 4 + i / 2, -d / 2, 0.05 * m, 0, TAU), ...ribs];
}

/** The worktop's front edge. */
function counter(w: number, d: number): Primitive[] {
  const y = -d + insetOf(w, d);
  return [seg(-w / 2, y, w / 2, y)];
}

/** An appliance's door line near the front, shared by the fridge, the dishwasher and the oven column. */
const door = (w: number, d: number): Primitive => seg(-w / 2, -0.88 * d, w / 2, -0.88 * d);

/** The door and the tall-unit cross behind it. */
const fridge = (w: number, d: number): Primitive[] => [door(w, d), seg(-w / 2, 0, w / 2, -0.88 * d), seg(w / 2, 0, -w / 2, -0.88 * d)];

/** The door, the spray arm and its hub. */
function dishwasher(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  return [door(w, d), seg(-w / 2 + 2 * i, -0.44 * d, w / 2 - 2 * i, -0.44 * d), arc(0, -0.44 * d, 0.05 * Math.min(w, d), 0, TAU)];
}

/** The door, the oven cavity and its fan. */
function ovenColumn(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  return [door(w, d), ...rect(-w / 2 + 2 * i, -0.88 * d + 2 * i, w / 2 - 2 * i, -2 * i), arc(0, -0.44 * d, 0.12 * Math.min(w, d), 0, TAU)];
}

/** The door and one diagonal, the plan sign of a unit hung on the wall. */
const wallCabinet = (w: number, d: number): Primitive[] => [door(w, d), seg(-w / 2, 0, w / 2, -0.88 * d)];

/** A range (pieces.07): the hob's plate and rings over the oven, whose door line runs along the front. */
const range = (w: number, d: number): Primitive[] => [...hobUnit(w, d), door(w, d)];

/** A cooker hood (pieces.07), for its palette card (above the cut the plan draws it dashed): the canopy and the chimney's square at the back. */
function cookerHood(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  const c = Math.min(0.26, 0.45 * w, 0.6 * d) / 2; // the chimney's half side
  return [...rect(-w / 2 + i, -d + i, w / 2 - i, -i), ...rect(-c, -2 * c - i, c, -i)];
}

/** A tall pantry (pieces.07): three shelves across its depth and the door band, with a joint between leaves of about 0.50 m. */
function tallPantry(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  const shelves = [0.25, 0.45, 0.65].map((f) => seg(-w / 2 + i, -f * d, w / 2 - i, -f * d));
  const leaves = Math.max(1, Math.round(w / 0.5 + 1e-9));
  const joints = Array.from({ length: leaves - 1 }, (_, k) => {
    const x = -w / 2 + (w * (k + 1)) / leaves;
    return seg(x, -0.9 * d, x, -d);
  });
  return [...shelves, seg(-w / 2, -0.9 * d, w / 2, -0.9 * d), ...joints];
}

export const KITCHEN: SymbolTable = new Map<string, SymbolOf>([
  ["kitchenBlock.standard", (w, d) => inner(kitchen(w, d))],
  ["hobUnit.standard", (w, d) => inner(hobUnit(w, d))],
  ["sinkUnit.standard", (w, d) => inner(sinkUnit(w, d))],
  ["counter.standard", (w, d) => inner(counter(w, d))],
  ["fridge.standard", (w, d) => inner(fridge(w, d))],
  ["dishwasher.standard", (w, d) => inner(dishwasher(w, d))],
  ["ovenColumn.standard", (w, d) => inner(ovenColumn(w, d))],
  ["wallCabinet.standard", (w, d) => inner(wallCabinet(w, d))],
  ["range.standard", (w, d) => inner(range(w, d))],
  ["cookerHood.standard", (w, d) => inner(cookerHood(w, d))],
  ["tallPantry.standard", (w, d) => inner(tallPantry(w, d))],
]);
