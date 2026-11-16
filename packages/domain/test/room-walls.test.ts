import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import type { Document, Wall, WallSides } from "../src/model";
import { sidesOf } from "../src/wall-sides";

const wallSidesOf = (w: Wall | undefined): WallSides | undefined => (w ? sidesOf(w) : undefined);
import { roomWallSides } from "../src/queries/room-walls";
import { roomWallsOf } from "../src/wall-defaults";
import { docOf } from "./helpers";

// A room's walls (surfaces step 09, inherit.01): the sides facing a room, and its walls default stored on its label.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};

/**
 * An L-shaped room (five wall sides once the partition is counted from the other side) beside a hall: the L is
 * A(0,0) B(4,0) C(4,2) D(2,2) E(2,4) F(0,4), with a hall beyond the B–C wall, B(4,0) G(6,0) H(6,2) C(4,2); a free wall
 * stands inside the L from (0.5,1) to (1.5,1). Labels: "L" in the L, "Hall" in the hall.
 */
function lShaped(): Document {
  const doc = docOf({
    joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 2], ["D", 2, 2], ["E", 2, 4], ["F", 0, 4], ["G", 6, 0], ["H", 6, 2], ["P", 0.5, 1], ["Q", 1.5, 1]],
    walls: [["AB", "A", "B"], ["BC", "B", "C"], ["CD", "C", "D"], ["DE", "D", "E"], ["EF", "E", "F"], ["FA", "F", "A"], ["BG", "B", "G"], ["GH", "G", "H"], ["HC", "H", "C"], ["PQ", "P", "Q"]],
    labels: [["L", 1, 3, "L"], ["Hall", 5, 1, "Hall"]],
  });
  return doc;
}

const white = { ...motifDefaults("plain"), colour: "#f2f0eb" };
const subway = motifDefaults("subwayTiles");

describe("roomWallSides (step 09)", () => {
  it("lists every side facing the room: its six boundary walls and both sides of a free wall in it", () => {
    const sides = roomWallSides(lShaped(), "L");
    const walls = [...new Set(sides.map((s) => s.wallId))].sort();
    expect(walls).toEqual(["AB", "BC", "CD", "DE", "EF", "FA", "PQ"]);
    expect(sides.filter((s) => s.wallId === "PQ").map((s) => s.side).sort()).toEqual(["left", "right"]);
    expect(sides.filter((s) => s.wallId === "BC")).toHaveLength(1); // the partition's other side faces the hall
  });

  it("an unknown label lists nothing", () => {
    expect(roomWallSides(lShaped(), "nope")).toEqual([]);
  });
});

describe("setRoomWallFinishes (step 09, AC-03)", () => {
  it("stores the room's walls default on its label and writes no wall (inherit.01)", () => {
    const doc0 = lShaped();
    const doc = run(run(doc0, { type: "setRoomWallFinishes", labelId: "L", part: "finish", finish: white }),
      { type: "setRoomWallFinishes", labelId: "L", part: "lower", finish: subway, height: 1.2 });
    expect(roomWallsOf(doc.zoneLabels.L!)).toEqual({ finish: white, lower: { finish: subway, height: 1.2 } });
    expect(doc.walls).toEqual(doc0.walls);
    expect(doc.zoneLabels.Hall).toEqual(doc0.zoneLabels.Hall);
  });

  it("one command's patch writes the label only, so one undo removes it", () => {
    const r = execute(lShaped(), { type: "setRoomWallFinishes", labelId: "L", part: "finish", finish: white });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.puts.map((p) => `${p.table} ${p.entity.id}`)).toEqual(["zoneLabels L"]);
  });

  it("refuses a floor-only motif and a band height out of range; an unknown label is not found", () => {
    const refusal = (cmd: Command) => {
      const r = execute(lShaped(), cmd);
      return r.ok ? "accepted" : r.error.message;
    };
    expect(refusal({ type: "setRoomWallFinishes", labelId: "L", part: "finish", finish: motifDefaults("herringbone") })).toMatch(/^finish.motif must be a wall motif/);
    expect(refusal({ type: "setRoomWallFinishes", labelId: "L", part: "lower", finish: subway, height: 4 })).toBe("height must be 0.10–3.00");
    expect(refusal({ type: "setRoomWallFinishes", labelId: "nope", part: "finish", finish: white })).toBe("Zone not found");
  });

  it("a wall drawn later in a finished room stores no custom finish: it shows the room's (inherit.01)", () => {
    const finished = run(lShaped(), { type: "setRoomWallFinishes", labelId: "L", part: "finish", finish: white });
    const later = run(finished, { type: "addWall", opId: "late", from: { at: { x: 0.5, y: 3 } }, to: { at: { x: 1.5, y: 3 } } });
    expect(wallSidesOf(later.walls["late/w0"])).toBeUndefined();
  });
});
