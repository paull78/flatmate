import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { kindOf, STAIR_RULES, stairChecks, stairRuleChecks, stairRuleOf, type StairCheck, type StairCheckId } from "../src";
import type { Document } from "../src/model";
import { place, tinyHouse, withDeck } from "./helpers";

// A stair's warnings (stairs.03, .05, .12, .19, AC-04, AC-14): the rules of thumb of the spec's table, headroom over the
// flight against its pitch line, and "doesn't reach" when it no longer touches the deck it reaches. Never refusals.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const byId = (checks: readonly StairCheck[], id: StairCheckId): StairCheck | undefined => checks.find((c) => c.id === id);
const failing = (checks: readonly StairCheck[]): StairCheckId[] => checks.filter((c) => !c.ok).map((c) => c.id);

describe("stairRuleChecks: the spec's table, row by row (AC-14)", () => {
  // Each case: the body, a box that passes every check, then one change that breaks exactly the named check.
  const cases: [body: keyof typeof STAIR_RULES, ok: [w: number, d: number, h: number], broken: [w: number, d: number, h: number], fails: StairCheckId][] = [
    ["solid", [0.9, 11 * 0.272, 2.15], [0.9, 11 * 0.22, 2.15], "going"], // going 0.220 under 0.254 (and 2R + G 0.578 too short)
    ["solid", [0.9, 11 * 0.272, 2.15], [0.75, 11 * 0.272, 2.15], "width"], // under 0.80
    ["storage", [0.6, 0.268, 0.36], [0.6, 0.27, 0.35], "riser"], // 2 risers of 0.175, under 0.178
    ["open", [0.9, 11 * 0.272, 2.15], [0.9, 11 * 0.35, 2.15], "step"], // 2R + G = 0.708 over 0.66
    ["storage", [0.6, 1.99, 2.15], [0.6, 9 * 0.167, 2.15], "going"], // 0.167; this riser needs 0.221 (1.99: 0.2 mm short, within 0.5 mm)
    ["storage", [0.6, 1.99, 2.15], [0.5, 1.99, 2.15], "width"], // under 0.508
    ["ship", [0.6, 8 * 0.138, 2.15], [0.6, 8 * 0.3, 2.15], "slope"], // 38.5°, under 50°
    ["alternating", [0.6, 9 * 0.124, 2.15], [0.6, 9 * 0.05, 2.15], "slope"], // 76.9°, over 70°
    ["spiral", [1.6, 1.6, 2.15], [1.4, 1.4, 2.15], "clearWidth"], // 0.635 under 0.66
    ["rungs", [0.45, 0.576, 2.15], [0.45, 2.15 / Math.tan((82 * Math.PI) / 180), 2.15], "angle"], // 82°, over 80°
    ["rungs", [0.45, 0.576, 2.15], [0.28, 0.576, 2.15], "width"], // under 0.305
  ];
  it.each(cases)("%s: passes at its recommended size and fails only %4$s when broken", (body, ok, broken, fails) => {
    expect(failing(stairRuleChecks(STAIR_RULES[body], ...ok, null))).toEqual([]);
    expect(failing(stairRuleChecks(STAIR_RULES[body], ...broken, null))).toContain(fails);
  });

  it("reports the value and its bounds: a going of 0.220 against 0.254", () => {
    expect(byId(stairRuleChecks(STAIR_RULES.solid, 0.9, 11 * 0.22, 2.15, null), "going")).toEqual({ id: "going", ok: false, value: expect.closeTo(0.22, 9), min: 0.254, max: null });
  });

  it("the storage stair's going bound follows its riser (0.508 − 4/3 × riser)", () => {
    expect(byId(stairRuleChecks(STAIR_RULES.storage, 0.6, 9 * 0.167, 2.15, null), "going")).toMatchObject({ ok: false, min: expect.closeTo(0.508 - (4 / 3) * 0.215, 9) });
  });

  it("a rung ladder checks its rung spacing, 0.254 to 0.356", () => {
    expect(byId(stairRuleChecks(STAIR_RULES.rungs, 0.45, 0.576, 2.15, null), "spacing")).toMatchObject({ ok: true, value: expect.closeTo(0.26875, 6), min: 0.254, max: 0.356 });
  });
});

describe("stairChecks on a drawing", () => {
  /** The decks' tiny house under 3.20 with a hollow loft over x 4.9–6.9 at +2.15. */
  function house(): Document {
    const doc = run(tinyHouse(), { type: "setCeiling", height: 3.2 });
    return withDeck(doc, { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false });
  }
  const toLoft: Command = { type: "placeObject", opId: "st", state: "s0", object: { kind: "storageStair" }, at: { x: 4.9, y: 0.5 }, rotation: 270, deck: null, reaches: "L" };

  it("a storage stair to the loft under 3.20 passes its size checks and warns 1.265 of headroom, 1.88 wanted (AC-04)", () => {
    const checks = stairChecks(run(house(), toLoft), "st/o0");
    expect(failing(checks)).toEqual(["headroom"]);
    expect(byId(checks, "headroom")).toEqual({ id: "headroom", ok: false, value: expect.closeTo(3.2 - 9 * 0.215, 9), min: 1.88, max: null });
  });

  it("a wall cabinet over the flight's middle lowers the headroom to its underside less the pitch there", () => {
    // The cabinet, x 3.7–4.3 over the flight (x 2.91–4.9, front at 2.91), bottom 2.3: the pitch under its far end
    // (4.3, 1.39 from the front) is 0.215 + 1.39 × 0.215 / 0.2211 = 1.567.
    let doc = run(house(), toLoft);
    doc = place(doc, { object: "wc", kind: "wallCabinet", at: [4, 0.65], rotation: 0, size: { w: { standard: 0.6 }, d: { standard: 0.35 }, h: { standard: 0.6 }, z: { standard: 2.3 } } });
    const going = 1.99 / 9;
    const check = byId(stairChecks(doc, "st/o0"), "headroom");
    expect(check && "value" in check ? check.value : Number.NaN).toBeCloseTo(2.3 - (0.215 + (4.3 - 2.91) * (0.215 / going)), 6);
  });

  it("moved away from the loft, it warns that it doesn't reach the Loft (stairs.19)", () => {
    let doc = run(house(), toLoft);
    expect(byId(stairChecks(doc, "st/o0"), "reach")).toEqual({ id: "reach", ok: true, deck: "L" });
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 4.4, y: 0.5 }, rotation: 270 });
    expect(byId(stairChecks(doc, "st/o0"), "reach")).toEqual({ id: "reach", ok: false, deck: "L" });
  });

  it("the ship's ladder, the alternating tread and the rung ladder pass their size checks at their default sizes (stairs step 12)", () => {
    for (const kind of ["shipsLadder", "alternatingTread", "rungLadder"]) {
      const rule = stairRuleOf(kind);
      const size = kindOf(kind)?.configs[0];
      if (!rule || !size) throw new Error(`no stair kind ${kind}`);
      expect([kind, failing(stairRuleChecks(rule, size.w, size.d, size.h, null))]).toEqual([kind, []]);
    }
  });

  it("a rung ladder to the loft passes; shortened to 82° it warns about its angle, and never about headroom (AC-14)", () => {
    const ladder: Command = { ...toLoft, object: { kind: "rungLadder" } };
    let doc = run(house(), ladder);
    expect(failing(stairChecks(doc, "st/o0"))).toEqual([]);
    expect(byId(stairChecks(doc, "st/o0"), "headroom")).toBeUndefined();
    doc = run(doc, { type: "setObjectSize", objectId: "st/o0", w: 0.45, d: { standard: 2.15 / Math.tan((82 * Math.PI) / 180) } });
    expect(failing(stairChecks(doc, "st/o0"))).toEqual(["angle"]);
    expect(byId(stairChecks(doc, "st/o0"), "angle")).toMatchObject({ ok: false, value: expect.closeTo(82, 6), min: 70, max: 80 });
  });

  it("a stair that reaches nothing has no reach check; furniture has no checks", () => {
    const doc = run(house(), { ...toLoft, at: { x: 4.5, y: 0.5 }, reaches: null } as Command);
    expect(byId(stairChecks(doc, "st/o0"), "reach")).toBeUndefined();
    expect(stairChecks(place(doc, { object: "b", kind: "block", at: [4, 1.5] }), "b")).toEqual([]);
  });
});
