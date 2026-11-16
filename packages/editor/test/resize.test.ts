import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { resizeTo } from "../src/snapping/resize";
import { roomDoc, sofaBed200, withCommands } from "./builders";

// A side grip's new size (AC-04): the step on the movement, a wall face within the tolerance, Ctrl to the cm, and
// 0.02–10 m. The sofa bed in its sofa configuration, 2 × 0.9, anchored at (2, 3): x 1–3, y 2.1–3. The room's inner
// faces are at x 0.1 / 5.9 and y 0.1 / 3.9. No anchor here: that is the domain's rule (direct.18).
const sofaAt = (x: number, y: number, rotation = 0): Document =>
  withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "sofa", state: "s0", object: { kind: "sofaBed" }, at: { x, y }, rotation }, sofaBed200("sofa/o0"));
const doc = sofaAt(2, 3);
const snap = { step: 0.2, tolerance: 0.125, free: false, layout: null, hidden: new Set<string>(), hiddenWalls: new Set<string>() };
const free = { ...snap, free: true };

describe("resizeTo (AC-04)", () => {
  it("right, Ctrl: follows the cursor to the cm", () => {
    expect(resizeTo(doc, "sofa/p0", "right", 0.3, free)).toBeCloseTo(2.3, 9);
    expect(resizeTo(doc, "sofa/p0", "right", 0.273, free)).toBeCloseTo(2.27, 9);
  });

  it("right: the drag moves in the snap step", () => {
    expect(resizeTo(doc, "sofa/p0", "right", 0.27, snap)).toBeCloseTo(2.2, 9);
    expect(resizeTo(doc, "sofa/p0", "back", 0.27, snap)).toBe(1.1); // 0.9 + roundTo(0.27, 0.2), not roundTo(1.17, 0.2) = 1.2
  });

  it("a stepped size is kept to the mm, without float noise", () => {
    expect(resizeTo(doc, "sofa/p0", "front", -0.6, snap)).toBe(0.3); // 0.9 − 0.6 is 0.30000000000000004
  });

  it("right: a wall face within tolerance wins over the step", () => {
    expect(resizeTo(doc, "sofa/p0", "right", 2.83, snap)).toBeCloseTo(4.9, 9); // raw 4.83; flush with x 5.9
    expect(resizeTo(doc, "sofa/p0", "right", 2.95, snap)).toBeCloseTo(4.9, 9); // raw 4.95, past the face
    expect(resizeTo(doc, "sofa/p0", "right", 2.75, snap)).toBeCloseTo(4.8, 9); // |4.9 − 4.75| = 0.15 > 0.125
  });

  it("left / back / front, free", () => {
    expect(resizeTo(doc, "sofa/p0", "left", 0.4, free)).toBeCloseTo(2.4, 9);
    expect(resizeTo(doc, "sofa/p0", "back", 0.2, free)).toBeCloseTo(1.1, 9);
    expect(resizeTo(doc, "sofa/p0", "front", 0.3, free)).toBeCloseTo(1.2, 9);
  });

  it("clamps to 0.02–10 m (hangings.03)", () => {
    expect(resizeTo(doc, "sofa/p0", "front", -1.4, free)).toBe(0.02);
    expect(resizeTo(doc, "sofa/p0", "right", 9, free)).toBe(10);
  });

  it("turned 90°", () => {
    expect(resizeTo(sofaAt(2, 2, 90), "sofa/p0", "right", 0.2, free)).toBeCloseTo(2.2, 9); // x 2–2.9, y 1–3
  });

  // A desk whose left face is x 3.53, off the 0.2 step, beside the sofa's right side (x 3): flush is 2.53, the step 2.6.
  const deskAt = (state: string): Document =>
    withCommands(doc, { type: "placeObject", linked: false, deck: null, opId: "desk", state, object: { kind: "desk", size: { w: 1.2, d: 0.6 } }, at: { x: 4.13, y: 2.85 } });
  const withNight = withCommands(roomDoc(), { type: "addState", opId: "n", name: "Night" });

  it("a neighbour's face within tolerance wins over the step (furnish.61, AC-13)", () => {
    expect(resizeTo(deskAt("s0"), "sofa/p0", "right", 0.5, { ...snap, layout: "s0" })).toBeCloseTo(2.53, 9);
    expect(resizeTo(deskAt("s0"), "sofa/p0", "right", 0.5, { ...free, layout: "s0" })).toBeCloseTo(2.5, 9); // Ctrl: no snap
  });

  it("a piece the viewed level hides doesn't attract the grip (levels.19, cleanup M3 review)", () => {
    expect(resizeTo(deskAt("s0"), "sofa/p0", "right", 0.5, { ...snap, layout: "s0", hidden: new Set(["desk/p0"]) })).toBeCloseTo(2.6, 9);
  });

  it("a piece in another layout doesn't attract the grip", () => {
    const night = withCommands(
      withNight,
      { type: "placeObject", linked: false, deck: null, opId: "sofa", state: "s0", object: { kind: "sofaBed" }, at: { x: 2, y: 3 }, rotation: 0 },
      sofaBed200("sofa/o0"),
      { type: "placeObject", linked: false, deck: null, opId: "desk", state: "n/s0", object: { kind: "desk", size: { w: 1.2, d: 0.6 } }, at: { x: 4.13, y: 2.85 } },
    );
    expect(resizeTo(night, "sofa/p0", "right", 0.5, { ...snap, layout: "s0" })).toBeCloseTo(2.6, 9);
  });

  it("of a missing placement is null", () => {
    expect(resizeTo(doc, "nope", "right", 0.2, free)).toBeNull();
  });
});
