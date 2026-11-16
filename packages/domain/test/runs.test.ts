import { describe, expect, it } from "vitest";
import { execute } from "../src";
import { isStraightJoint, kinkAngle, offAxisAngle, wallRunOf } from "../src/queries/runs";
import type { Document } from "../src/model";
import { docOf, rectDoc } from "./helpers";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

/** A 6 × 4 room whose bottom wall is split at x 2 by a partition T-ing in from above. */
const teeDoc = (): Document => docOf({
  joints: [["J1", 0, 0], ["T", 2, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["P", 2, 2]],
  walls: [["B1", "J1", "T"], ["B2", "T", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"], ["P1", "T", "P"]],
});

/** The bottom wall split at x 3 with nothing else at the split. */
const splitDoc = (): Document => docOf({
  joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
  walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
});

describe("wallRunOf", () => {
  it("stops at corners", () => {
    expect(wallRunOf(rectDoc(0, 0, 6, 4), "W1")).toEqual(["W1"]);
  });

  it("goes through a T, whichever piece is asked, in order along the line", () => {
    expect(wallRunOf(teeDoc(), "B1")).toEqual(["B1", "B2"]);
    expect(wallRunOf(teeDoc(), "B2")).toEqual(["B1", "B2"]);
    expect(wallRunOf(teeDoc(), "P1")).toEqual(["P1"]);
  });

  it("passes through a column in the wall's line", () => {
    const placed = execute(rectDoc(0, 0, 6, 4), { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.3 });
    if (!placed.ok) throw new Error(placed.error.message);
    const run = wallRunOf(placed.value.doc, "W1");
    expect(run).toHaveLength(3);
    expect(run).toContain("c/w0");
    expect(run[0]).toBe("W1");
  });

  it("on the kinked house's top side stops at the slanted piece", () => {
    expect(wallRunOf(kinkedHouseDoc(), "wc9b9")).toEqual(["wc9b9", "wdb4fb"]);
    expect(wallRunOf(kinkedHouseDoc(), "w372a")).toEqual(["w372a"]);
  });
});

describe("isStraightJoint", () => {
  it("is true at a split with two walls in line", () => {
    expect(isStraightJoint(splitDoc(), "S")).toBe(true);
  });

  it("is false at a corner, at a T and on the kinked house's 7 mm kink", () => {
    expect(isStraightJoint(rectDoc(0, 0, 6, 4), "J1")).toBe(false);
    expect(isStraightJoint(teeDoc(), "T")).toBe(false);
    expect(isStraightJoint(kinkedHouseDoc(), "372a")).toBe(false);
    expect(isStraightJoint(kinkedHouseDoc(), "a8cd")).toBe(true);
  });
});

describe("kinkAngle", () => {
  it("is 0 in line, 90 at a corner, ~0.35 at the kinked house's kink, null unless two walls meet", () => {
    expect(kinkAngle(splitDoc(), "S")).toBeCloseTo(0, 9);
    expect(kinkAngle(rectDoc(0, 0, 6, 4), "J1")).toBeCloseTo(90, 9);
    expect(kinkAngle(kinkedHouseDoc(), "372a")).toBeCloseTo(0.354, 3);
    expect(kinkAngle(teeDoc(), "T")).toBeNull();
  });
});

describe("offAxisAngle", () => {
  it("measures degrees from the nearest axis", () => {
    expect(offAxisAngle(rectDoc(0, 0, 6, 4), "W1")).toBe(0);
    expect(offAxisAngle(rectDoc(0, 0, 6, 4), "W2")).toBe(0);
    expect(offAxisAngle(kinkedHouseDoc(), "w372a")).toBeCloseTo(0.354, 3);
    const diag = docOf({ joints: [["A", 0, 0], ["B", 1, 1]], walls: [["D", "A", "B"]] });
    expect(offAxisAngle(diag, "D")).toBeCloseTo(45, 9);
  });
});
