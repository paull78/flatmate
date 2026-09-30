import { describe, expect, it } from "vitest";
import { incidentWalls, jointPoint, jointWalls, sortedIds, wallEnds } from "../src/graph";
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
