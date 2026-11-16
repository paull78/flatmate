import { describe, expect, it } from "vitest";
import { CEILING_ID, motifDefaults, sidesOf, type Document } from "@fm/domain";
import { Net, sharedRoom } from "./net";

// Wall and roof finishes through the real server (surfaces step 15, AC-10): a side's finish is a wall edit, a room's
// walls default a label edit (inherit.01), the covering a ceiling edit; each travels, is undone and conflicts like any.

const CONFLICT = "Someone else changed this first";
const sage = { ...motifDefaults("plain"), colour: "#a8b59a" };
const tiles = motifDefaults("squareTiles");

/** The bottom wall of the shared room (y 0). */
const bottomWall = (doc: Document): string => {
  const id = Object.values(doc.walls).find((w) => doc.joints[w.a]?.y === 0 && doc.joints[w.b]?.y === 0)?.id;
  if (!id) throw new Error("no bottom wall");
  return id;
};
const sides = (doc: Document, wall: string) => {
  const w = doc.walls[wall];
  return w ? sidesOf(w) : undefined;
};

describe("wall and roof finishes with two editors (AC-10)", () => {
  it("a side's finish and band set by one editor reach the other; undo travels too", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const wall = bottomWall(alice.shell.doc());
    alice.shell.command({ type: "setWallFinish", wallId: wall, side: "left", part: "finish", finish: sage });
    await net.settle(); // one outstanding edit at a time
    alice.shell.command({ type: "setWallFinish", wallId: wall, side: "left", part: "lower", finish: tiles, height: 1.2 });
    await net.settle();
    expect(sides(bob.shell.doc(), wall)?.left).toEqual({ finish: sage, lower: { finish: tiles, height: 1.2 } });
    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(sides(bob.shell.doc(), wall)?.left).toEqual({ finish: sage, lower: null });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a room's walls default reaches the other editor as one label edit (inherit.01)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Bath", finish: null });
    await net.settle();
    alice.shell.command({ type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: sage });
    await net.settle();
    expect(bob.shell.doc().zoneLabels.L1?.walls).toEqual(sage);
    bob.shell.key("z", { ctrl: true }); // Bob didn't make it: his undo does nothing to Alice's
    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(bob.shell.doc().zoneLabels.L1?.walls).toBeUndefined();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a finish on a wall another editor has just deleted is refused for its sender, and neither shows it", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const wall = bottomWall(alice.shell.doc());
    alice.shell.command({ type: "deleteEntities", ids: [{ table: "walls", id: wall }] });
    bob.shell.command({ type: "setWallFinish", wallId: wall, side: "left", part: "finish", finish: sage });
    alice.pump(); // Alice's arrives first
    bob.pump();
    await net.settle();
    expect(bob.shell.view().toast).toBe(CONFLICT);
    for (const doc of [alice.shell.doc(), bob.shell.doc()]) expect(doc.walls[wall]).toBeUndefined();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a room's walls set while the other editor moves one of them: no conflict, both end the same (inherit.01)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Bath", finish: null });
    await net.settle();
    const wall = bottomWall(alice.shell.doc());
    const joint = alice.shell.doc().walls[wall]?.a ?? "";
    const at = alice.shell.doc().joints[joint];
    if (!at) throw new Error("no joint");
    alice.shell.command({ type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: sage });
    bob.shell.command({ type: "moveJoints", moves: [{ jointId: joint, to: { x: at.x - 0.5, y: at.y } }] });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(bob.shell.view().toast).not.toBe(CONFLICT);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.doc().zoneLabels.L1?.walls).toEqual(sage);
  });

  it("the roof's covering travels like a ceiling edit", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "setCeiling", shape: "gable" });
    await net.settle();
    alice.shell.command({ type: "setRoofCovering", finish: motifDefaults("standingSeam") });
    await net.settle();
    expect(bob.shell.doc().ceilings[CEILING_ID]?.covering).toEqual(motifDefaults("standingSeam"));
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
