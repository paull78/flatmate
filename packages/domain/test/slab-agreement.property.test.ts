import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import { anchorAt } from "../src/queries/footprints";
import { placementFit } from "../src/queries/fit";
import { LOFT, notchedCabin, run } from "./cabin";
import { rng } from "./helpers";

// The two fit entry points agree around holes (heights.44 pattern, stairwell.15): placementFit, which the editor's
// ghosts and snapping read, and validation through placeObject, on the floor and on the loft, near the notch and a
// second hole, at random sizes, heights and rotations.

const CASES = 600;

describe("fit agreement around holes", () => {
  it(`${CASES} random pieces: placementFit says fits exactly when placeObject is accepted`, () => {
    const doc = run(notchedCabin(), { type: "setCeiling", height: 3.5 }, { type: "addDeckHole", opId: "mid", deck: LOFT, at: { x: 0.9, y: 1.2 }, w: 0.6, d: 0.8 });
    const next = rng(77);
    const seen = { fits: 0, refused: 0, onLoft: 0 };
    for (let n = 0; n < CASES; n++) {
      const w = Math.round((0.3 + next() * 0.9) * 100) / 100;
      const d = Math.round((0.3 + next() * 0.9) * 100) / 100;
      const centre = { x: Math.round((0.2 + next() * 3.6) * 100) / 100, y: Math.round((0.2 + next() * 2.6) * 100) / 100 };
      const rotation = [0, 30, 90][Math.floor(next() * 3)] ?? 0;
      const surface = next() < 0.6 ? LOFT : null;
      const at = anchorAt(centre, d, rotation);
      const fit = placementFit(doc, { kind: "block", state: "s0", at, rotation, config: "standard", w, d, surface });
      const r = execute(doc, { type: "placeObject", opId: "t", state: "s0", object: { kind: "block", size: { w, d } }, at, rotation, deck: surface });
      expect(fit.fits, JSON.stringify({ w, d, centre, rotation, surface, reason: fit.reason, error: r.ok ? null : r.error.message })).toBe(r.ok);
      if (r.ok) seen.fits++;
      else seen.refused++;
      if (surface !== null && r.ok) seen.onLoft++;
    }
    expect(seen.fits).toBeGreaterThan(100);
    expect(seen.refused).toBeGreaterThan(100);
    expect(seen.onLoft).toBeGreaterThan(20);
  });
});
