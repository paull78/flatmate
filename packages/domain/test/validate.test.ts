import { describe, expect, it } from "vitest";
import type { InvariantId } from "../src/errors";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

function invariants(doc: Document): InvariantId[] {
  const r = validateDocument(doc);
  return r.ok ? [] : [...new Set(r.error.map((v) => v.invariant))].sort();
}

describe("validateDocument", () => {
  it("accepts an empty document and a closed room", () => {
    expect(invariants({ joints: {}, walls: {}, zoneLabels: {} })).toEqual([]);
    expect(invariants(rectDoc(0, 0, 6, 4))).toEqual([]);
  });

  it("I1: walls need two existing, distinct joints", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0]], walls: [["W", "A", "Z"]] }))).toContain("I1");
    expect(invariants(docOf({ joints: [["A", 0, 0]], walls: [["W", "A", "A"]] }))).toContain("I1");
  });

  it("I2: walls are at least 1 cm long", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 0.009, 0]], walls: [["W", "A", "B"]] }))).toEqual(["I2"]);
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 0.01, 0]], walls: [["W", "A", "B"]] }))).toEqual([]);
  });

  it("I3: every joint is used", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 1, 0], ["C", 5, 5]], walls: [["W", "A", "B"]] }))).toEqual(["I3"]);
  });

  it("I4: joints are at least 1 mm apart", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 1, 0], ["C", 1.0005, 0], ["D", 1.0005, 1]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(doc)).toContain("I4");
  });

  it("I5: walls cross only at a shared joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 4], ["C", 0, 4], ["D", 4, 0]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(doc)).toEqual(["I5"]);
  });

  it("I6: no joint lies on another wall's body", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 6, 0], ["T", 3, 0], ["U", 3, 4]],
      walls: [["W1", "A", "B"], ["W2", "T", "U"]],
    });
    expect(invariants(doc)).toContain("I6");
  });

  it("I7: walls do not overlap collinearly", () => {
    const partial = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 2, 0.0], ["D", 6, 0]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(partial)).toContain("I7");
    const duplicate = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W1", "A", "B"], ["W2", "B", "A"]] });
    expect(invariants(duplicate)).toEqual(["I7"]);
  });

  it("I8: malformed IDs and non-finite numbers", () => {
    const badId = docOf({ joints: [["bad id", 0, 0], ["B", 1, 0]], walls: [["W", "bad id", "B"]] });
    expect(invariants(badId)).toEqual(["I8"]);
    const nan = docOf({ joints: [["A", Number.NaN, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] });
    expect(invariants(nan)).toEqual(["I8"]);
    const inf = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]], labels: [["L", Infinity, 0, "x"]] });
    expect(invariants(inf)).toEqual(["I8"]);
    const keyMismatch: Document = { joints: { A: { id: "Z", x: 0, y: 0 } }, walls: {}, zoneLabels: {} };
    expect(invariants(keyMismatch)).toEqual(["I8"]);
    const inherited = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"], ["V", "A", "constructor"]] });
    expect(invariants(inherited)).toEqual(["I8"]);
  });

  it("accepts a T-junction whose stem ends at a split joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["S", 3, 0], ["B", 6, 0], ["T", 3, 4]],
      walls: [["W1", "A", "S"], ["W2", "S", "B"], ["W3", "S", "T"]],
    });
    expect(invariants(doc)).toEqual([]);
  });
});
