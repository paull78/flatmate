import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Document } from "../src/model";
import { footprintFit, placementFit } from "../src/queries/fit";
import { footprintQuad } from "../src/queries/footprints";
import { validateDocument } from "../src/validate";
import { BED_160x200, docOf, grid, place, SOFA_BED_200 } from "./helpers";
import { PERF } from "./perf-switch";

declare const console: { log(message: string): void };
declare const performance: { now(): number };

// placementFit (ux-polish.12): the cheap fit query behind the object ghost, which must agree with what
// execute(placeObject) accepts.

/**
 * A 6 × 5 studio with a 2 × 2 bathroom in the bottom-right corner, furnished in two layouts: "day" (sofa, desk,
 * chair) and "night" (bed, wardrobe). Inner wall faces are 0.1 m from the centre lines.
 */
function studio(): Document {
  let doc = docOf({
    joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 5], ["J4", 0, 5], ["K1", 4, 0], ["K2", 4, 2], ["K3", 6, 2]],
    walls: [
      ["W1", "J1", "K1"], ["W2", "K1", "J2"], ["W3", "J2", "K3"], ["W4", "K3", "J3"], ["W5", "J3", "J4"], ["W6", "J4", "J1"],
      ["B1", "K1", "K2"], ["B2", "K2", "K3"],
    ],
  });
  doc = place(doc, { object: "sofa", kind: "sofaBed", at: [2, 4.9], state: "day", size: SOFA_BED_200 }); // y 4.0 … 4.9, x 1 … 3
  doc = place(doc, { object: "desk", kind: "desk", at: [1, 0.1], rotation: 180, state: "day" }); // y 0.1 … 0.7
  doc = place(doc, { object: "chair", kind: "chair", at: [1, 0.75], rotation: 180, state: "day" }); // y 0.75 … 1.2
  doc = place(doc, { object: "bed", kind: "bed", at: [2, 4.9], state: "night", size: BED_160x200 }); // y 2.9 … 4.9, x 1.2 … 2.8
  doc = place(doc, { object: "wardrobe", kind: "wardrobe", at: [5.9, 3.5], rotation: 270, state: "night" }); // x 5.3 … 5.9
  return doc;
}

const BED_HEIGHTS = { h: 1, z: 0 };

describe("placementFit", () => {
  const doc = studio();

  it("the studio is valid", () => {
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('a bed in the middle of a room fits; 5 cm into a wall is "wall"; overlapping a chair of the same layout is "object"; overlapping a chair of another layout fits; outside every room is "room"', () => {
    const bed = { kind: "bed", rotation: 0, config: "standard" };
    expect(placementFit(doc, { surface: null, ...bed, state: "day", at: { x: 2.5, y: 3.5 } })).toEqual({ fits: true, reason: null });
    // The bottom wall's inner face is at y = 0.1; a new bed is 2.1 m deep and anchored at its back edge.
    expect(placementFit(doc, { surface: null, ...bed, state: "night", at: { x: 2.5, y: 2.15 } })).toEqual({ fits: false, reason: "wall" });
    expect(placementFit(doc, { surface: null, ...bed, state: "night", at: { x: 2.5, y: 2.25 } })).toEqual({ fits: true, reason: null });
    const chair = { kind: "chair", rotation: 0, config: "standard", at: { x: 1.1, y: 1.3 } };
    expect(placementFit(doc, { surface: null, ...chair, state: "day" })).toEqual({ fits: false, reason: "object" });
    expect(placementFit(doc, { surface: null, ...chair, state: "night" })).toEqual({ fits: true, reason: null });
    expect(placementFit(doc, { surface: null, ...bed, state: "day", at: { x: 10, y: 10 } })).toEqual({ fits: false, reason: "room" });
  });

  it("an existing object added to another layout takes its own size; an unknown kind or configuration never fits", () => {
    const sofa = { object: "sofa", state: "night", rotation: 0, config: "sofa" };
    expect(placementFit(doc, { surface: null, ...sofa, at: { x: 2, y: 2.8 } })).toEqual({ fits: true, reason: null });
    expect(placementFit(doc, { surface: null, ...sofa, at: { x: 2, y: 3 } })).toEqual({ fits: false, reason: "object" }); // into the bed
    // 0.9 deep as a sofa, 1.6 deep as a bed: the bed reaches 5 cm into the bottom wall.
    expect(placementFit(doc, { surface: null, ...sofa, at: { x: 2, y: 1.65 } })).toEqual({ fits: true, reason: null });
    expect(placementFit(doc, { surface: null, ...sofa, config: "bed", at: { x: 2, y: 1.65 } })).toEqual({ fits: false, reason: "wall" });
    expect(placementFit(doc, { surface: null, kind: "piano", state: "day", at: { x: 2, y: 3 }, rotation: 0, config: "standard" }).fits).toBe(false);
    expect(placementFit(doc, { surface: null, kind: "bed", state: "day", at: { x: 2, y: 3 }, rotation: 0, config: "folded" }).fits).toBe(false);
  });

  it("footprintFit skips the placements it is told to ignore", () => {
    // The night bed's own footprint: x 1.2 … 2.8, y 2.9 … 4.9.
    const quad = footprintQuad({ x: 2, y: 4.9 }, 1.6, 2, 0);
    expect(footprintFit(doc, quad, "night", BED_HEIGHTS, null)).toEqual({ fits: false, reason: "object" });
    expect(footprintFit(doc, quad, "night", BED_HEIGHTS, null, ["bed/night"])).toEqual({ fits: true, reason: null });
    // In "day" the sofa (y 4.0 … 4.9) is in the way; without it the night bed doesn't count there.
    expect(footprintFit(doc, quad, "day", BED_HEIGHTS, null)).toEqual({ fits: false, reason: "object" });
    expect(footprintFit(doc, quad, "day", BED_HEIGHTS, null, ["sofa/day"])).toEqual({ fits: true, reason: null });
  });

  it("agrees with execute(placeObject) over a grid of positions (0.25 m steps) and angles 0°, 30°, 90°, 180° on a furnished studio with two layouts (AC-15)", () => {
    type Who = { kind: string } | { object: string };
    const who: [Who, string, string[]][] = [
      [{ kind: "bed" }, "standard", ["day", "night"]],
      [{ kind: "chair" }, "standard", ["day", "night"]],
      [{ kind: "desk" }, "standard", ["day", "night"]],
      [{ object: "sofa" }, "sofa", ["night"]],
    ];
    const seen = new Map<string, number>();
    const disagreements: string[] = [];
    for (const [w, config, states] of who) {
      for (const state of states) {
        for (const rotation of [0, 30, 90, 180]) {
          for (let i = 0; i < 28; i++) {
            for (let k = 0; k < 24; k++) {
              const at = { x: -0.4 + 0.25 * i, y: -0.4 + 0.25 * k };
              const fit = placementFit(doc, { surface: null, ...w, state, at, rotation, config });
              const object = "kind" in w ? { kind: w.kind } : { existing: w.object };
              const accepted = execute(doc, { type: "placeObject", deck: null, opId: "g", state, object, at, rotation, config }).ok;
              seen.set(String(fit.reason), (seen.get(String(fit.reason)) ?? 0) + 1);
              if (fit.fits !== accepted) disagreements.push(`${JSON.stringify(w)} ${state} ${rotation}° (${at.x}, ${at.y}): ${fit.reason}`);
            }
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
    for (const reason of ["null", "wall", "object", "room"]) expect(seen.get(reason) ?? 0).toBeGreaterThan(50);
  });
});

describe.skipIf(!PERF)("placementFit's speed, with FM_PERF=1", () => {
  it("on the 50 × 50 grid with 200 placements a call takes under 5 ms (median of 20)", () => {
    let big = grid(50);
    const states = ["s0", "day", "night"];
    for (let i = 0; i < 200; i++) {
      const x = (i * 7) % 50;
      const y = Math.floor((i * 7) / 50) % 50;
      big = place(big, { object: `c${i}`, kind: "chair", at: [x + 0.5, y + 0.725], state: states[i % 3] });
    }
    const candidate = (i: number) => ({ surface: null, kind: "chair", state: "day", at: { x: 10.5 + i, y: 20.725 }, rotation: 0, config: "standard" });
    expect(placementFit(big, candidate(0)).fits).toBe(true); // warm-up: rooms and wall bodies of the document
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      placementFit(big, candidate(i));
      times.push(performance.now() - t);
    }
    const median = [...times].sort((a, b) => a - b)[10] ?? Infinity;
    console.log(`50 × 50 grid, 200 placements: placementFit median ${median.toFixed(2)} ms`);
    expect(median).toBeLessThan(5);
  });
});
