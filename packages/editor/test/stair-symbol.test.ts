import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, reachesLevel, type Command, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { wallBetween, withCommands } from "./builders";

// A flight on the plan (stairs.02, step 04): treads, a walking line from a dot on the first step to an arrow on the
// last, always uphill; at the level it starts from, a break line where the cut crosses it with everything past it
// dashed and the label UP; at the level it reaches, the whole flight, solid, labelled DN.
//
// The landing scenarios' studio: ceiling 3.05, so the floor's cut is at 1.20; the loft (loft/k0, top 2.15) covers
// x 0.1–3.6, the platform (plat/k0, top 0.45) x 4.5–6.9, y 0.1–1.4. The storage stair stands with its back edge on the
// loft's right edge at (3.6, 1.95), turned 90°: its front (the bottom step) at x 5.59, 0.60 wide (y 1.65–2.25). It
// reaches the loft: 10 risers of 0.215, 9 treads of 0.2211; the first tread above 1.20 is the 6th (top 1.29), so the
// break lies 5 treads in, at x 5.59 − 1.1056 = 4.484.

const LOFT = "loft/k0";

function studio(...more: Command[]): Document {
  let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"), { type: "addWall", opId: "part", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 2.5 } } });
  const partition = wallBetween(doc, { x: 2, y: 0 }, { x: 2, y: 2.5 });
  doc = withCommands(
    doc,
    { type: "setWallTop", wallId: partition, top: 2.03 },
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 5.7, y: 0.75 }, w: 2.4, d: 1.3 },
  );
  return withCommands(doc, ...more);
}

const toLoft: Command = { type: "placeObject", opId: "s", state: "s0", object: { kind: "storageStair" }, at: { x: 3.6, y: 1.95 }, rotation: 90, deck: null, reaches: LOFT };
const loftLevel = (doc: Document): Level => {
  const level = levels(doc).find((l) => l.deckIds.includes(LOFT));
  if (!level) throw new Error("no loft level");
  return level;
};

const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
/** Tread lines of the stair at y 1.65–2.25: vertical, 0.60 long, strictly between its back (3.6) and front (5.59) edges. */
const treadLines = (ps: readonly Primitive[]) =>
  segments(ps).filter((s) => near(s.a.x, s.b.x) && near(Math.abs(s.a.y - s.b.y), 0.6) && s.a.x > 3.6 + 1e-6 && s.a.x < 5.59 - 1e-6);

describe("a storage stair at the floor", () => {
  const doc = studio(toLoft);
  const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);

  it("is labelled UP · 10 R (AC-01)", () => {
    expect(texts(layer)).toContain("UP · 10 R");
  });

  it("draws treads 1–5 solid and 6–8 dashed past the cut (AC-01)", () => {
    const lines = treadLines(layer);
    expect(lines).toHaveLength(8);
    expect(lines.filter((s) => s.dash === undefined).map((s) => s.a.x).sort()).toEqual(
      [5, 4, 3, 2, 1].map((k) => expect.closeTo(5.59 - k * (1.99 / 9), 6)),
    );
    expect(lines.filter((s) => s.dash !== undefined)).toHaveLength(3);
  });

  it("draws a break line across the flight at x 4.484, reaching past its sides", () => {
    const xb = 5.59 - 5 * (1.99 / 9);
    const slanted = segments(layer).filter((s) => !near(s.a.x, s.b.x) && !near(s.a.y, s.b.y) && Math.abs((s.a.x + s.b.x) / 2 - xb) < 0.12);
    expect(slanted.length).toBeGreaterThan(0);
    expect(Math.min(...slanted.flatMap((s) => [s.a.y, s.b.y]))).toBeLessThan(1.65);
    expect(Math.max(...slanted.flatMap((s) => [s.a.y, s.b.y]))).toBeGreaterThan(2.25);
  });

  it("writes the label along the flight, beside its lower long side, readable", () => {
    const label = layer.find((p): p is Extract<Primitive, { kind: "text" }> => p.kind === "text" && p.text.startsWith("UP"));
    expect(label).toMatchObject({ at: { x: expect.closeTo(4.595, 6), y: expect.closeTo(1.47, 6) }, rotation: expect.closeTo(0, 9) });
  });

  it("starts its walking line with a dot at the bottom step and ends it with an arrowhead at the back edge", () => {
    const dot = layer.find((p): p is Extract<Primitive, { kind: "disc" }> => p.kind === "disc");
    expect(dot?.center).toEqual({ x: expect.closeTo(5.5, 6), y: expect.closeTo(1.95, 6) });
    const arrow = layer.find((p): p is Extract<Primitive, { kind: "polygon" }> => p.kind === "polygon" && p.points.length === 3);
    const tip = arrow?.points.reduce((m: Point, q) => (q.x < m.x ? q : m));
    expect(tip).toEqual({ x: expect.closeTo(3.6, 6), y: expect.closeTo(1.95, 6) });
  });
});

describe("the same stair at the loft level (AC-02)", () => {
  const doc = studio(toLoft);
  const layer = objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80);

  it("is drawn whole, no dashes, labelled DN", () => {
    expect(texts(layer)).toContain("DN · 10 R");
    expect(treadLines(layer)).toHaveLength(8);
    expect(segments(layer).filter((s) => s.dash !== undefined)).toEqual([]);
  });

  it("keeps the arrow pointing uphill, its tip at the back edge", () => {
    const arrow = layer.find((p): p is Extract<Primitive, { kind: "polygon" }> => p.kind === "polygon" && p.points.length === 3);
    expect(arrow?.points.reduce((m: Point, q) => (q.x < m.x ? q : m))).toEqual({ x: expect.closeTo(3.6, 6), y: expect.closeTo(1.95, 6) });
  });
});

describe("a stair wholly below the cut", () => {
  it("to the +0.45 platform has no break line and no dashes (AC-08)", () => {
    const doc = studio({ type: "placeObject", opId: "s", state: "s0", object: { kind: "storageStair", size: { w: 0.6, d: 0.5 } }, at: { x: 5.7, y: 1.4 }, rotation: 180, deck: null, reaches: "plat/k0" });
    expect(doc.objects["s/o0"]).toMatchObject({ reaches: "plat/k0", h: { standard: 0.45 } });
    const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    expect(texts(layer)).toContain("UP · 2 R");
    expect(segments(layer).filter((s) => s.dash !== undefined)).toEqual([]);
  });

  it("Storage steps to the +0.45 platform: 3 risers, drawn as a solid stair, two tread lines across (steps.03, AC-01)", () => {
    const doc = studio({ type: "placeObject", opId: "s", state: "s0", object: { kind: "storageSteps" }, at: { x: 5.7, y: 1.4 }, rotation: 180, deck: null, reaches: "plat/k0" });
    expect(doc.objects["s/o0"]).toMatchObject({ reaches: "plat/k0", h: { standard: 0.45 }, d: { standard: 0.7 } });
    const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    expect(texts(layer)).toContain("UP · 3 R");
    // Its back edge at y 1.40, front at 2.10: nosings at y 1.75 only (2 treads, 1 inner nosing), 0.60 long across x.
    const across = segments(layer).filter((s) => near(s.a.y, s.b.y) && near(Math.abs(s.a.x - s.b.x), 0.6) && s.a.y > 1.4 + 1e-6 && s.a.y < 2.1 - 1e-6);
    expect(across.map((s) => Math.round(s.a.y * 1000) / 1000)).toEqual([1.75]);
  });
});

describe("reachesLevel (levels.47's one owner)", () => {
  it("is true for a stair at the level of the deck it reaches, false elsewhere and for furniture", () => {
    const doc = studio(toLoft, { type: "placeObject", opId: "b", state: "s0", object: { kind: "block" }, at: { x: 6, y: 2.4 }, deck: null });
    expect(reachesLevel(doc, "s/o0", loftLevel(doc))).toBe(true);
    expect(reachesLevel(doc, "s/o0", floorView(doc, "s0").level)).toBe(false);
    expect(reachesLevel(doc, "b/o0", loftLevel(doc))).toBe(false);
  });
});
