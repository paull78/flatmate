import { describe, expect, it } from "vitest";
import { clearanceWarnings, zoneBlocks } from "../src/queries/clearance";
import type { Document } from "../src/model";
import { BED_160x200, docOf, place, rectDoc, withOpening } from "./helpers";

// Who blocks each zone (clarity.09): one query, read by MCP's get_drawing and the editor's shown warnings.

const SMALL = { w: { standard: 0.1 }, d: { standard: 0.1 } };

/** A 6 × 4 room with a wardrobe on the top wall (x 2.4–3.6, y 3.3–3.9) and two small pieces in its front zone. */
function wardrobeWithTwo(): Document {
  let doc = place(rectDoc(0, 0, 6, 4), { object: "w", kind: "wardrobe", at: [3, 3.9] });
  doc = place(doc, { object: "z", kind: "block", at: [2.7, 3.2], size: SMALL });
  return place(doc, { object: "a", kind: "block", at: [3.3, 3.2], size: SMALL });
}

const front = (id: string) => ({ table: "placements", id, side: "front" }) as const;

describe("zoneBlocks", () => {
  it("groups a zone's blockers in clearanceWarnings' order", () => {
    const doc = wardrobeWithTwo();
    expect(zoneBlocks(doc, "s0")).toEqual([{
      zone: front("w/s0"),
      blockers: [
        { kind: "piece", placement: "a/s0", object: "a", name: "Custom box" },
        { kind: "piece", placement: "z/s0", object: "z", name: "Custom box" },
      ],
    }]);
    expect(clearanceWarnings(doc, "s0").map((w) => w.against.id)).toEqual(["a/s0", "z/s0"]);
  });

  it("names a piece, collapses several walls to one, tells a column from a wall", () => {
    // A desk facing the corner at (0, 0): its front zone crosses walls W1 and W4, a column W1c between them in ID order, and a box.
    const room = docOf({
      joints: [["J1", 0, 0], ["J2", 4, 0], ["J3", 4, 5], ["J4", 0, 5], ["Ka", 0.55, 0.25], ["Kb", 0.75, 0.25]],
      walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
      columns: [["W1c", "Ka", "Kb", 0.1]],
    });
    const doc = place(place(room, { object: "d", kind: "desk", at: [1, 1], rotation: 315 }), { object: "b", kind: "block", at: [0.45, 0.6], size: SMALL });
    expect(clearanceWarnings(doc, "s0").map((w) => w.against.id)).toEqual(["b/s0", "W1", "W1c", "W4"]);
    expect(zoneBlocks(doc, "s0")).toEqual([{
      zone: front("d/s0"),
      blockers: [{ kind: "piece", placement: "b/s0", object: "b", name: "Custom box" }, { kind: "wall" }, { kind: "column", id: "W1c" }],
    }]);
  });

  it("a door's swing is a zone", () => {
    // A door on W1 at x 1–1.8, swinging up into the room, with a small box in its swing.
    const doc = place(withOpening(rectDoc(0, 0, 6, 4), { id: "D", wall: "W1", offset: 1 }), { object: "b", kind: "block", at: [1.4, 0.5], size: SMALL });
    expect(zoneBlocks(doc, "s0")).toEqual([{ zone: { table: "openings", id: "D" }, blockers: [{ kind: "piece", placement: "b/s0", object: "b", name: "Custom box" }] }]);
  });

  it("two sides of a piece are two zones", () => {
    // A bed (x 2.2–3.8, y 1.9–3.9): one small box in its left zone, one in its right.
    let doc = place(rectDoc(0, 0, 6, 4), { object: "bed", kind: "bed", at: [3, 3.9], size: BED_160x200 });
    doc = place(doc, { object: "l", kind: "block", at: [2, 3], size: SMALL });
    doc = place(doc, { object: "r", kind: "block", at: [4, 3], size: SMALL });
    expect(zoneBlocks(doc, "s0").map((b) => [b.zone, b.blockers.length])).toEqual([[{ table: "placements", id: "bed/s0", side: "left" }, 1], [{ table: "placements", id: "bed/s0", side: "right" }, 1]]);
  });

  it("a clear plan has no block", () => {
    expect(zoneBlocks(rectDoc(0, 0, 6, 4), "s0")).toEqual([]);
  });
});
