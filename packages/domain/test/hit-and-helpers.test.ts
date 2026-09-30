import { describe, expect, it } from "vitest";
import { wallHelperDimension } from "../src/queries/helpers";
import { hitCandidates } from "../src/queries/hit";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

describe("wallHelperDimension", () => {
  it("measures the centreline from a to b", () => {
    expect(wallHelperDimension(rectDoc(0, 0, 6, 4), "W2")).toEqual({ a: { x: 6, y: 0 }, b: { x: 6, y: 4 }, length: 4 });
    expect(wallHelperDimension(rectDoc(0, 0, 6, 4), "nope")).toBeNull();
  });

  it("returns null for an ID that names an Object.prototype member", () => {
    // doc.walls.constructor is inherited; its missing `a` and `b` would look up the joint "undefined".
    const doc = docOf({
      joints: [["undefined", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
      walls: [["W1", "undefined", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "undefined"]],
    });
    expect(validateDocument(doc).ok).toBe(true);
    expect(wallHelperDimension(doc, "constructor")).toBeNull();
  });
});

describe("hitCandidates", () => {
  it("returns joints before walls, nearest first", () => {
    const doc = rectDoc(0, 0, 6, 4);
    // (6.02, 0.01) is 0.020 m from W2 (x = 6) and 0.022 m from W1's end (6, 0).
    expect(hitCandidates(doc, { x: 6.02, y: 0.01 }, 0.05)).toEqual([
      { table: "joints", id: "J2" }, { table: "walls", id: "W2" }, { table: "walls", id: "W1" },
    ]);
  });

  it("hits a wall body within half its thickness plus tolerance", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(hitCandidates(doc, { x: 3, y: 0.12 }, 0.05)).toEqual([{ table: "walls", id: "W1" }]);
    expect(hitCandidates(doc, { x: 3, y: 2 }, 0.05)).toEqual([]);
  });

  it("orders walls at the same distance by ID even when float noise separates them", () => {
    // p is exactly 0.08 m from both walls: W2 runs along 3x = 4y, W1 is horizontal at y = 0.255.
    // Computed, W1 is 0.08000000000000002 and W2 0.07999999999999999.
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 3], ["C", -1, 0.255], ["D", 0.2, 0.255]],
      walls: [["W1", "C", "D"], ["W2", "A", "B"]],
    });
    expect(validateDocument(doc).ok).toBe(true);
    expect(hitCandidates(doc, { x: 0.1, y: 0.175 }, 0.05)).toEqual([{ table: "walls", id: "W1" }, { table: "walls", id: "W2" }]);
  });

  it("finds nothing in an empty document", () => {
    expect(hitCandidates({ joints: {}, walls: {}, zoneLabels: {} }, { x: 0, y: 0 }, 1)).toEqual([]);
  });
});
