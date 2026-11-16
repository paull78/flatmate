import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { footprintQuad, footprints, nearestObstacles, type ObstacleGap } from "../src/index";
import type { Document } from "../src/model";
import { BED_160x200, docOf, place, rectDoc } from "./helpers";

// nearestObstacles (direct.12, direct.18; AC-12): per side of a quad, the gap to the nearest wall face or footprint
// of the same layout state, in the outward direction. A 6 × 5 room has inner faces at x 0.1, 5.9 and y 0.1, 4.9.

const quadOf = (doc: Document, id: string): readonly Point[] => {
  const quad = footprints(doc).get(id);
  if (!quad) throw new Error(`no footprint for ${id}`);
  return quad;
};
const r = (p: Point | undefined) => p && { x: Math.round(p.x * 1e9) / 1e9 + 0, y: Math.round(p.y * 1e9) / 1e9 + 0 };
const desk = (doc: Document, x: number, y: number, rotation = 0): Document =>
  place(doc, { object: "desk", kind: "desk", at: [x, y], rotation });
const bed = (doc: Document, x: number, y: number, state = "s0"): Document =>
  place(doc, { object: "bed", kind: "bed", at: [x, y], state, size: BED_160x200 });
const measure = (doc: Document, id: string, exclude: string[] = [id]) =>
  nearestObstacles(doc, quadOf(doc, id), "s0", new Set(exclude));

/** Checks a side's gap (to 1e-9) and, when given, what it hit and its dimension line's end points. */
function expectGap(g: ObstacleGap | null, gap: number, table: string, id: string, from?: [number, number], to?: [number, number]): void {
  expect(g).not.toBeNull();
  expect(g?.gap).toBeCloseTo(gap, 9);
  expect(g?.obstacle).toEqual({ table, id });
  if (from) expect(r(g?.from)).toEqual({ x: from[0], y: from[1] });
  if (to) expect(r(g?.to)).toEqual({ x: to[0], y: to[1] });
}

describe("nearestObstacles (AC-12)", () => {
  it("a desk 0.5 m from the top wall measures every side to the room's wall faces", () => {
    const doc = desk(rectDoc(0, 0, 6, 5), 3, 4.4);
    const g = measure(doc, "desk/s0");
    expectGap(g.back, 0.5, "walls", "W3", [3, 4.4], [3, 4.9]);
    expectGap(g.front, 3.7, "walls", "W1");
    expectGap(g.left, 2.3, "walls", "W4");
    expectGap(g.right, 2.3, "walls", "W2");
  });

  it("a wall in excludeWalls is not an obstacle: the back side measures past the top wall to nothing", () => {
    const doc = desk(rectDoc(0, 0, 6, 5), 3, 4.4);
    const g = nearestObstacles(doc, quadOf(doc, "desk/s0"), "s0", new Set(["desk/s0"]), new Set(["W3"]));
    expect(g.back).toBeNull();
    expectGap(g.front, 3.7, "walls", "W1");
  });

  it("a desk against the top wall measures 0.8 m to a bed in front of it", () => {
    const doc = bed(desk(rectDoc(0, 0, 6, 5), 3, 4.9), 3, 3.5);
    const g = measure(doc, "desk/s0");
    expectGap(g.front, 0.8, "placements", "bed/s0", [3, 4.3], [3, 3.5]);
    expectGap(g.back, 0, "walls", "W3");
  });

  it("excluded pieces and pieces of other layouts are not obstacles", () => {
    const both = bed(desk(rectDoc(0, 0, 6, 5), 3, 4.9), 3, 3.5);
    expectGap(measure(both, "desk/s0", ["desk/s0", "bed/s0"]).front, 4.2, "walls", "W1");
    const night = bed(desk(rectDoc(0, 0, 6, 5), 3, 4.9), 3, 3.5, "night");
    expectGap(measure(night, "desk/s0").front, 4.2, "walls", "W1");
  });

  it("a bed covering part of the side is found, and the line sits on the covered part", () => {
    const doc = bed(desk(rectDoc(0, 0, 6, 5), 3, 4.9), 4.2, 3.5);
    expectGap(measure(doc, "desk/s0").front, 0.8, "placements", "bed/s0", [3.4, 4.3], [3.4, 3.5]);
  });

  it("a narrower piece in front: the line meets the middle of its face, not the corner beside it", () => {
    // The chair (x 2.975–3.425, y 3.05–3.5) faces the desk's front (y 4.3) with its back; the ends of its sides are
    // as near, and its right side comes first in its corners, but the line sits on the face, at the desk's middle.
    const doc = place(desk(rectDoc(0, 0, 6, 5), 3, 4.9), { object: "chair", kind: "chair", at: [3.2, 3.5] });
    expectGap(measure(doc, "desk/s0").front, 0.8, "placements", "chair/s0", [3, 4.3], [3, 3.5]);
  });

  it("two pieces at the same gap: the first in ID order wins", () => {
    // bed/s0's top covers x 3.4…3.6 of the desk's front; chair/s0's (x 2.575…3.025) is level with it at y 3.5.
    const doc = place(bed(desk(rectDoc(0, 0, 6, 5), 3, 4.9), 4.2, 3.5), { object: "chair", kind: "chair", at: [2.8, 3.5] });
    expectGap(measure(doc, "desk/s0").front, 0.8, "placements", "bed/s0", [3.4, 4.3], [3.4, 3.5]);
  });

  it("an obstacle wider than the side and overlapping it measures 0, not to its far face", () => {
    const overBed = bed(desk(rectDoc(0, 0, 6, 5), 3, 3.6), 3, 3.5);
    expectGap(measure(overBed, "desk/s0").front, 0, "placements", "bed/s0", [3, 3], [3, 3]);
    expectGap(measure(desk(rectDoc(0, 0, 6, 5), 3, 5.0), "desk/s0").back, 0, "walls", "W3");
  });

  it("a neighbour touching only the end of the side is not in front of it", () => {
    const doc = bed(desk(rectDoc(0, 0, 6, 5), 3, 4.9), 4.4, 3.5);
    expectGap(measure(doc, "desk/s0").front, 4.2, "walls", "W1");
  });

  it("a desk turned 90° measures along its own axes", () => {
    const doc = desk(rectDoc(0, 0, 6, 5), 0.1, 2, 90);
    const g = measure(doc, "desk/s0");
    expectGap(g.front, 5.2, "walls", "W2");
    expectGap(g.back, 0, "walls", "W4");
    expectGap(g.right, 2.3, "walls", "W3");
    expectGap(g.left, 1.3, "walls", "W1");
  });

  it("a chair turned 45° measures from its nearest corner", () => {
    const doc = place(rectDoc(0, 0, 6, 5), { object: "chair", kind: "chair", at: [3, 1], rotation: 45 });
    const front = measure(doc, "chair/s0").front;
    expect(front?.obstacle).toEqual({ table: "walls", id: "W1" });
    // (0.5227 − 0.1) / cos 45°: within 1 cm (AC-12); the 1 mm end trim can add up to 1 mm.
    expect(front?.gap).toBeCloseTo(0.598, 2);
    expect(front?.to.y).toBeCloseTo(0.1, 6);
  });

  it("a stub wall inside the room is an obstacle (Zone.floor would miss it)", () => {
    const room = docOf({
      joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 5], ["J4", 0, 5], ["T", 3, 2]],
      walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["R", "J2", "J3"], ["Top", "J3", "J4"], ["L", "J4", "J1"], ["Stub", "S", "T"]],
    });
    const low = measure(desk(room, 4.5, 1), "desk/s0");
    expectGap(low.left, 0.8, "walls", "Stub", [3.9, 0.7], [3.1, 0.7]);
    expectGap(low.front, 0.3, "walls", "B2");
    expectGap(low.right, 0.8, "walls", "R");
    expectGap(measure(desk(room, 4.5, 3), "desk/s0").left, 3.8, "walls", "L");
  });

  it("a group's bounding box measures along the screen axes, its own pieces excluded", () => {
    const chair = (doc: Document, object: string, x: number, y: number): Document =>
      place(doc, { object, kind: "chair", at: [x, y] });
    const doc = chair(chair(rectDoc(0, 0, 6, 5), "a", 1.225, 1.45), "b", 1.775, 2);
    const box: Point[] = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }];
    const g = nearestObstacles(doc, box, "s0", new Set(["a/s0", "b/s0"]));
    expectGap(g.front, 0.9, "walls", "W1", [1.5, 1], [1.5, 0.1]);
    expectGap(g.right, 3.9, "walls", "W2");
    expectGap(g.back, 2.9, "walls", "W3");
    expectGap(g.left, 0.9, "walls", "W4");
    expectGap(nearestObstacles(doc, box, "s0", new Set()).front, 0, "placements", "a/s0");
  });

  it("beside the room's outer wall, outside every room, all four sides are null", () => {
    // Outside the room but next to W2: without the room rule, its left side would measure to W2's outer face at x 6.1.
    const quad = footprintQuad({ x: 7, y: 2.5 }, 1, 1, 0);
    expect(nearestObstacles(rectDoc(0, 0, 6, 5), quad, "s0", new Set())).toEqual({ front: null, right: null, back: null, left: null });
  });
});
