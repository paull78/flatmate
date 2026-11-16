import { describe, expect, it } from "vitest";
import { incidentWalls, jointPoint, jointWalls, sortedIds, wallEnds, wallFrame } from "../src/graph";
import { docOf } from "./helpers";

describe("graph helpers", () => {
  const doc = docOf({
    joints: [["B", 4, 0], ["A", 0, 0], ["C", 4, 3]],
    walls: [["W2", "B", "C"], ["W1", "A", "B"]],
  });

  it("sorts IDs lexicographically regardless of insertion order", () => {
    expect(sortedIds(doc.joints)).toEqual(["A", "B", "C"]);
  });

  it("lists incident walls by ID", () => {
    expect(incidentWalls(doc, "B")).toEqual(["W1", "W2"]);
    expect(jointWalls(doc).get("B")).toEqual(["W1", "W2"]);
  });

  it("reads wall endpoints", () => {
    expect(wallEnds(doc, "W2")).toEqual({ a: { x: 4, y: 0 }, b: { x: 4, y: 3 } });
    expect(wallEnds(doc, "nope")).toBeNull();
  });

  it("finds nothing under IDs that name Object.prototype members", () => {
    expect(jointPoint(doc, "constructor")).toBeNull();
    expect(wallEnds(doc, "constructor")).toBeNull();
  });
});

describe("wallFrame", () => {
  it("gives the ends, the unit direction a → b, its left normal, half the thickness and the length", () => {
    const doc = docOf({ joints: [["P", 1, 1], ["Q", 4, 5]], walls: [["S", "P", "Q", 0.15]] });
    expect(wallFrame(doc, "S")).toEqual({ a: { x: 1, y: 1 }, b: { x: 4, y: 5 }, dir: { x: 0.6, y: 0.8 }, left: { x: -0.8, y: 0.6 }, half: 0.075, length: 5 });
  });

  it("is null for a missing wall, a missing joint and a zero-length wall", () => {
    const doc = docOf({ joints: [["P", 1, 1], ["Q", 1, 1]], walls: [["Z", "P", "Q"], ["M", "P", "gone"]] });
    expect(wallFrame(doc, "nope")).toBeNull();
    expect(wallFrame(doc, "constructor")).toBeNull();
    expect(wallFrame(doc, "M")).toBeNull();
    expect(wallFrame(doc, "Z")).toBeNull();
  });
});
