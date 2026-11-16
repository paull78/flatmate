import { describe, expect, it } from "vitest";
import type { Document } from "../src/model";
import { freeFloor } from "../src/queries/free-floor";
import { tucks } from "../src/queries/tucks";
import { place, rectDoc } from "./helpers";

// Free floor adds each tuck's overlap back once (spec "Seating: the tuck rule", AC-06; seating.09). The room: 4 × 4 m,
// inner faces at 0.1 and 3.9. A desk (1.20 × 0.60) stands against the top wall, its front edge on y = 3.3; a chair
// (0.45 × 0.45) turned 180° faces it, its back on y = 2.85 + t when it is tucked t under the desk.

const room = (): Document => rectDoc(0, 0, 4, 4);
const desk = (doc: Document, x = 2, object = "desk"): Document => place(doc, { object, kind: "desk", at: [x, 3.9] });
const chair = (doc: Document, t: number, x = 2, state = "s0"): Document =>
  place(doc, { object: "chair", kind: "chair", at: [x, 2.85 + t], rotation: 180, state });

/** The free floor of the only room in `state`. */
function free(doc: Document, state = "s0"): number {
  const values = [...freeFloor(doc, state).values()];
  expect(values).toHaveLength(1);
  const [v] = values;
  if (v === null || v === undefined) throw new Error("no free floor");
  return v;
}

describe("free floor with tucks (AC-06)", () => {
  it("tucking a chair 0.20 under a desk adds back 0.45 × 0.20 = 0.09 m²", () => {
    const out = free(chair(desk(room()), -0.1));
    const tucked = free(chair(desk(room()), 0.2));
    expect(tucked - out).toBeCloseTo(0.09, 9);
  });

  it("a chair under two desks adds back both overlaps", () => {
    // Two desks side by side, touching at x = 2.0; the chair centred on the seam overlaps each by 0.225 × t.
    const base = desk(desk(room(), 1.4, "d1"), 2.6, "d2");
    const out = free(chair(base, -0.1));
    const doc = chair(base, 0.3);
    expect(tucks(doc)).toHaveLength(2);
    expect(free(doc) - out).toBeCloseTo(0.45 * 0.3, 9);
  });

  it("a chair touching the desk adds nothing", () => {
    const doc = chair(desk(room()), 0);
    expect(tucks(doc)).toHaveLength(0);
    expect(free(doc)).toBeCloseTo(free(chair(desk(room()), -0.1)), 9);
  });

  it("a tuck in Night leaves Day alone", () => {
    const day = chair(desk(room()), -0.1);
    const both = chair(place(day, { object: "desk", kind: "desk", at: [2, 3.9], state: "night" }), 0.3, 2, "night");
    expect(free(both, "s0")).toBeCloseTo(free(day, "s0"), 9);
    expect(free(both, "night") - free(day, "s0")).toBeCloseTo(0.45 * 0.3, 9);
  });

  it("a desk raised from 1.20 takes no floor, so a chair under it adds nothing back", () => {
    const raised = place(room(), { object: "desk", kind: "desk", at: [2, 3.9], size: { w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 0.05 }, z: { standard: 1.2 } } });
    const doc = chair(raised, 0.3);
    expect(tucks(doc)).toHaveLength(1); // tucks don't compare heights
    expect(free(room()) - free(doc)).toBeCloseTo(0.45 * 0.45, 9);
  });

  it("never exceeds the room's clear area", () => {
    const doc = chair(desk(room()), 0.35);
    expect(free(doc)).toBeLessThanOrEqual(free(room()));
  });
});
