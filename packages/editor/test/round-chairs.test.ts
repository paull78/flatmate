import { describe, expect, it } from "vitest";
import { SEATED_REACH, CHAIR_SIZE, MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, SEAT_BACK, defaultSides, emptyDocument, footprintQuad, inConvex, nullZones, rotateAbout, roundSetDiameter, type Document, type ObjectOptions } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout, chairRing, roundChairRing, type AggregateLayout } from "../src/view/aggregate";
import { fillRings, shapedFills } from "../src/view/shapes";
import { appearanceOf } from "../src/view3d/parts";
import { chair, roundChair } from "../src/view3d/parts/sit-and-eat";
import { furnitureSymbol, objectLook, placeSymbol } from "../src/view/furniture";
import { objectsLayer } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { CANVAS_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { chairSymbol, roundChairBack, roundChairSymbol } from "../src/view/symbols/sit-and-eat";
import { reach } from "./object-look-helpers";

// Round chairs (AC-05, library.07, .09): with the set's "Round chairs" option its chairs draw a rounded seat and a
// curved back band in their back 0.10 m, inside a rounded ring that is both the chair's fill and its outline; cards
// keep the square chair. A loose chair takes the option too (seated.05).

const SETS = ["seatedDining", "seatedRound", "deskSet"] as const;
const ROUND: ObjectOptions = { roundChairs: true };
const AT: Point = { x: 3, y: 3.5 };
const TURN = 30;
const SIZES = [MIN_OBJECT_SIZE, 0.3, 0.45, 0.5, 0.9, 1.2, 3, MAX_OBJECT_SIZE];

const sizesOf = (kind: string): [number, number][] =>
  kind === "seatedRound" ? [0.9, 1.2, 1.5].map((t) => [roundSetDiameter(t, SEATED_REACH), roundSetDiameter(t, SEATED_REACH)]) : kind === "seatedDining" ? [[1.2, 2], [2.6, 2.1], [3.8, 2.1]] : [[1.2, 0.7]];

function layoutOf(kind: string, w: number, d: number): AggregateLayout {
  const layout = aggregateLayout(kind, w, d);
  if (!layout) throw new Error(`${kind} is not an aggregate`);
  return layout;
}

/** One set placed at AT, turned by TURN, with these options. */
function docOf(kind: string, w: number, d: number, options?: ObjectOptions): Document {
  const doc = emptyDocument();
  doc.objects["o"] = { id: "o", kind, name: kind, w: { standard: w }, d: { standard: d }, h: { standard: 0.9 }, z: { standard: 0 }, ...(options ? { options } : {}) };
  doc.placements["p"] = { id: "p", object: "o", state: "s0", at: AT, rotation: TURN, config: "standard", sides: defaultSides(kind) ?? { front: false, back: false, left: false, right: false }, zones: nullZones(), deck: null };
  return doc;
}

const layerOf = (doc: Document, style: PlanStyle): readonly Primitive[] => objectsLayer(doc, floorView(doc, "s0"), style, "", 80);
const linesOf = (ps: readonly Primitive[]): Primitive[] => ps.filter((p) => p.kind === "segment" || p.kind === "arc");
const fillsOf = (ps: readonly Primitive[]): Point[][] => ps.flatMap((p) => (p.kind === "polygon" ? [[...p.points]] : []));

/** A point of the set's footprint space in the world: the set at AT, turned by TURN. */
const world = (p: Point): Point => rotateAbout({ x: p.x + AT.x, y: p.y + AT.y }, AT, TURN);
/** A chair's own symbol at one of the set's chair poses, in the world. */
const placedSet = (symbol: readonly Primitive[], c: { at: Point; rotation: number }): Primitive[] => placeSymbol(symbol, world(c.at), TURN + c.rotation);

const close = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const angle = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
function same(p: Primitive, q: Primitive): boolean {
  if (p.kind === "segment" && q.kind === "segment") return (close(p.a, q.a) && close(p.b, q.b)) || (close(p.a, q.b) && close(p.b, q.a));
  if (p.kind === "arc" && q.kind === "arc") return close(p.center, q.center) && Math.abs(p.radius - q.radius) < 1e-6 && Math.abs(angle(p.from) - angle(q.from)) < 1e-6 && Math.abs(angle(p.to) - angle(q.to)) < 1e-6;
  return false;
}
const drawn = (lines: readonly Primitive[], wanted: readonly Primitive[]): boolean => wanted.length > 0 && wanted.every((w) => lines.some((l) => same(l, w)));

/** Points along a line: a segment's ends, an arc sampled from `from` to `to` (not its whole circle). */
function along(p: Primitive): Point[] {
  if (p.kind === "segment") return [p.a, p.b];
  if (p.kind !== "arc") return reach(p);
  return Array.from({ length: 33 }, (_, i) => {
    const t = p.from + ((p.to - p.from) * i) / 32;
    return { x: p.center.x + p.radius * Math.cos(t), y: p.center.y + p.radius * Math.sin(t) };
  });
}

describe("the round chair's symbol (AC-05, library.09)", () => {
  it("round chair symbol stays inside its footprint at 0.10–10 m (an arc's whole circle too)", () => {
    for (const w of SIZES) {
      for (const d of SIZES) {
        const symbol = roundChairSymbol(w, d);
        expect(symbol.length, `${w}×${d}`).toBeGreaterThan(0);
        for (const q of symbol.flatMap(reach)) expect(q.x >= -w / 2 - 1e-9 && q.x <= w / 2 + 1e-9 && q.y >= -d - 1e-9 && q.y <= 1e-9, `${w}×${d} (${q.x}, ${q.y})`).toBe(true);
      }
    }
  });

  it("its back band lies in the back SEAT_BACK, curved (arcs), at 0.10–10 m", () => {
    for (const w of SIZES) {
      for (const d of SIZES) {
        const back = roundChairBack(w, d);
        expect(back.filter((p) => p.kind === "arc").length, `${w}×${d}`).toBe(2);
        for (const q of back.flatMap(along)) expect(q.y >= -SEAT_BACK - 1e-9 && q.y <= 1e-9, `${w}×${d} (${q.x}, ${q.y})`).toBe(true);
      }
    }
  });

  it("is not the square chair: a curved band and a seat rounder than the square chair's", () => {
    const { w, d } = CHAIR_SIZE;
    expect(roundChairSymbol(w, d)).not.toEqual(chairSymbol(w, d));
    expect(roundChairSymbol(w, d)).toEqual(expect.arrayContaining(roundChairBack(w, d)));
  });
});

describe("a set with round chairs (AC-05)", () => {
  it.each(SETS.flatMap((kind) => sizesOf(kind).flatMap(([w, d]) => [CANVAS_STYLE, PRESENTATION_STYLE].map((style) => [kind, w, d, style] as const))))(
    "%s %f × %f: roundChairs draws round chairs; without, square",
    (kind, w, d, style) => {
      const chairs = layoutOf(kind, w, d).chairs;
      expect(chairs.length).toBeGreaterThan(0);
      const roundLines = linesOf(layerOf(docOf(kind, w, d, ROUND), style));
      const squareLines = linesOf(layerOf(docOf(kind, w, d), style));
      const { w: cw, d: cd } = CHAIR_SIZE;
      // The back band never lies under the table (it is the part that never tucks), so it is drawn whole at each pose.
      for (const c of chairs) {
        expect(drawn(roundLines, placedSet(roundChairBack(cw, cd), c)), "round band").toBe(true);
        expect(drawn(squareLines, placedSet(roundChairBack(cw, cd), c)), "no round band without the option").toBe(false);
        // The square chair's backrest band, its first four lines.
        expect(drawn(squareLines, placedSet(chairSymbol(cw, cd).slice(0, 4), c)), "square band").toBe(true);
        expect(drawn(roundLines, placedSet(chairSymbol(cw, cd).slice(0, 4), c)), "no square band with the option").toBe(false);
      }
    },
  );

  it("each chair's fill is a rounded ring inside its square, and the same ring is its outline outside the table", () => {
    for (const kind of SETS) {
      for (const [w, d] of sizesOf(kind)) {
        const l = layoutOf(kind, w, d);
        const look = objectLook(kind, "standard", w, d, { fill: "#eeeeee", line: "#111111", frontPx: 2 }, ROUND);
        const fills = fillsOf(look);
        expect(fills, kind).toHaveLength(l.chairs.length + 1);
        expect(fills.at(-1), "the table last").toEqual(l.table);
        const lines = linesOf(look);
        l.chairs.forEach((c, i) => {
          const ring = fills[i] ?? [];
          const square = footprintQuad(c.at, CHAIR_SIZE.w, CHAIR_SIZE.d, c.rotation);
          expect(ring.length, `${kind} chair ${i}`).toBeGreaterThan(4);
          expect(ring.every((p) => inConvex(p, square, 1e-9)), "inside the square").toBe(true);
          expect(square.some((corner) => ring.some((p) => close(p, corner))), "its corners rounded off").toBe(false);
          // Every edge of the ring wholly outside the table is drawn in the line colour.
          const edges = ring.map((a, k): Primitive => ({ kind: "segment", a, b: ring[(k + 1) % ring.length] ?? a, width: { px: 1 }, color: "#111111", cap: "butt" }));
          const outside = edges.filter((e) => e.kind === "segment" && !inConvex(e.a, l.table, 1e-9) && !inConvex(e.b, l.table, 1e-9));
          expect(outside.length).toBeGreaterThan(0);
          expect(drawn(lines.filter((p) => p.color === "#111111"), outside), `${kind} chair ${i} outline`).toBe(true);
        });
      }
    }
  });

  it("the set's symbol stays inside its footprint at 0.10–10 m with round chairs", () => {
    for (const kind of SETS) {
      for (const w of SIZES) {
        for (const d of SIZES) {
          for (const q of furnitureSymbol(kind, "standard", w, d, ROUND).flatMap(reach)) expect(q.x >= -w / 2 - 1e-6 && q.x <= w / 2 + 1e-6 && q.y >= -d - 1e-6 && q.y <= 1e-6, `${kind} ${w}×${d} (${q.x}, ${q.y})`).toBe(true);
        }
      }
    }
  });

  it("the tile shows square chairs", () => {
    const cards = PALETTE.flatMap((g) => g.cards).filter((k) => aggregateLayout(k.kind, k.w, k.d) !== null);
    expect(cards.length).toBeGreaterThan(0);
    for (const k of cards) {
      const tile = tileLook(k);
      const l = layoutOf(k.kind, k.w, k.d);
      expect(fillsOf(tile).slice(0, -1), k.kind).toEqual(l.chairs.map((c) => footprintQuad(c.at, CHAIR_SIZE.w, CHAIR_SIZE.d, c.rotation)));
      const band = (c: { at: Point; rotation: number }) => placeSymbol(roundChairBack(CHAIR_SIZE.w, CHAIR_SIZE.d), c.at, c.rotation);
      expect(l.chairs.some((c) => drawn(linesOf(tile), band(c))), k.kind).toBe(false);
    }
  });
});

// A loose chair takes the option too (seated.05), so a set's round chairs stay round when it breaks apart.
describe("a loose round chair", () => {
  const { w, d } = CHAIR_SIZE;
  const polygons = (prims: readonly Primitive[]) => prims.filter((p) => p.kind === "polygon");

  it("draws the round symbol, and the square one without the option", () => {
    expect(furnitureSymbol("chair", "standard", w, d, ROUND)).toEqual(expect.arrayContaining(roundChairSymbol(w, d)));
    expect(furnitureSymbol("chair", "standard", w, d)).toEqual(expect.arrayContaining(chairSymbol(w, d)));
    expect(furnitureSymbol("chair", "standard", w, d)).not.toEqual(furnitureSymbol("chair", "standard", w, d, ROUND));
  });

  it("fills and outlines the ring a set's round chair has, so nothing shows at the square corners", () => {
    const ring = chairRing({ at: { x: 0, y: 0 }, rotation: 0 }, true);
    expect(roundChairRing(w, d)).toEqual(ring);
    expect(fillRings("chair", w, d, ROUND)).toEqual([ring]);
    expect(fillRings("chair", w, d)).toHaveLength(1);
    expect(fillRings("chair", w, d)[0]).not.toEqual(ring);
    const look = objectLook("chair", "standard", w, d, { line: "#000", fill: "#eee", frontPx: 3 }, ROUND);
    expect(polygons(look)).toHaveLength(1);
    // The outline's corner is the ring's, so no line reaches the square's front corner.
    const ends = look.flatMap((p) => (p.kind === "segment" ? [p.a, p.b] : []));
    expect(ends.filter((q) => Math.abs(q.x) > w / 2 - 1e-6 && q.y < -d + 1e-6)).toEqual([]);
  });

  it("has no heavier front line, which would cut across its round corners; a square chair keeps its own", () => {
    const heavy = (options: ObjectOptions) => objectLook("chair", "standard", w, d, { line: "#000", frontPx: 3 }, options).filter((p) => p.kind === "segment" && "px" in p.width && p.width.px === 3);
    expect(heavy(ROUND)).toEqual([]);
    expect(heavy({}).length).toBeGreaterThan(0);
  });

  it("a resized one keeps its ring inside its footprint, down to the smallest size", () => {
    for (const [cw, cd] of [[MIN_OBJECT_SIZE, MIN_OBJECT_SIZE], [0.3, 0.6], [0.6, 0.3], [1, 1]] as const) {
      for (const p of roundChairRing(cw, cd)) {
        expect(Math.abs(p.x), `${cw} × ${cd}`).toBeLessThanOrEqual(cw / 2 + 1e-9);
        expect(p.y, `${cw} × ${cd}`).toBeLessThanOrEqual(1e-9);
        expect(p.y, `${cw} × ${cd}`).toBeGreaterThanOrEqual(-cd - 1e-9);
      }
    }
  });

  it("selected at an angle, its placed fill is the turned ring", () => {
    const fills = shapedFills("chair", w, d, AT, 90, [], ROUND);
    expect(fills).toHaveLength(1);
    const first = roundChairRing(w, d)[0] ?? { x: 0, y: 0 };
    const placed = rotateAbout({ x: first.x + AT.x, y: first.y + AT.y }, AT, 90);
    expect(fills[0]?.[0]?.x).toBeCloseTo(placed.x, 9);
    expect(fills[0]?.[0]?.y).toBeCloseTo(placed.y, 9);
  });

  it("in 3D builds the round chair's parts, and the square chair's without it", () => {
    expect(appearanceOf("chair")("standard", w, d, 0.9, ROUND)).toEqual(roundChair(w, d, 0.9));
    expect(appearanceOf("chair")("standard", w, d, 0.9)).toEqual(chair(w, d, 0.9));
    expect(appearanceOf("chair")("standard", w, d, 0.9)).not.toEqual(roundChair(w, d, 0.9));
  });
});
