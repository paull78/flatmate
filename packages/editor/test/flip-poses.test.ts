import { describe, expect, it } from "vitest";
import { execute, placementRange, unwrap, type Command, type Document } from "@fm/domain";
import { flipPoses } from "../src/view/flip-poses";
import { flipObjectsLayer } from "../src/view/objects-layer";
import { roomDoc } from "./builders";
import { floorView } from "../src/view/plan-view";

// The flip's poses in height (heights.29, AC-14 groundwork): bottom and top tween with centre, angle and size.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/** A lift bed up by Day (s0, 2.15–2.50) and down at Night (n/s0, 0.20–0.55) on the top wall; a chair only by Day. */
function liftBed(): Document {
  return ok(roomDoc(), { type: "addState", opId: "n", name: "Night" },
    { type: "placeObject", linked: false, deck: null, opId: "l", state: "s0", object: { kind: "liftBed" }, at: { x: 3, y: 3.9 } },
    { type: "placeObject", linked: false, deck: null, opId: "l2", state: "n/s0", object: { existing: "l/o0" }, at: { x: 3, y: 3.9 }, config: "down" },
    { type: "placeObject", linked: false, deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 5, y: 1 } });
}
const flip = (t: number) => ({ from: "s0", to: "n/s0", t });
const bed = (doc: Document, t: number) => flipPoses(doc, flip(t)).find((p) => p.objectId === "l/o0");

describe("flipPoses", () => {
  it("at t = 0 and 1 the bed's range equals each state's resolved range; mid-flip its bottom lies between", () => {
    const doc = liftBed();
    const day = placementRange(doc, "l/p0");
    const night = placementRange(doc, "l2/p0");
    expect(day).toEqual({ bottom: 2.15, top: 2.5 });
    expect(night).toEqual({ bottom: 0.2, top: 0.55 });
    expect(bed(doc, 0)).toMatchObject({ bottom: day?.bottom, top: day?.top, config: "down", only: null });
    expect(bed(doc, 1)?.bottom).toBeCloseTo(night?.bottom ?? NaN, 12);
    expect(bed(doc, 1)?.top).toBeCloseTo(night?.top ?? NaN, 12);
    const mid = bed(doc, 0.5)?.bottom ?? 0;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(2.15);
    expect(mid).toBeCloseTo((2.15 + 0.2) / 2, 9); // eased t²(3 − 2t) is ½ at ½
  });

  it("a chair on the floor by Day and on a platform at Night tweens its bottom from 0.00 to 0.45 and moves onto it (decks.07)", () => {
    // A platform x 3.5–5.5, y 1.3–2.7; the chair (0.90 tall) at (2, 2) by Day, on the platform at (4.5, 2) at Night.
    const doc = ok(roomDoc(), { type: "addState", opId: "n", name: "Night" }, { type: "addDeck", opId: "k", preset: "platform", at: { x: 4.5, y: 2 } },
      { type: "placeObject", linked: false, deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 2, y: 2 } },
      { type: "placeObject", linked: false, deck: "k/k0", opId: "c2", state: "n/s0", object: { existing: "c/o0" }, at: { x: 4.5, y: 2 } });
    const chair = (t: number) => flipPoses(doc, flip(t)).find((p) => p.objectId === "c/o0");
    expect(chair(0)).toMatchObject({ bottom: 0, top: 0.9, only: null });
    expect(chair(1)?.bottom).toBeCloseTo(0.45, 12);
    expect(chair(1)?.top).toBeCloseTo(1.35, 12);
    expect(chair(0.5)?.bottom).toBeCloseTo(0.225, 9);
    expect(chair(0.5)?.centre.x).toBeCloseTo(3.25, 9);
  });

  it("a piece in one layout keeps its pose and says which, for the plan to fade and 3D to pop it", () => {
    const chair = flipPoses(liftBed(), flip(0.3)).find((p) => p.objectId === "c/o0");
    expect(chair).toMatchObject({ only: "from", bottom: 0, top: 0.9, at: { x: 5, y: 1 } });
    expect(chair?.e).toBeCloseTo(0.3 * 0.3 * (3 - 0.6), 12);
  });

  it("the plan flip draws the bed dashed while above the cut and solid once down", () => {
    const doc = liftBed();
    const dashed = (t: number) => flipObjectsLayer(doc, floorView(doc, null).level, flip(t)).filter((p) => p.kind === "segment" && p.dash !== undefined).length;
    expect(dashed(0)).toBe(4);
    expect(dashed(1)).toBe(0);
  });
});
