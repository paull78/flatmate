import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Object options with two editors and the real server (spec "Round chairs", AC-05; library.10): "With computer" and
// "Round chairs" are object edits through `setOption`, so each travels as one changed object row and is undone through
// the editor's history.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";
const optionsOf = (c: Client, id: string) => c.shell.doc().objects[id]?.options;

describe("object options with two editors", () => {
  it("setOption converges on two clients; undo restores (the computer)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "placeObject", deck: null, opId: "desk", state: firstState(alice), object: { kind: "desk" }, at: { x: 3, y: 3.9 } });
    await net.settle();
    expect(optionsOf(bob, "desk/o0")).toBeUndefined();

    run(bob, { type: "setOption", objectId: "desk/o0", option: "computer", on: true });
    await net.settle();
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    expect(optionsOf(alice, "desk/o0")).toEqual({ computer: true });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());

    bob.shell.key("z", { ctrl: true });
    await net.settle();
    expect(optionsOf(alice, "desk/o0")).toBeUndefined();
    expect(optionsOf(bob, "desk/o0")).toBeUndefined();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("setOption converges on two clients; undo restores (round chairs)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "placeObject", deck: null, opId: "set", state: firstState(alice), object: { kind: "seatedDining" }, at: { x: 3, y: 3.9 } });
    await net.settle();

    run(alice, { type: "setOption", objectId: "set/o0", option: "roundChairs", on: true });
    await net.settle();
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    expect(optionsOf(bob, "set/o0")).toEqual({ roundChairs: true });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());

    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(optionsOf(alice, "set/o0")).toBeUndefined();
    expect(optionsOf(bob, "set/o0")).toBeUndefined();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});

describe("Break apart with two editors (AC-07)", () => {
  it("a second client sees it as one change, and undo restores the set on both", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "placeObject", deck: null, opId: "set", state: firstState(alice), object: { kind: "deskSet" }, at: { x: 3, y: 2.5 } });
    await net.settle();
    const before = bob.shell.doc();
    const placement = "set/p0";
    expect(before.placements[placement]).toBeDefined();
    run(alice, { type: "placePieces", opId: "b", remove: "set/o0", pieces: [{ kind: "chair", placements: [{ state: firstState(alice), at: { x: 3, y: 2.5 }, rotation: 0, deck: null }] }] });
    await net.settle();
    expect(bob.shell.doc().objects["set/o0"]).toBeUndefined();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(bob.shell.doc()).toEqual(before);
    expect(alice.shell.doc()).toEqual(before);
  });
});

