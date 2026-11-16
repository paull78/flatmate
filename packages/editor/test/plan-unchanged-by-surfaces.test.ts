import { describe, expect, it } from "vitest";
import { motifDefaults, roomWallSides, sideFinishes, type Command, type Document } from "@fm/domain";
import { CANVAS_STYLE, PRESENTATION_STYLE, planPicture } from "../src/view/picture";
import { floorView } from "../src/view/plan-view";
import { labelledDoc, withCommands } from "./builders";

// The plan shows no wall or roof finish (surfaces.07, AC-08): finishing every wall side and the roof leaves the plan's
// picture, on screen and on paper, exactly as it was. (PNG and SVG are drawn from this picture.)

/** Every side of every wall facing a room or not, in subway tiles to 1.20 under brick; a gable with standing seam. */
function finished(doc: Document): Document {
  const cmds: Command[] = [];
  for (const label of ["L1", "L2"]) {
    cmds.push({ type: "setRoomWallFinishes", labelId: label, part: "finish", finish: motifDefaults("brick") });
    cmds.push({ type: "setRoomWallFinishes", labelId: label, part: "lower", finish: motifDefaults("subwayTiles"), height: 1.2 });
  }
  for (const w of Object.keys(doc.walls)) for (const side of ["left", "right"] as const) {
    if (!roomWallSides(doc, "L1").some((s) => s.wallId === w && s.side === side) && !roomWallSides(doc, "L2").some((s) => s.wallId === w && s.side === side)) {
      cmds.push({ type: "setWallFinish", wallId: w, side, part: "finish", finish: motifDefaults("corrugated") });
    }
  }
  cmds.push({ type: "setRoofCovering", finish: motifDefaults("standingSeam") }, { type: "setOutsideFinish", part: "lower", finish: motifDefaults("brick"), height: 0.6 });
  return withCommands(doc, ...cmds);
}

describe("the plan is unchanged by wall and roof finishes (step 16, AC-08)", () => {
  it("on screen and on paper, with floor finishes on and off", () => {
    const before = withCommands(labelledDoc(), { type: "setCeiling", shape: "gable" });
    const after = finished(before);
    expect(Object.keys(after.walls).every((w) => { const s = sideFinishes(after, w); return s?.left && s.right; })).toBe(true); // every side shows a finish (inherit.01)
    for (const style of [CANVAS_STYLE, PRESENTATION_STYLE]) {
      for (const floors of [true, false]) {
        expect(planPicture(after, floorView(after, "s0"), style, 40, floors)).toEqual(planPicture(before, floorView(before, "s0"), style, 40, floors));
      }
    }
  });
});
