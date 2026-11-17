import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { guardPrimitives } from "../src/view/guards-layer";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { stairGhostPlan } from "../src/view/stair-plan";
import { withCommands } from "./builders";

// A spiral's rail and balustrade on the plan (AC-12): thin lines, a guard's. The 7 × 3 room's loft is at x 0.1–3.6; the 1.60
// spiral's back edge is on its edge at (3.6, 1.5), turned 90°: x 3.6–5.2, y 0.7–2.3, centre (4.4, 1.5), 9 treads of 30°. The
// frame's (x, y) is the world's (4.4 − y, 1.5 + x), so the landing is x 3.6–4.4, y 1.5–2.3, and a footprint angle a is the world
// angle a + 90°. The rails are 0.02 in from the landing's sides, and the balustrade 0.02 in from the treads' edge.

const LOFT = "loft/k0";
const C: Point = { x: 4.4, y: 1.5 };
const RAIL_R = 0.78;
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 3, "st"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.5 }, w: 3.5, d: 2.8 },
  ...more,
);
const place: Command = { type: "placeObject", opId: "s", state: "s0", object: { kind: "spiralStair" }, at: { x: 3.6, y: 1.5 }, rotation: 90, deck: null, reaches: LOFT };
const loftLevel = (doc: Document): Level => {
  const level = levels(doc).find((l) => l.deckIds.includes(LOFT));
  if (!level) throw new Error("no loft level");
  return level;
};
const atFloor = (doc: Document, style: PlanStyle = CANVAS_STYLE, selected = "") => objectsLayer(doc, floorView(doc, "s0"), style, selected, 80);
const atLoft = (doc: Document, style: PlanStyle = CANVAS_STYLE, selected = "") => objectsLayer(doc, viewAt("s0", loftLevel(doc)), style, selected, 80);
type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;
const isRailWidth = (w: Segment["width"], style: PlanStyle): boolean => "px" in w && w.px === style.guard.line;
/** The thin rail lines: not a tread's, a line's or the circle's. */
const railSegments = (ps: readonly Primitive[], style: PlanStyle = CANVAS_STYLE): Segment[] => ps.filter((p): p is Segment => p.kind === "segment" && isRailWidth(p.width, style) && p.dash === undefined);
const railArcs = (ps: readonly Primitive[]): Arc[] => ps.filter((p): p is Arc => p.kind === "arc" && Math.abs(p.radius - RAIL_R) < 1e-6);
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const key = (s: Segment): string => [s.a, s.b].map((p) => `${r3(p.x)},${r3(p.y)}`).sort().join(" ");
const deg = (rad: number): number => (rad * 180) / Math.PI;
const RIGHT = "3.62,2.28 4.38,2.28"; // the landing's right side, y 2.3, in by 0.02
const FRONT = "4.38,1.52 4.38,2.28"; // its front side, x 4.4, in by 0.02

describe("a spiral's rails on the plan", () => {
  it("at the level it reaches, the landing's rail is on its two open sides", () => {
    expect(railSegments(atLoft(room(place))).map(key).sort()).toEqual([FRONT, RIGHT].sort());
  });

  it("the way off stays open: nothing on the side the last tread meets, nor on the deck's edge", () => {
    for (const s of railSegments(atLoft(room(place)))) {
      expect(Math.abs(s.a.y - 1.5) < 1e-6 && Math.abs(s.b.y - 1.5) < 1e-6, "along the last tread's end").toBe(false);
      expect(Math.abs(s.a.x - 3.6) < 0.03 && Math.abs(s.b.x - 3.6) < 0.03, "on the deck's edge").toBe(false);
    }
  });

  it("the balustrade is one arc, just inside the treads' edge, the whole way round from the first tread to the last", () => {
    const [arc, ...rest] = railArcs(atLoft(room(place)));
    expect(rest).toEqual([]);
    expect(arc?.center.x).toBeCloseTo(C.x, 6);
    expect(arc?.center.y).toBeCloseTo(C.y, 6);
    expect(deg(arc?.from ?? 0)).toBeCloseTo(90 + 90, 6); // the last tread's end, at the back edge
    expect(deg(arc?.to ?? 0)).toBeCloseTo(360 + 90, 6); // the first tread's low end
  });

  it("is a thin line in the guards' ink and width", () => {
    const ps = atLoft(room(place));
    for (const s of railSegments(ps)) expect(s.color).toBe(CANVAS_STYLE.guard.ink);
    const [arc] = railArcs(ps);
    expect(arc?.color).toBe(CANVAS_STYLE.guard.ink);
    expect(arc?.width).toEqual({ px: CANVAS_STYLE.guard.line });
  });

  it("on paper, in paper's", () => {
    const ps = atLoft(room(place), PRESENTATION_STYLE);
    expect(railSegments(ps, PRESENTATION_STYLE).map(key).sort()).toEqual([FRONT, RIGHT].sort());
    for (const s of railSegments(ps, PRESENTATION_STYLE)) expect(s.color).toBe(PRESENTATION_STYLE.guard.ink);
    expect(railArcs(ps)[0]?.color).toBe(PRESENTATION_STYLE.guard.ink);
  });

  it("takes the selection's colour with its stair", () => {
    const doc = room(place);
    const selected = Object.keys(doc.placements)[0] ?? "";
    expect(railArcs(atLoft(doc, CANVAS_STYLE, selected))[0]?.color).not.toBe(CANVAS_STYLE.guard.ink);
    const lines = atLoft(doc, CANVAS_STYLE, selected).filter((p): p is Segment => p.kind === "segment").filter((s) => key(s) === RIGHT);
    expect(lines.map((l) => l.color)).not.toContain(CANVAS_STYLE.guard.ink);
    expect(lines).toHaveLength(1);
  });

  it("at the floor, the landing's rail is above the cut and doesn't draw", () => {
    expect(railSegments(atFloor(room(place))).filter((s) => key(s) === RIGHT || key(s) === FRONT)).toEqual([]);
  });

  it("at the floor, the balustrade stops at the break line, as the treads' solid lines do", () => {
    // Treads 6 to 9 rise above the 1.20 cut: the break is at tread 6's front, footprint 210°, world 300°.
    const [arc, ...rest] = railArcs(atFloor(room(place)));
    expect(rest).toEqual([]);
    expect(deg(arc?.from ?? 0)).toBeCloseTo(300, 6);
    expect(deg(arc?.to ?? 0)).toBeCloseTo(450, 6);
  });

  describe("the landing's rail and the deck's guard agree on the cut", () => {
    // The default ceiling, so the cut is 1.20: a deck with its top at it or above is its own level, and its guard doesn't draw at the
    // floor. Up to one riser above the cut the last tread is still below it, so the symbol is whole, and the rail has to ask for itself.
    const at = (top: number): Document => withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 3, "st"),
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.5 }, w: 3.5, d: 2.8, top },
      { type: "setDeck", deckId: LOFT, guard: "railing" },
      place,
    );
    const landingRails = (ps: readonly Primitive[]): Segment[] => railSegments(ps).filter((s) => s.a.x > 3.61 && s.b.x > 3.61);

    it.each([1.2, 1.21, 1.25, 1.3, 1.39, 1.4, 1.45, 1.6, 2.15])("at the floor, a deck with its top at %f shows neither", (top) => {
      const doc = at(top);
      expect(guardPrimitives(doc, floorView(doc, "s0").level, CANVAS_STYLE)).toEqual([]);
      expect(landingRails(atFloor(doc))).toEqual([]);
    });

    it.each([0.9, 1.1, 1.19])("at the floor, a deck with its top at %f shows both", (top) => {
      const doc = at(top);
      expect(guardPrimitives(doc, floorView(doc, "s0").level, CANVAS_STYLE)).not.toEqual([]);
      expect(landingRails(atFloor(doc)).map(key).sort()).toEqual([FRONT, RIGHT].sort());
    });

    it.each([1.2, 1.25, 1.39, 1.45, 2.15])("at its own level, a deck with its top at %f shows both", (top) => {
      const doc = at(top);
      expect(guardPrimitives(doc, loftLevel(doc), CANVAS_STYLE)).not.toEqual([]);
      expect(landingRails(atLoft(doc)).map(key).sort()).toEqual([FRONT, RIGHT].sort());
    });
  });

  it("a low spiral, whole at the floor, draws its rails at the floor", () => {
    const doc = withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 3, "st"),
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.1, y: 1.5 }, w: 2, d: 2 },
      { type: "placeObject", opId: "s", state: "s0", object: { kind: "spiralStair" }, at: { x: 2.1, y: 1.5 }, rotation: 90, deck: null, reaches: "p/k0" },
      { type: "setStair", objectId: "s/o0", handrail: "railing" }, // up to a platform it starts with none (guards.md)
    );
    const ps = atFloor(doc);
    expect(railSegments(ps).map(key).sort()).toEqual(["2.12,2.28 2.88,2.28", "2.88,1.52 2.88,2.28"]);
    expect(railArcs(ps)).toHaveLength(1);
  });

  it("a side against a wall has no line, and the other keeps its own", () => {
    const wall: Command = { type: "addWall", opId: "wr", from: { at: { x: 3.6, y: 2.4 } }, to: { at: { x: 5.6, y: 2.4 } } };
    const ps = atLoft(room(wall, place));
    expect(railSegments(ps).map(key)).toEqual([FRONT]);
    expect(railArcs(ps)).toHaveLength(1);
  });

  it.each([
    { name: "east", at: { x: 5, y: 3 }, rotation: 90, right: { x: 0, y: 1 }, back: { x: -1, y: 0 } },
    { name: "north", at: { x: 4, y: 4 }, rotation: 180, right: { x: -1, y: 0 }, back: { x: 0, y: -1 } },
    { name: "west", at: { x: 3, y: 3 }, rotation: 270, right: { x: 0, y: -1 }, back: { x: 1, y: 0 } },
    { name: "south", at: { x: 4, y: 2 }, rotation: 0, right: { x: 1, y: 0 }, back: { x: 0, y: 1 } },
  ])("turned to $rotation on the $name side, the lines turn with it", ({ at, rotation, right, back }) => {
    const doc = withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 9, 7, "c"), { type: "setCeiling", height: 3.4 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 4, y: 3 }, w: 2, d: 2 },
      { type: "placeStair", opId: "ps", state: "s0", kind: "spiralStair", surface: null, deck: "l/k0", at, shape: "straight" },
    );
    expect(Object.values(doc.placements)[0]?.rotation).toBe(rotation);
    const centre = { x: at.x - back.x * 0.8, y: at.y - back.y * 0.8 };
    const world = (x: number, y: number): Point => ({ x: centre.x + right.x * x + back.x * y, y: centre.y + right.y * x + back.y * y });
    const line = (a: Point, b: Point): string => [a, b].map((p) => `${r3(p.x)},${r3(p.y)}`).sort().join(" ");
    const level = levels(doc).find((l) => l.deckIds.includes("l/k0"));
    if (!level) throw new Error("no level");
    const got = railSegments(objectsLayer(doc, viewAt("s0", level), CANVAS_STYLE, "", 80)).map(key).sort();
    expect(got).toEqual([line(world(0.02, 0.02), world(0.78, 0.02)), line(world(0.78, 0.02), world(0.78, 0.78))].sort());
  });

  it("a spiral's ghost has none: nothing is decided yet", () => {
    const ghost = stairGhostPlan("spiralStair", 1.6, 1.6, 2.15, { x: 3.6, y: 1.5 }, 90, CANVAS_STYLE.objectLine, CANVAS_STYLE.objectFill, CANVAS_STYLE);
    expect(railArcs(ghost)).toEqual([]);
    expect(railSegments(ghost).filter((s) => key(s) === RIGHT || key(s) === FRONT)).toEqual([]);
  });
});
