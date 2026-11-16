import { describe, expect, it } from "vitest";
import type { Document, ObjectOptions } from "@fm/domain";
import { aggregateLayout } from "../src/view/aggregate";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import { lookPicture } from "../src/view/look";
import { flipObjectsLayer, objectsLayer } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { planPicture } from "../src/view/picture";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";

// "With computer" on the plan (AC-09, seating.12): a monitor at the back on its foot, a keyboard and a mouse to its
// right, inside the desk's top at every size; the desk with chair draws it on its desk part. Footprint space: x from
// −w/2 to w/2, y from −d (front) to 0 (back).

// A symbol reads the object's options (library.10): the stored record, the computer's key on or absent.
const ON: ObjectOptions = { computer: true };
const OFF = {};
const EPS = 1e-9;

/** The gear: what the symbol gains with the computer on (the symbol with it off is a prefix of it). */
function gearOf(kind: string, w: number, d: number): Primitive[] {
  const off = furnitureSymbol(kind, "standard", w, d, OFF);
  const on = furnitureSymbol(kind, "standard", w, d, ON);
  return on.filter((p) => !off.some((q) => JSON.stringify(q) === JSON.stringify(p)));
}

/** Every point a primitive reaches: a segment's ends, an arc's centre ± its radius. */
function reach(p: Primitive): { x: number; y: number }[] {
  switch (p.kind) {
    case "segment":
      return [p.a, p.b];
    case "arc":
      return [{ x: p.center.x - p.radius, y: p.center.y - p.radius }, { x: p.center.x + p.radius, y: p.center.y + p.radius }];
    default:
      return [{ x: NaN, y: NaN }]; // symbols draw segments and arcs only
  }
}

/** The desk top a kind draws the gear on: the desk itself, or the desk with chair's desk part. */
function topOf(kind: string, w: number, d: number): { x0: number; x1: number; y0: number; y1: number } {
  const l = aggregateLayout(kind, w, d);
  if (!l) return { x0: -w / 2, x1: w / 2, y0: -d, y1: 0 };
  return { x0: l.tableAt.x - l.tableSize.w / 2, x1: l.tableAt.x + l.tableSize.w / 2, y0: l.tableAt.y - l.tableSize.d, y1: l.tableAt.y };
}

function outsideTop(kind: string, w: number, d: number): string[] {
  const t = topOf(kind, w, d);
  const gear = gearOf(kind, w, d);
  const bad = gear.flatMap(reach).filter((q) => !(q.x >= t.x0 - EPS && q.x <= t.x1 + EPS && q.y >= t.y0 - EPS && q.y <= t.y1 + EPS));
  return bad.length > 0 || gear.length === 0 ? [`${kind} ${w.toFixed(3)} × ${d.toFixed(3)}: ${gear.length} lines, ${bad.length} out`] : [];
}

/** roomDoc with a desk against the top wall (desk/p0, x 1.4–2.6, y 3.3–3.9), its computer on when asked. */
function deskDoc(computer: boolean): Document {
  const doc = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "desk", state: "s0", object: { kind: "desk" }, at: { x: 2, y: 3.9 } });
  return computer ? withCommands(doc, { type: "setOption", objectId: "desk/o0", option: "computer", on: true }) : doc;
}

const lines = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "segment" || p.kind === "arc").length;
const has = (ps: readonly Primitive[], ax: number, ay: number, bx: number, by: number) =>
  ps.some((p) => p.kind === "segment" && Math.hypot(p.a.x - ax, p.a.y - ay) < 1e-9 && Math.hypot(p.b.x - bx, p.b.y - by) < 1e-9);

describe("the computer on the plan (AC-09, seating.12)", () => {
  it("draws the mockup's gear on a 1.20 × 0.60 desk: monitor, its foot, keyboard, mouse", () => {
    const gear = gearOf("desk", 1.2, 0.6);
    expect(gear).toHaveLength(24); // two rectangles and two rounded ones
    expect(has(gear, -0.275, -0.13, 0.275, -0.13), "monitor's front").toBe(true);
    expect(has(gear, -0.11, -0.03, 0.11, -0.03) || has(gear, 0.11, -0.03, -0.11, -0.03), "foot's back").toBe(true);
    const points = gear.flatMap(reach);
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(-0.275, 9);
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(0.36, 9); // the mouse: 0.22 + 0.08 + 0.06
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(-0.442, 9); // the keyboard: centred at −0.372, 0.14 deep
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(-0.03, 9);
  });

  it("gear inside the desk top at 0.60–3 m wide and 0.40–1 m deep, and on the desk with chair's desk", () => {
    const bad: string[] = [];
    for (const kind of ["desk", "deskSet"]) {
      for (let w = 0.6; w <= 3 + EPS; w += 0.15) for (let d = 0.4; d <= 1 + EPS; d += 0.05) bad.push(...outsideTop(kind, w, d));
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("gear stays inside at odd sizes from 0.10 to 10 m", () => {
    const bad: string[] = [];
    for (const kind of ["desk", "deskSet"]) {
      for (const w of [0.1, 0.17, 0.3, 0.45, 0.59, 4, 10]) for (const d of [0.1, 0.13, 0.2, 0.25, 0.39, 2, 10]) bad.push(...outsideTop(kind, w, d));
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("the desk with chair draws its desk's gear moved onto its desk part", () => {
    const l = aggregateLayout("deskSet", 1.2, 0.7);
    if (!l) throw new Error("deskSet is an aggregate");
    const moved = (ps: readonly Primitive[]) => JSON.stringify(ps.flatMap(reach).map((p) => [+(p.x + l.tableAt.x).toFixed(9), +(p.y + l.tableAt.y).toFixed(9)]));
    expect(JSON.stringify(gearOf("deskSet", 1.2, 0.7).flatMap(reach).map((p) => [+p.x.toFixed(9), +p.y.toFixed(9)]))).toEqual(moved(gearOf("desk", l.tableSize.w, l.tableSize.d)));
  });

  it("the computer still draws through options, beside round chairs on the desk with chair", () => {
    expect(gearOf("desk", 1.2, 0.6)).toHaveLength(24);
    const both = furnitureSymbol("deskSet", "standard", 1.2, 0.7, { computer: true, roundChairs: true });
    const plain = furnitureSymbol("deskSet", "standard", 1.2, 0.7, { roundChairs: true });
    expect(lines(both)).toBe(lines(plain) + 24);
  });

  it("no gear when off: the symbol is the one without extras", () => {
    for (const kind of ["desk", "deskSet"]) {
      expect(furnitureSymbol(kind, "standard", 1.2, 0.7, OFF)).toEqual(furnitureSymbol(kind, "standard", 1.2, 0.7));
      expect(lines(furnitureSymbol(kind, "standard", 1.2, 0.7, ON))).toBe(lines(furnitureSymbol(kind, "standard", 1.2, 0.7)) + 24);
    }
  });

  it("only the desk kinds draw it: another kind's symbol ignores the flag", () => {
    for (const kind of ["chair", "extendingTable", "seatedDining"]) {
      const config = kind === "extendingTable" ? "closed" : "standard";
      expect(furnitureSymbol(kind, config, 1.2, 0.8, ON)).toEqual(furnitureSymbol(kind, config, 1.2, 0.8, OFF));
    }
  });

  it("tile has no gear: the palette draws the desk as objectLook without extras", () => {
    const tiles = PALETTE.flatMap((g) => g.cards).filter((k) => k.kind === "desk" || k.kind === "deskSet");
    expect(tiles).toHaveLength(2);
    for (const k of tiles) {
      const look = { fill: CANVAS_STYLE.objectFill, line: CANVAS_STYLE.objectLine, frontPx: 1, linePx: CANVAS_STYLE.objectLineWidth, detail: CANVAS_STYLE.objectDetail, detailPx: CANVAS_STYLE.objectDetailWidth };
      expect(lines(tileLook(k))).toBe(lines(objectLook(k.kind, k.config, k.w, k.d, look, OFF)));
      expect(lines(tileLook(k))).toBeLessThan(lines(objectLook(k.kind, k.config, k.w, k.d, look, ON)));
    }
  });

  it("the objects layer, the flip, the exports' picture and the plan look draw the gear of a desk with its computer on", () => {
    const [off, on] = [deskDoc(false), deskDoc(true)];
    const layer = (doc: Document) => lines(objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 50));
    expect(layer(on)).toBe(layer(off) + 24);
    const flip = (doc: Document) => lines(flipObjectsLayer(doc, floorView(doc, "s0").level, { from: "s0", to: "s0", t: 0.5 }));
    expect(flip(on)).toBe(flip(off) + 24);
    const exported = (doc: Document) => lines(planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 50, true).objects);
    expect(exported(on)).toBe(exported(off) + 24);
    const look = (doc: Document) => {
      const r = lookPicture(doc, null);
      if ("refused" in r) throw new Error(r.refused);
      return r.primitives;
    };
    expect(look(on).length).toBeGreaterThan(look(off).length); // the plan look draws the first layout's pieces (mcp.03)
  });
});
