import { describe, expect, it } from "vitest";
import { STAIR_RULES, canSwitchKind, kindOf, recommendedRun, stairGeometry, stairRuleOf, type StairBody } from "../src";

// Stair kinds sized by their box (stairs.01, .20, spec "Kinds and sizes"): risers from the rise and the kind's largest
// riser, the going from the run, the pitch line through the nosings.

const rule = (body: StairBody) => STAIR_RULES[body];

describe("stairGeometry", () => {
  it("risers round the rise up by the kind's largest riser", () => {
    const risers = (body: StairBody) => stairGeometry(rule(body), 1, 2, 2.15, null);
    expect(risers("storage")).toMatchObject({ risers: 10, riser: expect.closeTo(0.215, 6) });
    expect(risers("solid")).toMatchObject({ risers: 12, riser: expect.closeTo(0.17917, 4) });
    expect(risers("ship")).toMatchObject({ risers: 9, riser: expect.closeTo(0.23889, 4) });
    expect(risers("rungs")).toMatchObject({ risers: 8, riser: expect.closeTo(0.26875, 4) });
    expect(risers("spiral")).toMatchObject({ risers: 10, riser: expect.closeTo(0.215, 6) });
  });

  it("a rise exactly divisible by the largest riser keeps that riser count", () => {
    expect(stairGeometry(rule("storage"), 0.6, 2, 2.3, null).risers).toBe(10);
  });

  it("a flight has one tread fewer than risers, and the going is the run over the treads", () => {
    const g = stairGeometry(rule("storage"), 0.6, 1.99, 2.15, null);
    expect(g.treads).toBe(9);
    expect(g.going).toBeCloseTo(1.99 / 9, 9);
    expect(stairGeometry(rule("storage"), 0.6, 1.5, 2.15, null).going).toBeCloseTo(1.5 / 9, 9);
  });

  it("a rung ladder's run is split into one space per riser", () => {
    const g = stairGeometry(rule("rungs"), 0.45, 0.576, 2.15, null);
    expect(g.treads).toBe(7); // rungs
    expect(g.going).toBeCloseTo(0.576 / 8, 9);
  });

  it("the pitch line passes through every nosing", () => {
    for (const body of ["solid", "storage", "open", "ship", "alternating"] as const) {
      const g = stairGeometry(rule(body), 0.9, 2.5, 2.15, null);
      for (let k = 1; k <= g.treads; k++) expect(g.pitch((k - 1) * g.going), `${body} tread ${k}`).toBeCloseTo(k * g.riser, 9);
    }
  });
});

describe("recommendedRun", () => {
  it("follows the kind's going rule", () => {
    expect(recommendedRun(rule("storage"), 2.15, null) / 9).toBeCloseTo(0.508 - (4 / 3) * 0.215, 9); // 0.221
    expect(recommendedRun(rule("solid"), 2.15, null) / 11).toBeCloseTo(0.63 - 2 * (2.15 / 12), 9); // 0.272
    expect(recommendedRun(rule("ship"), 2.15, null) / 8).toBeCloseTo(2.15 / 9 / Math.tan(Math.PI / 3), 9); // 60°: 0.138
    expect(recommendedRun(rule("rungs"), 2.15, null)).toBeCloseTo(2.15 / Math.tan((75 * Math.PI) / 180), 9); // 75°: 0.576
  });

  it("keeps the step formula's going between 0.25 and 0.30", () => {
    expect(recommendedRun(rule("solid"), 0.45, null) / 2).toBeCloseTo(0.3, 9); // 3 risers of 0.15: 0.33 kept at 0.30
    expect(recommendedRun(rule("solid"), 1.9, null) / 9).toBeCloseTo(0.25, 9); // 10 risers of 0.19: 0.63 − 0.38 = 0.25
  });
});

describe("stair kinds", () => {
  it("the storage stair is a stair kind sized 0.60 × 1.99 × 2.15", () => {
    expect(stairRuleOf("storageStair")).toBe(STAIR_RULES.storage);
    expect(kindOf("storageStair")?.configs).toEqual([{ id: "standard", label: "Standard", w: 0.6, d: 1.99, zone: 0.9, h: 2.15, z: 0 }]);
  });

  it("the stair and the open stair are stair kinds sized 0.90 × 2.99 × 2.15, solid and open", () => {
    expect(stairRuleOf("stair")).toBe(STAIR_RULES.solid);
    expect(stairRuleOf("openStair")).toBe(STAIR_RULES.open);
    for (const kind of ["stair", "openStair"]) expect(kindOf(kind)?.configs).toEqual([{ id: "standard", label: "Standard", w: 0.9, d: 2.99, zone: 0.9, h: 2.15, z: 0 }]);
    expect(kindOf("openStair")?.label).toBe("Open stair");
    expect(canSwitchKind("stair", "openStair")).toBe(true);
  });

  it("the ship's ladder, the alternating tread and the rung ladder are stair kinds with their own rules and sizes (stairs step 12)", () => {
    const rows: [kind: string, label: string, body: StairBody, w: number, d: number][] = [
      ["shipsLadder", "Ship's ladder", "ship", 0.6, 1.1],
      ["alternatingTread", "Alternating tread", "alternating", 0.6, 1.12],
      ["rungLadder", "Rung ladder", "rungs", 0.45, 0.58],
    ];
    for (const [kind, label, body, w, d] of rows) {
      expect(stairRuleOf(kind)).toBe(rule(body));
      expect(kindOf(kind)?.label).toBe(label);
      expect(kindOf(kind)?.configs).toEqual([{ id: "standard", label: "Standard", w, d, zone: 0.9, h: 2.15, z: 0 }]);
    }
    expect(stairGeometry(rule("ship"), 0.6, 1.1, 2.15, null)).toMatchObject({ risers: 9, treads: 8, going: expect.closeTo(0.1375, 9) });
    expect(stairGeometry(rule("alternating"), 0.6, 1.12, 2.15, null)).toMatchObject({ risers: 10, treads: 9, going: expect.closeTo(0.1244, 4) });
    expect(stairGeometry(rule("rungs"), 0.45, 0.58, 2.15, null)).toMatchObject({ risers: 8, treads: 7, going: expect.closeTo(0.0725, 9) });
  });

  it("furniture is no stair", () => {
    expect(stairRuleOf("bed")).toBeNull();
    expect(stairRuleOf("nope")).toBeNull();
  });

  it("a stair can't switch to furniture, nor furniture to a stair", () => {
    expect(canSwitchKind("block", "storageStair")).toBe(false);
    expect(canSwitchKind("storageStair", "block")).toBe(false);
  });
});
