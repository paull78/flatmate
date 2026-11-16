import { describe, expect, it } from "vitest";
import { levelOf } from "@fm/domain";
import { pieceFit, type Piece } from "../src/snapping/piece";
import { loftRoomDoc, roomDoc } from "./builders";

// The Object tool's preview for a beam (beams.05; AC-02): a beam's ghost across the room into both walls fits, as the
// domain accepts it; a block's ghost there doesn't. roomDoc: a 6 × 4 room, inner faces x 0.1 / 5.9, y 0.1 / 3.9.

describe("a beam's ghost", () => {
  it("across the room, into both side walls, fits; a block's of the same size doesn't", () => {
    const doc = roomDoc();
    const level = levelOf(doc, null);
    const beam: Piece = { kind: "beam", config: "standard", riser: null, heights: { h: 0.2, z: "ceiling" }, land: true, current: undefined, level };
    const size = { w: 6.2, d: 0.15 };
    expect(pieceFit(doc, "s0", beam, size, { x: 3, y: 2 }, 0).fits).toBe(true);
    expect(pieceFit(doc, "s0", { ...beam, kind: "block" }, size, { x: 3, y: 2 }, 0).fits).toBe(false);
  });

  it("straddling a loft's edge under a 3.05 m ceiling, it fits, hung from the loft's underside (beams.06)", () => {
    // loftRoomDoc: a Loft (underside 2.03) at x 1.3–3.7, y 1.4–3.8; the beam at y 1.30–1.45 across the room.
    const doc = loftRoomDoc();
    const beam: Piece = { kind: "beam", config: "standard", riser: null, heights: { h: 0.2, z: "ceiling" }, land: true, current: undefined, level: levelOf(doc, null) };
    expect(pieceFit(doc, "s0", beam, { w: 6.2, d: 0.15 }, { x: 3, y: 1.45 }, 0).fits).toBe(true);
  });
});
