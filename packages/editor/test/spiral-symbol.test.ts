import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { withCommands } from "./builders";

// A spiral on the plan (stairs.02, .21, AC-09): radial treads, the column, an arc walking line from a dot on the first
// tread to an arrow at the back edge; at the floor a radial break at the first tread above the cut and the treads past it
// dashed; at the loft whole, DN.
//
// A 7 × 2.5 room under a 3.05 ceiling (the floor's cut at 1.20) with a loft (top 2.15) over x 0.1–3.6. The 1.60 spiral
// stands with its back edge on the loft's right edge at (3.6, 1.25), turned 90°: x 3.6–5.2, y 0.45–2.05, centre
// (4.4, 1.25). 10 risers of 0.215, 9 treads of 30°. Turned 90°, a footprint angle a is the world angle a + 90°: tread k
// covers the world angles [180 + (9 − k) × 30, 180 + (10 − k) × 30], the first [60, 90], the last [180, 210], ending
// toward the loft. Treads 6 to 9 rise above 1.20 (6 × 0.215 = 1.29): the break lies at tread 6's front, world 300°.

const C: Point = { x: 4.4, y: 1.25 };
const R = 0.8;
const RC = 0.065;
const RM = (R + RC) / 2;

function studio(...more: Command[]): Document {
  return withCommands(
    emptyDocument(),
    ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    { type: "placeObject", opId: "s", state: "s0", object: { kind: "spiralStair" }, at: { x: 3.6, y: 1.25 }, rotation: 90, deck: null, reaches: "loft/k0" },
    ...more,
  );
}
const loftLevel = (doc: Document): Level => {
  const level = levels(doc).find((l) => l.deckIds.includes("loft/k0"));
  if (!level) throw new Error("no loft level");
  return level;
};
const atFloor = (doc: Document) => objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
const atLoft = (doc: Document) => objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80);

const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const arcs = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const dist = (p: Point, q: Point = C): number => Math.hypot(p.x - q.x, p.y - q.y);
/** A world angle in degrees, 0 to 360. */
const angleOf = (p: Point, q: Point = C): number => ((Math.atan2(p.y - q.y, p.x - q.x) * 180) / Math.PI + 360) % 360;
const deg = (rad: number): number => ((rad * 180) / Math.PI + 3600) % 360;
/** Radial tread lines: from the column to the circle, by world angle. */
const radials = (ps: readonly Primitive[], c: Point = C) =>
  segments(ps).filter((s) => {
    const [ra, rb] = [dist(s.a, c), dist(s.b, c)];
    return near(Math.min(ra, rb), RC) && near(Math.max(ra, rb), R) && near(angleOf(s.a, c), angleOf(s.b, c), 1e-6);
  });
/** The tread arcs on the circle (not the whole thin circle), as [from, to] world degrees. */
const outerArcs = (ps: readonly Primitive[]) => arcs(ps).filter((a) => near(dist(a.center), 0) && near(a.radius, R) && a.to - a.from < Math.PI);
/** Whether one arc at the circle spans tread k (world [lo, lo + 30]) whole. */
const wholeTread = (ps: readonly Primitive[], k: number): boolean => {
  const lo = (180 + (9 - k) * 30) % 360;
  return outerArcs(ps).some((a) => near(deg(a.from), lo, 1e-6) && near(a.to - a.from, Math.PI / 6, 1e-9));
};

describe("a spiral at the floor", () => {
  const layer = atFloor(studio());

  it("is labelled UP · 10 R", () => {
    expect(texts(layer)).toContain("UP · 10 R");
  });

  it("draws a radial line at each tread's front and at the last tread's end: up to the break solid, past it dashed", () => {
    const outer = (a: Point, b: Point): Point => (dist(a) > dist(b) ? a : b);
    const lines = radials(layer).map((s) => [Math.round(angleOf(outer(s.a, s.b))) % 360, s.dash !== undefined]);
    // Tread k's front at world 180 + (10 − k) × 30: k = 1 at 90, …, k = 6 at 300 (the break); k = 7 to 9 and the end (180) past it.
    expect(lines.sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [0, false], [30, false], [60, false], [90, false], [180, true], [210, true], [240, true], [270, true], [300, false], [330, false],
    ]);
  });

  it("draws treads 1 to 5 whole on the circle and treads 6 to 9, above the cut, as dashes", () => {
    for (const k of [1, 2, 3, 4, 5]) expect(wholeTread(layer, k), `tread ${k}`).toBe(true);
    for (const k of [6, 7, 8, 9]) {
      expect(wholeTread(layer, k), `tread ${k}`).toBe(false);
      const lo = (180 + (9 - k) * 30) % 360;
      const dashes = outerArcs(layer).filter((a) => deg(a.from) >= lo - 1e-6 && deg(a.to) <= lo + 30 + 1e-6);
      expect(dashes.length, `tread ${k}`).toBeGreaterThan(3);
    }
  });

  it("breaks with a radial zigzag at tread 6's front (world 300°), reaching past the circle", () => {
    const along = (p: Point) => (p.x - C.x) * Math.cos((300 * Math.PI) / 180) + (p.y - C.y) * Math.sin((300 * Math.PI) / 180);
    const off = (p: Point) => -(p.x - C.x) * Math.sin((300 * Math.PI) / 180) + (p.y - C.y) * Math.cos((300 * Math.PI) / 180);
    const zig = segments(layer).filter((s) => s.dash === undefined && [s.a, s.b].every((p) => along(p) > 0 && Math.abs(off(p)) < 0.1) && !near(off(s.a), off(s.b), 1e-6));
    expect(zig.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...segments(layer).filter((s) => [s.a, s.b].every((p) => Math.abs(off(p)) < 0.1 && along(p) > 0)).flatMap((s) => [along(s.a), along(s.b)]))).toBeGreaterThan(R);
  });

  it("draws the column as a disc, and the walking line from a dot on the first tread to an arrow at the back edge", () => {
    expect(layer.some((p) => p.kind === "disc" && near(dist(p.center), 0) && "m" in p.radius && near(p.radius.m, RC))).toBe(true);
    const dot = layer.find((p) => p.kind === "disc" && "px" in p.radius);
    expect(dot?.kind === "disc" ? [dist(dot.center), angleOf(dot.center)] : null).toEqual([expect.closeTo(RM, 6), expect.closeTo(75, 6)]); // the first tread's middle
    const walking = arcs(layer).filter((a) => near(dist(a.center), 0) && near(a.radius, RM));
    expect(walking.length).toBeGreaterThan(1); // solid to the break, dashed past it
    expect(Math.max(...walking.map((a) => a.to - a.from))).toBeGreaterThan(Math.PI / 2);
    // The arrowhead's tip on the walking line at the back edge's direction (world 180°), pointing clockwise (toward +y).
    const arrow = layer.find((p) => p.kind === "polygon" && p.points.length === 3);
    expect(arrow?.kind === "polygon" ? arrow.points[0] : null).toEqual({ x: expect.closeTo(C.x - RM, 6), y: expect.closeTo(C.y, 6) });
    const base = arrow?.kind === "polygon" ? arrow.points.slice(1) : [];
    for (const p of base) expect(p.y).toBeLessThan(C.y);
  });
});

describe("a spiral at the loft", () => {
  const layer = atLoft(studio());

  it("is whole, solid and labelled DN · 10 R", () => {
    expect(texts(layer)).toContain("DN · 10 R");
    expect(segments(layer).filter((s) => s.dash !== undefined)).toEqual([]);
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(wholeTread(layer, k), `tread ${k}`).toBe(true);
    expect(radials(layer)).toHaveLength(10);
  });
});

describe("a spiral's rotation", () => {
  it("turns its start with it: unturned, free in the room, its first tread lies at footprint angles 330–360°, its dot at 345°", () => {
    // Turned 0, back edge's middle at (6, 2.4): x 5.2–6.8, y 0.8–2.4, centre (6, 1.6).
    const doc = studio({ type: "placeObject", opId: "f", state: "s0", object: { kind: "spiralStair" }, at: { x: 6, y: 2.4 }, rotation: 0, deck: null });
    const c = { x: 6, y: 1.6 };
    const dots = atFloor(doc).filter((p) => p.kind === "disc" && "px" in p.radius && near(dist(p.center, c), RM, 1e-6));
    expect(dots.map((p) => (p.kind === "disc" ? angleOf(p.center, c) : null))).toEqual([expect.closeTo(345, 6)]);
    // Its walking line ends at 90°, toward its back edge.
    const arrow = atFloor(doc).find((p) => p.kind === "polygon" && p.points.length === 3 && near(dist(p.points[0] ?? c, c), RM, 1e-6));
    expect(arrow?.kind === "polygon" ? arrow.points[0] : null).toEqual({ x: expect.closeTo(6, 6), y: expect.closeTo(1.6 + RM, 6) });
  });
});

// The top landing (edge-catch.06, .11, AC-05): a square from the centre to the box's right and back sides. Turned 90°,
// footprint right (0°) is world +y and back (90°) world −x, so the square is x 3.6–4.4, y 1.25–2.05, its back side on
// the loft's edge. Dashed at the floor (the stair's top is above the cut), solid at the loft.
describe("the spiral's landing (AC-05)", () => {
  const corners: Point[] = [{ x: 4.4, y: 1.25 }, { x: 4.4, y: 2.05 }, { x: 3.6, y: 2.05 }, { x: 3.6, y: 1.25 }];
  const onCorner = (p: Point): boolean => corners.some((c) => near(p.x, c.x) && near(p.y, c.y));
  /** The square's four sides among the layer's segments, each once, with whether it is dashed. */
  const sides = (ps: readonly Primitive[]) =>
    corners.map((a, i) => {
      const b = corners[(i + 1) % 4] ?? a;
      const found = segments(ps).filter((s) => onCorner(s.a) && onCorner(s.b) && ((dist(s.a, a) < 1e-6 && dist(s.b, b) < 1e-6) || (dist(s.a, b) < 1e-6 && dist(s.b, a) < 1e-6)));
      return found.map((s) => s.dash !== undefined);
    });

  it("at the floor it is the square's outline, dashed", () => {
    expect(sides(atFloor(studio()))).toEqual([[true], [true], [true], [true]]);
  });

  it("at the loft it is the same square, solid", () => {
    expect(sides(atLoft(studio()))).toEqual([[false], [false], [false], [false]]);
  });

  // The walk-through after the wrap (edge-catch.24): at the loft the landing is filled like the treads, not see-through.
  const fills = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" && p.points.length === 4 && p.points.every(onCorner) ? [p] : []));
  it("at the loft it is filled with the treads' fill, drawn before its outline; at the floor it is not filled", () => {
    const loft = atLoft(studio());
    const treadFill = loft.find((p) => p.kind === "polygon" && p.points.length > 4)?.color;
    expect(fills(loft).map((p) => p.color)).toEqual([treadFill]);
    const fillAt = loft.findIndex((p) => fills([p]).length === 1);
    const firstSide = loft.findIndex((p) => p.kind === "segment" && onCorner(p.a) && onCorner(p.b));
    expect(fillAt).toBeLessThan(firstSide);
    expect(fills(atFloor(studio()))).toEqual([]);
  });
});
