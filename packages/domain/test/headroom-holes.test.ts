import { describe, expect, it } from "vitest";
import { anchorAt } from "../src/queries/footprints";
import { stairChecks } from "../src/queries/stair-checks";
import type { Document } from "../src/model";
import { LOFT, notchedCabin, run } from "./cabin";

// Headroom reads the slab (stairwell.21; AC-06): a ship's ladder in the notch has the ceiling's 1.14 over it (3.05 less
// the pitch line at its last nosing, 1.911); on a document built by hand with no notch over it, the slab's 0.12.

const withLadder = (): Document => run(notchedCabin(), { type: "placeObject", opId: "lad", state: "s0", object: { kind: "shipsLadder" }, at: anchorAt({ x: 1.95, y: 2.6 }, 1.1, 90), rotation: 90, deck: null, reaches: LOFT });
const headroom = (doc: Document): number | undefined => {
  const c = stairChecks(doc, "lad/o0").find((x) => x.id === "headroom");
  return c && "value" in c ? Math.round(c.value * 100) / 100 : undefined;
};

describe("headroom through a hole (AC-06)", () => {
  it("in the notch: 1.14 against the ceiling; under the slab (built by hand): 0.12", () => {
    const doc = withLadder();
    expect(headroom(doc)).toBe(1.14);
    expect(headroom({ ...doc, deckHoles: {} })).toBe(0.12);
  });
});
