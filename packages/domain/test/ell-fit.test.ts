import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Document } from "../src/model";
import { fitViolations, placementFit } from "../src/queries/fit";
import { freeFloor } from "../src/queries/free-floor";
import { validateDocument } from "../src/validate";
import { place, rectDoc, wallRow } from "./helpers";

// Fit by parts (catalog.16, AC-01): an `L` piece is tested as its two convex arms, so another piece may stand in the
// empty quarter between them, one on an arm is refused once, and free floor takes the arms' area with each tuck's
// overlap added back once.

/**
 * A 4 × 3 room (inner faces at 0.1 and 3.9 / 2.9) with a 1.60 × 1.20 corner desk, arms 0.60, in its top-left corner:
 * x 0.1–1.7, y 1.7–2.9. The back arm is x 0.1–1.7, y 2.3–2.9; the left arm x 0.1–0.7, y 1.7–2.3; the empty quarter
 * x 0.7–1.7, y 1.7–2.3. With `plain`, a plain desk of the same size instead.
 */
function withDesk(plain = false, room: Document = rectDoc(0, 0, 4, 3)): Document {
  const desk = plain ? { kind: "desk", size: { w: { standard: 1.6 }, d: { standard: 1.2 } } } : { kind: "cornerDesk" };
  return place(room, { object: "desk", at: [0.9, 2.9], ...desk });
}

/** A chair facing −y (rotation 0) whose 0.45 footprint spans x from `x` and y up to `top`: its back strip is at the top. */
const chairAt = (x: number, top: number): Point => ({ x: x + 0.225, y: top });
const IN_QUARTER = chairAt(1, 2.2); // x 1.0–1.45, y 1.75–2.2
const ON_BACK_ARM = chairAt(1, 2.35); // y 1.9–2.35: its back strip 0.05 onto the back arm
const ON_BOTH_ARMS = chairAt(0.65, 2.35); // x 0.65–1.1, y 1.9–2.35: its back strip 0.05 onto each arm

const chairFit = (doc: Document, at: Point) => placementFit(doc, { surface: null, kind: "chair", state: "s0", at, rotation: 0, config: "standard" });
const placeChair = (doc: Document, at: Point) => execute(doc, { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at, rotation: 0 });
const roomFree = (doc: Document): number => [...freeFloor(doc, "s0").values()][0] ?? Number.NaN;

describe("an L piece fits by its arms (AC-01)", () => {
  it("a chair wholly in the empty quarter fits, and placeObject accepts it", () => {
    const doc = withDesk();
    expect(chairFit(doc, IN_QUARTER)).toEqual({ fits: true, reason: null });
    expect(placeChair(doc, IN_QUARTER).ok).toBe(true);
  });

  it("the fixture changes the answer: the same chair is refused by a plain 1.60 × 1.20 desk", () => {
    expect(chairFit(withDesk(true), IN_QUARTER)).toEqual({ fits: false, reason: "object" });
    expect(placeChair(withDesk(true), IN_QUARTER).ok).toBe(false);
  });

  it("the same chair moved 0.05 m onto the back arm is refused with one I11 naming the desk", () => {
    const placed = placeChair(withDesk(), IN_QUARTER);
    if (!placed.ok) throw new Error("not placed");
    const doc = placed.value.doc;
    const chair = Object.values(doc.placements).find((p) => p.object !== "desk")?.id ?? "";
    expect(chairFit(withDesk(), ON_BACK_ARM)).toEqual({ fits: false, reason: "object" });
    const moved = execute(doc, { type: "movePlacement", placementId: chair, at: ON_BACK_ARM, rotation: 0 });
    expect(moved).toMatchObject({ ok: false, error: { kind: "invalid", message: "Chair (0.00–0.90) and Corner desk (0.00–0.75) overlap in Layout" } });
    if (moved.ok) return;
    expect(moved.error.violations).toEqual([
      { invariant: "I11", message: "Chair (0.00–0.90) and Corner desk (0.00–0.75) overlap in Layout", entities: [{ table: "placements", id: chair }, { table: "placements", id: "desk/s0" }] },
    ]);
  });

  it("a chair over both arms at the inner corner gives one I11, not two", () => {
    const doc = place(withDesk(), { object: "chair", kind: "chair", at: [ON_BOTH_ARMS.x, ON_BOTH_ARMS.y] });
    expect(chairFit(withDesk(), ON_BOTH_ARMS)).toEqual({ fits: false, reason: "object" });
    expect(fitViolations(doc).map((v) => [v.invariant, ...v.entities.map((e) => e.id)])).toEqual([["I11", "chair/s0", "desk/s0"]]);
  });

  it("a corner desk placed around a box in its empty quarter fits; over it on an arm, it is refused", () => {
    const room = rectDoc(0, 0, 4, 3);
    const desk = { surface: null, kind: "cornerDesk", state: "s0", at: { x: 0.9, y: 2.9 }, rotation: 0, config: "standard" };
    const command = { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "cornerDesk" }, at: desk.at, rotation: 0 } as const;
    const box = (top: number): Document => place(room, { object: "box", kind: "block", at: [1.3, top], size: { w: { standard: 0.4 }, d: { standard: 0.4 } } });
    expect(placementFit(box(2.2), desk)).toEqual({ fits: true, reason: null }); // x 1.1–1.5, y 1.8–2.2: in the quarter
    expect(execute(box(2.2), command).ok).toBe(true);
    expect(placementFit(box(2.35), desk)).toEqual({ fits: false, reason: "object" }); // 0.05 onto the back arm
    expect(execute(box(2.35), command).ok).toBe(false);
  });

  it("a wall crossing both arms gives one I10, not two", () => {
    // A free-standing wall at x = 0.4 (body x 0.3–0.5) from y 1.5 to 2.6: across the left arm and into the back arm.
    const room = rectDoc(0, 0, 4, 3);
    const walled: Document = { ...room, joints: { ...room.joints, P1: { id: "P1", x: 0.4, y: 1.5 }, P2: { id: "P2", x: 0.4, y: 2.6 } }, walls: { ...room.walls, P: wallRow("P", "P1", "P2") } };
    const doc = withDesk(false, walled);
    expect(fitViolations(doc).map((v) => [v.invariant, ...v.entities.map((e) => e.id)])).toEqual([["I10", "desk/s0", "P"]]);
  });

  it("a corner desk above the ceiling gives one I17, not two", () => {
    const size = { w: { standard: 1.6 }, d: { standard: 1.2 }, h: { standard: 0.75 }, z: { standard: 2 } }; // 2.00–2.75
    const doc = place(rectDoc(0, 0, 4, 3), { object: "desk", kind: "cornerDesk", at: [0.9, 2.9], size });
    expect(fitViolations(doc).map((v) => [v.invariant, ...v.entities.map((e) => e.id)])).toEqual([["I17", "desk/s0"]]);
  });

  it("free floor drops by exactly 1.32 m² for the default desk", () => {
    const empty = roomFree(rectDoc(0, 0, 4, 3));
    expect(Math.round((empty - roomFree(withDesk())) * 1e4) / 1e4).toBe(1.32);
  });

  it("a seat tucked under each arm: each overlap is added back once", () => {
    // Under the back arm, facing +y: x 1.075–1.525, y 2.0–2.45, 0.15 under the arm; its back strip y 2.0–2.1 clear.
    // Under the left arm, facing −x: x 0.55–1.0, y 1.75–2.2, 0.15 under the arm; its back strip x 0.9–1.0 clear.
    let doc = place(withDesk(), { object: "a", kind: "chair", at: [1.3, 2], rotation: 180 });
    doc = place(doc, { object: "b", kind: "chair", at: [1, 1.975], rotation: 270 });
    expect(validateDocument(doc).ok).toBe(true);
    const overlaps = 2 * 0.45 * 0.15;
    const expected = roomFree(withDesk()) - 2 * 0.45 * 0.45 + overlaps;
    expect(roomFree(doc)).toBeCloseTo(expected, 9);
  });
});
