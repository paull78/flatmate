import { describe, expect, it } from "vitest";
import { motifDefaults, withMotif } from "@fm/domain";
import { Net, sharedRoom } from "./net";

// Floor finishes through the real server (finishes.14; AC-10): a finish is a label edit, so it travels, is undone and
// conflicts like a rename.

const CONFLICT = "Someone else changed this first";

/** Alice and Bob share the sample room; Alice labels it "Living". */
async function livingRoom() {
  const net = new Net();
  const { alice, bob } = await sharedRoom(net);
  alice.shell.command({ type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Living", finish: null });
  await net.settle();
  expect(bob.shell.doc().zoneLabels["L1"]?.finish).toBeNull();
  return { net, alice, bob };
}

describe("floor finishes with two editors (AC-10)", () => {
  it("a finish set by one editor reaches the other; removing it and undo travel too", async () => {
    const { net, alice, bob } = await livingRoom();
    const planks = { ...motifDefaults("planks"), colour: "#d8bc94" };
    alice.shell.command({ type: "setFinish", id: "L1", finish: planks });
    await net.settle();
    expect(bob.shell.doc().zoneLabels["L1"]?.finish).toEqual(planks);

    bob.shell.command({ type: "setFinish", id: "L1", finish: null });
    await net.settle();
    expect(alice.shell.doc().zoneLabels["L1"]?.finish).toBeNull();

    bob.shell.key("z", { ctrl: true });
    await net.settle();
    expect(alice.shell.doc().zoneLabels["L1"]?.finish).toEqual(planks);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("two finishes on one label at once: the second is a conflict, and both converge on the first", async () => {
    const { net, alice, bob } = await livingRoom();
    const mosaic = motifDefaults("mosaic");
    alice.shell.command({ type: "setFinish", id: "L1", finish: mosaic });
    bob.shell.command({ type: "setFinish", id: "L1", finish: withMotif(null, "largeTiles") });
    alice.pump(); // Alice's arrives first
    bob.pump();
    await net.settle();
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, CONFLICT]);
    expect(alice.shell.doc().zoneLabels["L1"]?.finish).toEqual(mosaic);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
