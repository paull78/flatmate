import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// A stair's options with two editors and the real server (steps.07, AC-04, AC-07): a winder's "Enters from the left"
// and a rung ladder's "Hooks" are one object edit each, through setOption or setStair, and converge.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";
const optionsOf = (c: Client, id: string) => c.shell.doc().objects[id]?.options;

describe("stair options with two editors", () => {
  it("Enters from the left by setOption and Hooks by setStair converge; both at once from two clients too", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    // The shared room's inner faces run to y 3.9: the 3.07 m winder's back edge at y 3.8, the ladder beside it.
    run(alice, { type: "placeObject", deck: null, opId: "w", state: firstState(alice), object: { kind: "winderStair" }, at: { x: 2, y: 3.8 } });
    await net.settle(); // one edit at a time per client
    run(alice, { type: "placeObject", deck: null, opId: "l", state: firstState(alice), object: { kind: "rungLadder" }, at: { x: 4, y: 3.8 } });
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(Object.keys(bob.shell.doc().objects).sort()).toEqual(["l/o0", "w/o0"]);

    run(alice, { type: "setOption", objectId: "w/o0", option: "leftEntry", on: true });
    run(bob, { type: "setStair", objectId: "l/o0", hooks: true });
    await net.settle();
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    expect(optionsOf(bob, "w/o0")).toEqual({ leftEntry: true });
    expect(optionsOf(alice, "l/o0")).toEqual({ hooks: true });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
