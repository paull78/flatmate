import { describe, expect, it } from "vitest";
import { stairGeometry } from "../src/queries/stairs";
import { STAIR_RULES } from "../src/stairs";

// The geometry owns the walk (steps.09, step 05): a stair's pitch line as knots, where tread k's nosing lies, and the
// run for a going, read by every rule that used to rebuild a straight run itself. A flight's numbers don't change.

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

describe("a flight's walk", () => {
  // A Stair 0.90 × 2.99 rising 2.15: 12 risers of 0.1792, 11 treads of 0.2718.
  const g = stairGeometry(STAIR_RULES.solid, 0.9, 2.99, 2.15, null);

  it("knots run from the first nosing (0, one riser) to the last ((treads − 1) × going, all but the last riser)", () => {
    expect(g.knots).toHaveLength(2);
    expect(g.knots[0]).toEqual({ a: 0, z: g.riser });
    expect(near(g.knots[1]?.a ?? 0, 10 * g.going)).toBe(true);
    expect(near(g.knots[1]?.z ?? 0, 11 * g.riser)).toBe(true);
  });

  it("pitch matches the formula riser + a × riser / going at twenty points", () => {
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * g.run;
      expect(near(g.pitch(a), g.riser + (a * g.riser) / g.going)).toBe(true);
    }
  });

  it("nosingAt(k) is (k − 1) × going; runFor(going) is going × treads", () => {
    for (const k of [1, 2, 6, 11]) expect(near(g.nosingAt(k), (k - 1) * g.going)).toBe(true);
    expect(near(g.runFor(0.25), 0.25 * 11)).toBe(true);
  });
});

describe("a ladder's and a spiral's walk", () => {
  it("a rung ladder: pitch through the rungs, a × riser / going; runFor(going) is going × risers", () => {
    const g = stairGeometry(STAIR_RULES.rungs, 0.45, 0.58, 2.15, null);
    for (const a of [0, 0.1, 0.3, 0.58]) expect(near(g.pitch(a), (a * g.riser) / g.going)).toBe(true);
    expect(near(g.runFor(0.08), 0.08 * g.risers)).toBe(true);
    expect(g.knots[0]).toEqual({ a: 0, z: 0 });
  });

  it("a spiral: level at its rise everywhere; one knot", () => {
    const g = stairGeometry(STAIR_RULES.spiral, 1.6, 1.6, 2.15, null);
    for (const a of [0, 0.8, 1.6]) expect(g.pitch(a)).toBe(2.15);
    expect(g.knots).toEqual([{ a: 0, z: 2.15 }]);
  });
});
