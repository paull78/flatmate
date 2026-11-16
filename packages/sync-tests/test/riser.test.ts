import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// A typed riser between two editors and the real server app (AC-10): both hold the same row, undo restores it for both,
// and two edits on one stair at once settle with both clients equal.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const ID = "st/o0";

async function withStair(net: Net): Promise<{ alice: Client; bob: Client }> {
  const { alice, bob } = await sharedRoom(net);
  run(alice, { type: "setCeiling", height: 3.05 });
  await net.settle();
  run(alice, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 5, y: 2 }, w: 1.8, d: 3.6 });
  await net.settle();
  const state = Object.keys(alice.shell.doc().states)[0] ?? "";
  run(alice, { type: "placeObject", opId: "st", state, object: { kind: "stair", size: { w: 0.9, d: 2.8 } }, at: { x: 4.1, y: 2 }, rotation: 270, deck: null, reaches: "loft/k0" });
  await net.settle();
  expect(Object.keys(bob.shell.doc().objects)).toEqual([ID]);
  return { alice, bob };
}

describe("a typed riser with two editors (AC-10)", () => {
  it("reaches the other client, and undo restores it for both", async () => {
    const net = new Net();
    const { alice, bob } = await withStair(net);
    const before = alice.shell.doc();
    run(alice, { type: "setStair", objectId: ID, riser: 0.16 });
    await net.settle();
    expect(bob.shell.doc().objects[ID]?.riser).toBe(0.16);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    alice.shell.ui({ type: "undo" });
    await net.settle();
    expect(alice.shell.doc()).toEqual(before);
    expect(bob.shell.doc()).toEqual(before);
    expect(Object.keys(bob.shell.doc().objects[ID] ?? {})).not.toContain("riser");
    expect(net.fatal).toEqual([]);
  });

  it("settles a riser and a going sent at once, one refused, both clients equal", async () => {
    const net = new Net();
    const { alice, bob } = await withStair(net);
    run(alice, { type: "setStair", objectId: ID, riser: 0.16 });
    run(bob, { type: "setStair", objectId: ID, going: 0.2 });
    await net.settle();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    const o = alice.shell.doc().objects[ID];
    if (!o) throw new Error("no stair");
    expect((o.riser === 0.16 && o.d.standard === 2.8) || (o.riser === undefined && o.d.standard !== 2.8)).toBe(true); // one won, whole

  });

  it("keeps a target for someone joining after a restart", async () => {
    const net = new Net();
    const { alice } = await withStair(net);
    run(alice, { type: "setStair", objectId: ID, riser: 0.16 });
    await net.settle();
    const held = alice.shell.doc();
    net.restart();
    await net.settle();
    const carol = net.join("Carol");
    await net.settle();
    carol.shell.ui({ type: "openProject", id: alice.shell.state.document?.project.id ?? "" });
    await net.settle();
    expect(carol.shell.doc()).toEqual(held);
  });
});
