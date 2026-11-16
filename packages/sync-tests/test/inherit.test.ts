import { describe, expect, it } from "vitest";
import { motifDefaults, outsideOf, roomWallsOf, sidesOf, type Document } from "@fm/domain";
import { Net, sharedRoom } from "./net";

// Inherited wall finishes through the real server (inherit step 01, AC-11): a room's walls default on its label, the
// house's outside default on the ceiling row and a custom side on its wall each travel as one edit, never conflicting
// with each other, and the server accepts every row (inherit.01, .07).

const CONFLICT = "Someone else changed this first";
const sage = { ...motifDefaults("plain"), colour: "#a8b59a" };
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };
const subway = motifDefaults("subwayTiles");
const planks = motifDefaults("widePlanks");

const bottomWall = (doc: Document): string => {
  const id = Object.values(doc.walls).find((w) => doc.joints[w.a]?.y === 0 && doc.joints[w.b]?.y === 0)?.id;
  if (!id) throw new Error("no bottom wall");
  return id;
};

describe("inherited wall finishes with two editors (AC-11)", () => {
  it("a room's default, the outside default and a custom side all reach the other editor", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Bath", finish: null });
    await net.settle();
    alice.shell.command({ type: "setRoomWallFinishes", labelId: "L1", part: "lower", finish: subway, height: 1.2 });
    await net.settle();
    alice.shell.command({ type: "setOutsideFinish", part: "finish", finish: planks });
    await net.settle();
    const wall = bottomWall(bob.shell.doc());
    bob.shell.command({ type: "setWallSide", wallId: wall, side: "left", finish: navy, lower: subway, height: 0.9 });
    await net.settle();
    for (const doc of [alice.shell.doc(), bob.shell.doc()]) {
      expect(roomWallsOf(doc.zoneLabels.L1!)).toEqual({ finish: null, lower: { finish: subway, height: 1.2 } });
      expect(outsideOf(doc)).toEqual({ finish: planks, lower: null });
      expect(sidesOf(doc.walls[wall]!)?.left).toEqual({ finish: navy, lower: { finish: subway, height: 0.9 } });
    }
    expect(alice.shell.view().toast).not.toBe(CONFLICT);
    expect(bob.shell.view().toast).not.toBe(CONFLICT);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a room repainted while the other editor customises one of its walls: both kept, no conflict", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Bath", finish: null });
    await net.settle();
    const wall = bottomWall(alice.shell.doc());
    alice.shell.command({ type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: sage });
    bob.shell.command({ type: "setWallSide", wallId: wall, side: "left", finish: navy, lower: null });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(bob.shell.view().toast).not.toBe(CONFLICT);
    expect(alice.shell.doc().zoneLabels.L1?.walls).toEqual(sage);
    expect(sidesOf(alice.shell.doc().walls[wall]!)?.left?.finish).toEqual(navy);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("Reset travels, and its undo brings the custom side back", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const wall = bottomWall(alice.shell.doc());
    alice.shell.command({ type: "setWallSide", wallId: wall, side: "right", finish: navy, lower: null });
    await net.settle();
    alice.shell.command({ type: "resetWallSide", wallId: wall, side: "right" });
    await net.settle();
    expect(sidesOf(bob.shell.doc().walls[wall]!)).toBeUndefined();
    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(sidesOf(bob.shell.doc().walls[wall]!)?.right?.finish).toEqual(navy);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
