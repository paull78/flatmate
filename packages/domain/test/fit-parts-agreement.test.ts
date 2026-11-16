import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Document } from "../src/model";
import { pointInPolygon } from "../src/geometry";
import { placementFit } from "../src/queries/fit";
import { footprintQuad, quadCentre } from "../src/queries/footprints";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// The agreement test for fit by parts (catalog.16, as heights.30's fuzz): over a grid of places around two corner
// desks, placementFit says what execute accepts, and both let a box stand in an empty quarter (a chair may tuck there
// anyway, so only boxes count).

/**
 * A 4 × 3 room with a corner desk in its top-left corner (x 0.1–1.7, y 1.7–2.9; empty quarter x 0.7–1.7, y 1.7–2.3),
 * one turned 180° in its bottom-right corner (x 2.3–3.9, y 0.1–1.3; empty quarter x 2.3–3.3, y 0.7–1.3), and a 0.40
 * box at x 3.0–3.4, y 1.9–2.3, which a new corner desk against the top wall may stand around.
 */
function twoDesks(): Document {
  const doc = place(rectDoc(0, 0, 4, 3), { object: "d1", kind: "cornerDesk", at: [0.9, 2.9] });
  const box = { w: { standard: 0.4 }, d: { standard: 0.4 } };
  return place(place(doc, { object: "d2", kind: "cornerDesk", at: [3.1, 0.1], rotation: 180 }), { object: "box", kind: "block", at: [3.2, 2.3], size: box });
}
const BOX_CENTRE = { x: 3.2, y: 2.1 };

/**
 * The half of each empty quarter inside the hull of the desk's outline: a piece centred there fits only by parts (one
 * read through its outline, or its hull, is refused).
 */
const QUARTERS: readonly Point[][] = [
  [{ x: 0.7, y: 1.7 }, { x: 1.7, y: 2.3 }, { x: 0.7, y: 2.3 }],
  [{ x: 3.3, y: 1.3 }, { x: 2.3, y: 0.7 }, { x: 3.3, y: 0.7 }],
];
const inQuarter = (c: Point): boolean => QUARTERS.some((q) => pointInPolygon(c, q));

describe("fit by parts agrees with validation", () => {
  it("placementFit and execute agree for chairs, boxes and corner desks on a grid around two corner desks", () => {
    const doc = twoDesks();
    expect(validateDocument(doc).ok).toBe(true);
    const disagreements: string[] = [];
    const seen = { fits: 0, quarter: 0, around: 0, object: 0, wall: 0 };
    for (const { kind, w, d } of [{ kind: "chair", w: 0.45, d: 0.45 }, { kind: "block", w: 0.4, d: 0.4 }, { kind: "cornerDesk", w: 1.6, d: 1.2 }]) {
      for (let i = 0; i <= 28; i++) {
        for (let j = 0; j <= 21; j++) {
          for (const rotation of [0, 90, 180, 270, 30]) {
            const at = { x: Math.round((-0.1 + 0.15 * i) * 100) / 100, y: Math.round((-0.1 + 0.15 * j) * 100) / 100 };
            const fit = placementFit(doc, { surface: null, kind, state: "s0", at, rotation, config: "standard", w, d });
            const accepted = execute(doc, { type: "placeObject", deck: null, opId: "g", state: "s0", object: { kind, size: { w, d } }, at, rotation }).ok;
            if (fit.fits !== accepted) disagreements.push(`${kind} ${rotation}° (${at.x}, ${at.y}): ${fit.reason}`);
            if (fit.fits) seen.fits++;
            if (fit.fits && kind === "block" && inQuarter(quadCentre(footprintQuad(at, w, d, rotation)) ?? at)) seen.quarter++;
            if (fit.fits && kind === "cornerDesk" && pointInPolygon(BOX_CENTRE, footprintQuad(at, w, d, rotation))) seen.around++;
            if (fit.reason === "object") seen.object++;
            if (fit.reason === "wall") seen.wall++;
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(seen.quarter).toBeGreaterThanOrEqual(10); // some boxes stand in an empty quarter, inside the outline's hull
    expect(seen.around).toBeGreaterThanOrEqual(1); // a new corner desk stands around the box
    expect(seen.object).toBeGreaterThanOrEqual(100);
    expect(seen.wall).toBeGreaterThanOrEqual(100);
    expect(seen.fits).toBeGreaterThanOrEqual(100);
  });
});
