import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { OPENING_KIND_IDS, OPENING_KINDS } from "../src/kinds";
import type { Document } from "../src/model";
import { wallReach } from "../src/queries/openings";
import { rectDoc, withOpening } from "./helpers";

// A pocket door's pocket (openkinds.09, .16, AC-08): an opening's reach along its wall is its span, plus one width of
// wall past a pocket door's hinge end, and I12 checks reaches. The rectangle's W1 runs J1 (0, 0) → J2 (x1, 0).

const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const POCKET = "Pocket door p needs 0.80 m of wall past its end";

describe("wallReach", () => {
  it("is the span for every kind without a pocket", () => {
    for (const kind of OPENING_KIND_IDS.filter((k) => !OPENING_KINDS[k].pocket)) {
      expect(wallReach({ kind, offset: 1, width: 0.8, hinge: "a" }), kind).toEqual({ from: 1, to: 1.8 });
    }
  });

  it("adds a pocket door's pocket, one width long, past its hinge end", () => {
    const a = wallReach({ kind: "pocket", offset: 1, width: 0.8, hinge: "a" });
    expect([a.from, a.to].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.2, 1.8]);
    const b = wallReach({ kind: "pocket", offset: 1, width: 0.8, hinge: "b" });
    expect([b.from, b.to].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 2.6]);
  });
});

describe("the pocket in I12 (AC-08)", () => {
  // A pocket door at x 0.5–1.3 on the 6 m W1, and a window from x 2.3: 1.00 m of free wall past its b end.
  const room = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", kind: "window", offset: 2.3, width: 1 });
  const add = (hinge: "a" | "b"): Command => ({ type: "addOpening", opId: "p", wall: "W1", kind: "pocket", offset: 0.5, width: 0.8, hinge });

  it("a pocket running off the wall's end is refused with the pocket message; flipped to the end with 1.00 m free, accepted", () => {
    expect(refusal(room, add("a")).replace("p/d0", "p")).toBe(POCKET);
    expect(refusal(room, add("b"))).toBe("accepted");
  });

  it("a window over the pocket is refused naming the pocket, and nothing changes", () => {
    const doc = withOpening(room, { id: "p", wall: "W1", kind: "pocket", offset: 0.5, width: 0.8, hinge: "b" }); // pocket x 1.3–2.1
    const r = execute(doc, { type: "addOpening", opId: "x", wall: "W1", kind: "window", offset: 1.6, width: 0.4 });
    expect(r.ok ? "accepted" : r.error.message).toBe("Window x/d0 overlaps pocket door p's pocket on wall W1");
    expect(refusal(doc, { type: "addOpening", opId: "x", wall: "W1", kind: "window", offset: 1.6, width: 0.4 })).not.toBe("accepted");
  });

  it("an opening starting exactly at the pocket's end touches it and is accepted", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "p", wall: "W1", kind: "pocket", offset: 0.5, width: 0.8, hinge: "b" });
    expect(refusal(doc, { type: "addOpening", opId: "x", wall: "W1", kind: "window", offset: 2.1, width: 1 })).toBe("accepted");
  });

  it("shortening the wall into the pocket is refused with the pocket message", () => {
    // A 2.50 m wide room: the pocket x 1.3–2.1 fits W1; moving its J2 and J3 to x 2.0 runs the pocket past the end.
    const doc = withOpening(rectDoc(0, 0, 2.5, 4), { id: "p", wall: "W1", kind: "pocket", offset: 0.5, width: 0.8, hinge: "b" });
    expect(refusal(doc, { type: "moveJoints", moves: [{ jointId: "J2", to: { x: 2, y: 0 } }, { jointId: "J3", to: { x: 2, y: 4 } }] })).toBe(POCKET);
    expect(refusal(doc, { type: "moveJoints", moves: [{ jointId: "J2", to: { x: 2.2, y: 0 } }, { jointId: "J3", to: { x: 2.2, y: 4 } }] })).toBe("accepted");
  });

  it("a wall can't end inside the pocket: a split there is refused", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "p", wall: "W1", kind: "pocket", offset: 0.5, width: 0.8, hinge: "b" });
    expect(refusal(doc, { type: "addWall", opId: "s", from: { at: { x: 1.7, y: 0 } }, to: { at: { x: 1.7, y: 2 } } })).toBe("A wall can't end inside pocket door p");
    expect(refusal(doc, { type: "addWall", opId: "s", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 2 } } })).toBe("accepted");
  });
});
