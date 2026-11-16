import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { rotateAbout } from "../src/geometry";
import type { Outline } from "../src/kinds";
import type { Document } from "../src/model";
import { placementFit } from "../src/queries/fit";
import { anchorAt, anchorAtMm, footprintQuad, placementRoom, roomOf } from "../src/queries/footprints";
import { freeFloor } from "../src/queries/free-floor";
import { zones } from "../src/queries/zones";
import { placedShape, shapeArea, shapeRing } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { docOf, place, rectDoc, rectLoop } from "./helpers";

// Fit by shape (shapefit.01): a shaped piece (round, quarter, corner) occupies its drawn ring in I10, I11,
// placementFit and free floor; a rectangle kind is unchanged.

/** The shoelace area: positive for a counter-clockwise ring. */
const signedArea = (ring: readonly Point[]): number =>
  ring.reduce((t, a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return t + (a.x * b.y - b.x * a.y) / 2;
  }, 0);

const SQRT1_2 = Math.SQRT1_2;
const CHAIR = 0.45;
const BOX = { w: { standard: CHAIR }, d: { standard: CHAIR } };

/**
 * A 4 × 4 room (inner faces at 0.1 and 3.9) with a 0.90 round table centred at (2, 2), and a chair-sized box turned to
 * face the table from its top-left diagonal, its front edge `gap` from the table's centre: 0.47 is 2 cm clear of the
 * circle (radius 0.45) and well inside the table's square (its corner is 0.636 out). A box, not a chair: a chair may
 * tuck under the table (the tuck rule, tuck-rule.test.ts), and these cases are about the table's shape.
 */
function tableAndChair(gap: number): Document {
  let doc = place(rectDoc(0, 0, 4, 4), { object: "table", kind: "roundTable", at: [2, 2.45] });
  const centre = chairCentre(-1, gap);
  const at = anchorAtMm(centre, CHAIR, 45);
  doc = place(doc, { object: "chairA", kind: "block", at: [at.x, at.y], rotation: 45, size: BOX });
  return doc;
}

/** The centre of a chair on the table's top diagonal (sx −1 left, +1 right), its front edge `gap` from (2, 2). */
function chairCentre(sx: number, gap: number): Point {
  const r = gap + CHAIR / 2;
  return { x: 2 + sx * r * SQRT1_2, y: 2 + r * SQRT1_2 };
}

/** A chair-sized box on the table's top-right diagonal facing it (turned −45°), as a placementFit candidate. */
function rightChair(gap: number) {
  return { surface: null, kind: "block", state: "s0", config: "standard", rotation: 315, w: CHAIR, d: CHAIR, at: anchorAt(chairCentre(1, gap), CHAIR, 315) };
}

describe("the shape ring in the world (shapefit.01)", () => {
  it("placedShape is the footprint quad for a rect kind", () => {
    const at = { x: 1.3, y: -2.7 };
    for (const kind of ["bed", "wardrobe"]) {
      for (const r of [0, 90, 37]) expect(placedShape(kind, at, 1.6, 2, r), `${kind} ${r}°`).toEqual(footprintQuad(at, 1.6, 2, r));
    }
    expect(placedShape("piano", at, 1, 1, 0)).toEqual(footprintQuad(at, 1, 1, 0)); // an unknown kind is a rectangle
  });

  it("placedShape is the kind's ring moved to `at` and turned about it", () => {
    const at = { x: 2, y: 2.45 };
    const ring = placedShape("roundTable", at, 0.9, 0.9, 30);
    const centre = rotateAbout({ x: 2, y: 2 }, at, 30); // the footprint's centre turns with it
    expect(ring).toHaveLength(32);
    for (const p of ring) expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(0.45, 9);
    const corner = placedShape("cornerBasin", { x: 0, y: 0 }, 0.6, 0.6, 90);
    // Back-left (−0.3, 0), front-left (−0.3, −0.6), back-right (0.3, 0), each turned 90° about the origin.
    const want = [[0, -0.3], [0.6, -0.3], [0, 0.3]];
    want.forEach(([x, y], i) => {
      expect(corner[i]?.x).toBeCloseTo(x ?? NaN, 12);
      expect(corner[i]?.y).toBeCloseTo(y ?? NaN, 12);
    });
  });

  it("shapeArea matches the ring's polygon area", () => {
    const outlines: readonly Outline[] = ["rect", "round", "quarter", "corner"];
    for (const o of outlines) {
      for (const [w, d] of [[0.9, 0.9], [1.2, 0.6], [0.1, 3], [2.5, 0.45]] as const) {
        expect(shapeArea(o, w, d), `${o} ${w}×${d}`).toBeCloseTo(signedArea(shapeRing(o, w, d)), 12);
      }
    }
    expect(shapeArea("rect", 1.2, 0.6)).toBeCloseTo(0.72, 12);
    expect(shapeArea("corner", 0.6, 0.6)).toBeCloseTo(0.18, 12);
    expect(shapeArea("round", 0.9, 0.9)).toBeCloseTo(0.63209, 5); // 4·w·d·sin(π/16)
  });
});

describe("fit by shape (shapefit.01)", () => {
  it("two chair-sized boxes at 45° fit in a round table's square but not on its circle (AC-03)", () => {
    const doc = tableAndChair(0.47);
    expect(validateDocument(doc).ok).toBe(true);
    expect(placementFit(doc, rightChair(0.47))).toEqual({ fits: true, reason: null });
    // 5 cm closer: the front edge is 3 cm inside the circle.
    expect(placementFit(doc, rightChair(0.42))).toEqual({ fits: false, reason: "object" });
  });

  it("a round table across a wall line fits while its circle clears the wall (AC-04)", () => {
    const doc = place(rectDoc(0, 0, 4, 4), { object: "bed", kind: "bed", at: [3, 3.9] }); // a state, far away
    // Turned 45°, the table's square points its corners along the axes: 0.636 m out, past both faces at x 0.1 and
    // y 0.1 by 0.18; the 32-gon has vertices along the axes too, 0.45 out, 1 cm clear of the faces.
    const table = (c: number) => ({ surface: null, kind: "roundTable", state: "s0", config: "standard", rotation: 45, at: anchorAt({ x: c, y: c }, 0.9, 45) });
    expect(placementFit(doc, table(0.56))).toEqual({ fits: true, reason: null });
    expect(placementFit(doc, table(0.54))).toEqual({ fits: false, reason: "wall" });
  });

  it("a block fits in a corner basin's empty half (AC-05)", () => {
    // The basin's back against the top face (y 3.9), its left side against the left face (x 0.1): its square is
    // x 0.1 … 0.7, y 3.3 … 3.9, its triangle the half above the line y = x + 3.2.
    const doc = place(rectDoc(0, 0, 4, 4), { object: "basin", kind: "cornerBasin", at: [0.4, 3.9], size: { w: { standard: 0.6 }, d: { standard: 0.6 } } });
    expect(validateDocument(doc).ok).toBe(true);
    const block = (x: number, y: number) => ({ surface: null, kind: "block", state: "s0", config: "standard", rotation: 0, w: 0.15, d: 0.15, at: { x, y: y + 0.075 } });
    expect(placementFit(doc, block(0.6, 3.4))).toEqual({ fits: true, reason: null }); // 18 cm below the long side
    expect(placementFit(doc, block(0.3, 3.6))).toEqual({ fits: false, reason: "object" });
  });

  it("free floor subtracts the shape's area (AC-06)", () => {
    const room = rectDoc(0, 0, 4, 4);
    const key = zones(room)[0]?.face.key ?? "";
    const table = place(room, { object: "table", kind: "roundTable", at: [2, 2.45] });
    expect(freeFloor(table, "s0").get(key)).toBeCloseTo(3.8 * 3.8 - shapeArea("round", 0.9, 0.9), 9);
    expect(freeFloor(table, "s0").get(key)).toBeCloseTo(14.44 - 0.63209, 5);
    const wardrobe = place(room, { object: "wardrobe", kind: "wardrobe", at: [2, 3.9] });
    expect(freeFloor(wardrobe, "s0").get(key)).toBeCloseTo(14.44 - 1.2 * 0.6, 9);
  });

  it("validateDocument accepts pieces whose rectangles overlap but shapes don't (AC-08)", () => {
    let doc = tableAndChair(0.47);
    const right = anchorAtMm(chairCentre(1, 0.47), CHAIR, 315);
    doc = place(doc, { object: "chairB", kind: "block", at: [right.x, right.y], rotation: 315, size: BOX });
    expect(validateDocument(doc).ok).toBe(true);
    const onCircle = validateDocument(tableAndChair(0.42));
    expect(onCircle.ok ? [] : onCircle.error.map((v) => [v.invariant, ...v.entities.map((e) => e.id)])).toEqual([["I11", "chairA/s0", "table/s0"]]);
  });

  it("roomOf uses the footprint centre it is given", () => {
    // Rooms A (x 0 … 3) and B (x 3 … 6); a corner basin in A's top-right corner, its back on the top face.
    const doc = docOf({
      joints: [...rectLoop("A", 0, 0, 3, 3).joints, ["Bj2", 6, 0], ["Bj3", 6, 3]],
      walls: [...rectLoop("A", 0, 0, 3, 3).walls, ["B1", "Aj2", "Bj2"], ["B2", "Bj2", "Bj3"], ["B3", "Bj3", "Aj3"]],
    });
    const placed = place(doc, { object: "basin", kind: "cornerBasin", at: [2.6, 2.9], rotation: 0 });
    const ring = placedShape("cornerBasin", { x: 2.6, y: 2.9 }, 0.45, 0.45, 0);
    const roomA = placementRoom(placed, "basin/s0");
    expect(roomA).not.toBeNull();
    expect(roomOf(placed, ring, { x: 2.6, y: 2.675 })).toBe(roomA);
    // A centre in room B: the innermost room holding it doesn't hold the ring.
    expect(roomOf(placed, ring, { x: 4.5, y: 1.5 })).toBeNull();
  });
});
