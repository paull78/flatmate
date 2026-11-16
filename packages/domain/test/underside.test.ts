import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { stairGeometry, stairRuleOf } from "../src";
import type { Document, Placement } from "../src/model";
import { validateDocument } from "../src/validate";
import { rectDoc, withDeck } from "./helpers";

// The underside of an open stair (stairs.03, .11, AC-03): a piece overlapping it on the plan fits when its top is at or
// below the pitch line less 0.23 at its end nearest the bottom step; otherwise the move is refused with both heights.
// Other stairs collide as their box, and a piece above the box is not refused (headroom stays a warning).

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(`${r.error.message} ${r.error.violations.map((v) => v.message).join("; ")}`);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/**
 * An 8 × 3 m room (inner faces x 0.1–7.9, y 0.1–2.9) under a 3.20 ceiling, a hollow loft at 2.15 over x 5–7.9, and a
 * `kind` stair rising toward +x (rotation 270) with its back edge's middle on the loft's edge at (5.0, 0.6): its front
 * edge, the bottom step, at x 2.01, its sides at y 0.15 and 1.05.
 */
function house(kind = "openStair", states: readonly string[] = []): Document {
  let doc = run(rectDoc(0, 0, 8, 3), { type: "setCeiling", height: 3.2 });
  doc = withDeck(doc, { id: "L", name: "Loft", at: [6.45, 1.5], w: 2.9, d: 2.8, top: 2.15, solid: false });
  for (const name of states) doc = run(doc, { type: "addState", opId: name, name });
  return run(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind }, at: { x: 5, y: 0.6 }, rotation: 270, deck: null, reaches: "L" });
}
const FRONT_EDGE = 2.01;
/** A desk turned so its depth runs along the stair, its low end `a` metres from the bottom step: x from 2.01 + a to + 0.6. */
const deskAt = (a: number, state = "s0", opId = "dk"): Command => ({
  type: "placeObject", opId, state, object: { kind: "desk" }, at: { x: FRONT_EDGE + a, y: 0.75 }, rotation: 90, deck: null,
});
const placementOf = (doc: Document, object: string, state = "s0"): Placement => {
  const p = Object.values(doc.placements).find((q) => q.object === object && q.state === state);
  if (!p) throw new Error(`no ${object} in ${state}`);
  return p;
};
/** The open stair's underside at `a`: 0.179 + a × 0.179 / 0.272 − 0.23 for 12 risers over a 2.99 run. */
const underside = (a: number): number => {
  const rule = stairRuleOf("openStair");
  if (!rule) throw new Error("no rule");
  return stairGeometry(rule, 0.9, 2.99, 2.15, null).pitch(a) - 0.23;
};

describe("the underside of an open stair (AC-03)", () => {
  it("the stair to the loft has 12 risers of 0.179 over a 2.99 run", () => {
    const doc = house();
    expect(doc.objects["st/o0"]).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
    const rule = stairRuleOf("openStair");
    expect(rule && stairGeometry(rule, 0.9, 2.99, 2.15, null)).toMatchObject({ risers: 12, treads: 11 });
  });

  it("a 0.75 desk under the high end of a 12-riser open stair to the loft fits (underside about 1.39 at its low end)", () => {
    expect(underside(2.19)).toBeCloseTo(1.39, 2);
    const doc = run(house(), deskAt(2.19));
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("the same desk moved so its low end sits 0.6 from the bottom step is refused with \"… underside (… at that end)\"", () => {
    const doc = run(house(), deskAt(2.19));
    const move: Command = { type: "movePlacement", placementId: placementOf(doc, "dk/o0").id, at: { x: FRONT_EDGE + 0.6, y: 0.75 }, rotation: 90 };
    expect(refusal(doc, move)).toBe("Desk (0.00–0.75) hits the open stair's underside (0.34 at that end) in Layout");
  });

  it("placing it there is refused too; just where the underside is 0.75 it fits", () => {
    expect(refusal(house(), deskAt(0.6))).toBe("Desk (0.00–0.75) hits the open stair's underside (0.34 at that end) in Layout");
    // underside(a) = 0.75 at a = (0.98 − 0.1792) × 0.2718 / 0.1792 ≈ 1.2148
    expect(refusal(house(), deskAt(1.216))).toBe("accepted");
    expect(refusal(house(), deskAt(1.2))).toMatch(/^Desk \(0\.00–0\.75\) hits the open stair's underside \(0\.74 at that end\) in Layout$/);
  });

  it("a desk turned at 45° is judged by its lowest point within the stair's width, not a corner beside it", () => {
    // Turned 45°, a desk's corner pokes out past the stair's side (y < 0.15) further toward the bottom step than any
    // point of it over the flight: that corner doesn't count.
    const doc = house();
    const at = { x: FRONT_EDGE + 2.3, y: 0.95 };
    const r = execute(doc, { type: "placeObject", opId: "dk", state: "s0", object: { kind: "desk" }, at, rotation: 45, deck: null });
    expect(r.ok ? "accepted" : r.error.message).toBe("accepted");
  });
});

describe("other stairs and other heights", () => {
  it("a solid stair refuses any overlapping piece below its top (box rule kept)", () => {
    expect(refusal(house("stair"), deskAt(2.19))).toBe("Desk (0.00–0.75) and Stair (0.00–2.15) overlap in Layout");
  });

  it("a piece above the stair (bottom over the box top) is not refused", () => {
    let doc = run(house(), { type: "placeObject", opId: "sh", state: "s0", object: { kind: "block" }, at: { x: 1, y: 2.5 }, rotation: 0, deck: null });
    doc = run(doc, { type: "setObjectSize", objectId: "sh/o0", w: 0.4, d: { standard: 0.4 }, h: { standard: 0.5 }, z: { standard: 2.2 } });
    const move: Command = { type: "movePlacement", placementId: placementOf(doc, "sh/o0").id, at: { x: 2.6, y: 0.8 }, rotation: 0 };
    expect(refusal(doc, move)).toBe("accepted");
    // The same block lower, 0.30 to 0.80, stands between the underside and the pitch line and is refused against the underside.
    doc = run(doc, { type: "setObjectSize", objectId: "sh/o0", w: 0.4, d: { standard: 0.4 }, h: { standard: 0.5 }, z: { standard: 0.3 } });
    expect(refusal(doc, move)).toMatch(/^Custom box \(0\.30–0\.80\) (hits the open stair's underside \(0\.\d\d at that end\)|and )/);
  });

  it("the desk's copies in other layouts are checked too", () => {
    const doc = house("openStair", ["Night"]);
    expect(refusal(doc, deskAt(2.19, "Night/s0"))).toBe("accepted");
    expect(refusal(doc, deskAt(0.6, "Night/s0"))).toBe("Desk (0.00–0.75) hits the open stair's underside (0.34 at that end) in Night");
  });
});

describe("the steep stairs' underside (stairs step 12)", () => {
  // A ship's ladder to the loft: 9 risers of 0.239 over a 1.10 run (8 goings of 0.1375), its front edge at x 3.90.
  const SHIP_FRONT = 5 - 1.1;
  const deskOnShip = (a: number): Command => deskAt(SHIP_FRONT - FRONT_EDGE + a);

  it("a 0.75 desk under the high end of a ship's ladder fits; nearer the bottom step it hits the ship's ladder's underside", () => {
    expect(refusal(house("shipsLadder"), deskOnShip(0.5))).toBe("accepted"); // underside 0.009 + 0.5 × 1.738 = 0.878
    expect(refusal(house("shipsLadder"), deskOnShip(0.2))).toBe("Desk (0.00–0.75) hits the ship's ladder's underside (0.36 at that end) in Layout");
  });

  it("the rung ladder has no underside: the same desk against it is refused as its box", () => {
    expect(refusal(house("rungLadder"), deskAt(5 - 0.58 + 0.3 - FRONT_EDGE))).toBe("Desk (0.00–0.75) and Rung ladder (0.00–2.15) overlap in Layout");
  });
});
