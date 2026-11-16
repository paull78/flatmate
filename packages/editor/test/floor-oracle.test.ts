import { describe, expect, it } from "vitest";
import { wallOutlines, type Document } from "@fm/domain";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import { wallsLayer } from "../src/view/walls-layer";
import { FLOOR_ORACLE } from "./floor-oracle-hashes";
import { floorHash, hasBelowCutShare, hasTakenJoint, randomFloor } from "./random-floors";

// The floor oracle (cleanup.04, .14; AC-03): a wall below the cut takes its joint share only at a joint of three or
// more walls with two or more filled walls, and one filled wall takes an L or a T (mitres.01). Every other random floor
// draws its walls and ghosts byte for byte as at the cleanup cycle's start, on the canvas and on paper: the stored hashes
// aren't regenerated, so a fill drawn anywhere else fails here.

/** The filled areas that aren't a wall's own outline. */
function addedFills(doc: Document): (readonly { x: number; y: number }[])[] {
  const outlines = new Set([...wallOutlines(doc).values()]);
  const layer = wallsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, "", null, "", null);
  return layer.flatMap((p) => (p.kind === "polygon" && !outlines.has(p.points) ? [p.points] : []));
}

describe("the floor oracle", () => {
  it("every fill the rule adds lies within half a metre of a joint it covers", () => {
    let seen = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const doc = randomFloor(seed);
      if (hasBelowCutShare(doc) || !hasTakenJoint(doc)) continue;
      const joints = Object.values(doc.joints);
      for (const fill of addedFills(doc)) {
        seen += 1;
        const close = joints.some((j) => fill.every((p) => Math.hypot(p.x - j.x, p.y - j.y) < 0.5));
        expect(close, `seed ${seed}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("random floors without a below-cut wall at a shared joint draw their walls as at the cycle's start", () => {
    let excluded = 0;
    let taken = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const doc = randomFloor(seed);
      if (hasBelowCutShare(doc)) {
        excluded++;
        expect(FLOOR_ORACLE[seed], `seed ${seed} is left out`).toBeUndefined();
        continue;
      }
      if (hasTakenJoint(doc)) {
        taken++;
        expect(floorHash(doc), `seed ${seed} changes`).not.toBe(FLOOR_ORACLE[seed]); // the probe sees the rule
        continue;
      }
      expect(floorHash(doc), `seed ${seed}`).toBe(FLOOR_ORACLE[seed]);
    }
    // The probe can see the change: the left-out floors are the ones it alters (393 of 600 when generated).
    expect(excluded).toBeGreaterThan(100);
    expect(taken).toBeGreaterThan(10);
    expect(Object.keys(FLOOR_ORACLE)).toHaveLength(600 - excluded);
  });
});
