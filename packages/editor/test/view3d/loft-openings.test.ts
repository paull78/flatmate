import { describe, expect, it } from "vitest";
import { motifDefaults, type Document } from "@fm/domain";
import type { Face3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { STYLE_3D } from "../../src/view3d/style";
import type { WallItem } from "../../src/view3d/types";
import { wallFaces } from "../../src/view3d/wall-faces";
import { LOFT_ROOM_LOFT, loftRoomDoc, withCommands } from "../builders";

// A door on a loft's wall in 3D (sills step 06, AC-10; sills.03): its hole starts at the loft's top, and its threshold
// shows the loft's top (the deck's colour, or its finish), not the floor, as a loft has no rooms. loftRoomDoc's loft at
// 2.15 over x 1.3–3.7, y 1.4–3.8, under a ceiling raised to 4.20; a wall along y 2.6 on it from x 1.6 to 3.4.

function loftDoor(): Document {
  return withCommands(loftRoomDoc(), { type: "setCeiling", height: 4.2 },
    { type: "addWall", opId: "k", from: { at: { x: 1.6, y: 2.6 } }, to: { at: { x: 3.4, y: 2.6 } }, base: LOFT_ROOM_LOFT },
    { type: "addOpening", opId: "d", wall: "k/w0", kind: "swing", offset: 0.5 });
}
const loftWall = (doc: Document, finishes = false): WallItem => {
  const item = view3dItems(doc, "s0", null, new Set(), finishes).find((i): i is WallItem => i.item === "wall" && i.wall === "k/w0");
  if (!item) throw new Error("no loft wall");
  return item;
};
const thresholds = (item: WallItem): Face3d[] =>
  wallFaces("wall/k/w0", item, STYLE_3D).filter((f) => f.points.every((p) => Math.abs(p.z - 2.15) < 1e-9));

describe("a door on a loft's wall in 3D (sills step 06)", () => {
  it("stands on the loft's top: its range runs 2.15 to 4.10", () => {
    const item = loftWall(loftDoor());
    expect(item.bottom).toBeCloseTo(2.15, 9);
    expect(item.openings.map((o) => [o.bottom, o.top])).toEqual([[2.15, 4.1]]);
  });

  it("its threshold shows the loft's top, in the deck's colour, or the loft's finish with finishes on", () => {
    expect(thresholds(loftWall(loftDoor())).map((f) => f.color)).toEqual([STYLE_3D.deck.top]);
    const planks = withCommands(loftDoor(), { type: "setDeckFinish", deckId: LOFT_ROOM_LOFT, finish: motifDefaults("planks") });
    expect(thresholds(loftWall(planks, true)).map((f) => f.color)).toContain(motifDefaults("planks").colour);
  });
});
