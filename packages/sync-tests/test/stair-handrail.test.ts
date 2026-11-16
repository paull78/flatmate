import { describe, expect, it } from "vitest";
import { validateDocument, type Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// A stair's handrail setting between two editors and the real server app (AC-13, guards.28): both hold the same value
// from the moment it's placed, a change reaches the other, undo restores it for both, and two changes at once settle equal.
// The shared room is 6 × 4 m, inner faces at x 0.1 / 5.9, y 0.1 / 3.9; the loft is x 4.1–5.9, top 2.15.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const ID = "st/o0";
const LOFT = "loft/k0";

async function withStair(net: Net): Promise<{ alice: Client; bob: Client }> {
  const { alice, bob } = await sharedRoom(net);
  run(alice, { type: "setCeiling", height: 3.05 });
  await net.settle();
  run(alice, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 5, y: 2 }, w: 1.8, d: 3.6, guard: "glass" });
  await net.settle();
  const state = Object.keys(alice.shell.doc().states)[0] ?? "";
  run(alice, { type: "placeObject", opId: "st", state, object: { kind: "stair", size: { w: 0.9, d: 2.8 } }, at: { x: 4.1, y: 2 }, rotation: 270, deck: null, reaches: LOFT });
  await net.settle();
  expect(Object.keys(bob.shell.doc().objects)).toEqual([ID]);
  return { alice, bob };
}

describe("a stair's handrail with two editors (AC-13)", () => {
  it("two clients agree on it from the start, a change reaches the other, and undo restores it for both", async () => {
    const net = new Net();
    const { alice, bob } = await withStair(net);
    expect(bob.shell.doc().objects[ID]?.handrails?.left).toBe("glass");
    const before = alice.shell.doc();
    run(alice, { type: "setStair", objectId: ID, handrail: "railing" });
    await net.settle();
    expect(bob.shell.doc().objects[ID]?.handrails?.left).toBe("railing");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    alice.shell.ui({ type: "undo" });
    await net.settle();
    expect(alice.shell.doc()).toEqual(before);
    expect(bob.shell.doc()).toEqual(before);
    expect(net.fatal).toEqual([]);
  });

  it("one client changing the loft's guard leaves the stair's handrail for both; a race of the two settles equal", async () => {
    const net = new Net();
    const { alice, bob } = await withStair(net);
    run(alice, { type: "setDeck", deckId: LOFT, guard: "railing" });
    await net.settle();
    expect(bob.shell.doc().decks[LOFT]?.guardFront.kind).toBe("railing");
    expect(bob.shell.doc().objects[ID]?.handrails?.left).toBe("glass");
    expect(alice.shell.doc().objects[ID]?.handrails?.left).toBe("glass");
    run(alice, { type: "setDeck", deckId: LOFT, guard: "none" });
    run(bob, { type: "setStair", objectId: ID, handrail: "railing" });
    await net.settle();
    const doc = alice.shell.doc();
    expect(bob.shell.doc()).toEqual(doc);
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.decks[LOFT]?.guardFront.kind).toBe("none");
    expect(net.fatal).toEqual([]);
  });

  it("two handrails sent at once settle on one, both clients equal", async () => {
    const net = new Net();
    const { alice, bob } = await withStair(net);
    run(alice, { type: "setStair", objectId: ID, handrail: "railing" });
    run(bob, { type: "setStair", objectId: ID, handrail: "glass" });
    await net.settle();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(["railing", "glass"]).toContain(alice.shell.doc().objects[ID]?.handrails?.left);
  });

  it("a left side and a right side sent at once by two clients settle equal (edges.06)", async () => {
    const net = new Net();
    const { alice, bob } = await withStair(net);
    run(alice, { type: "setStair", objectId: ID, handrailLeft: "none" });
    run(bob, { type: "setStair", objectId: ID, handrailRight: "glass" });
    await net.settle();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    const sides = alice.shell.doc().objects[ID]?.handrails;
    expect(sides?.left).toBe("none"); // the first to reach the server
    expect(["glass", "railing"]).toContain(sides?.right); // Bob's, or refused as changed first (guards.32) and kept
  });

  it("keeps it for someone joining after a restart", async () => {
    const net = new Net();
    const { alice } = await withStair(net);
    run(alice, { type: "setStair", objectId: ID, handrail: "railing" });
    await net.settle();
    const held = alice.shell.doc();
    net.restart();
    await net.settle();
    const carol = net.join("Carol");
    await net.settle();
    carol.shell.ui({ type: "openProject", id: alice.shell.state.document?.project.id ?? "" });
    await net.settle();
    expect(carol.shell.doc()).toEqual(held);
    expect(carol.shell.doc().objects[ID]?.handrails?.left).toBe("railing");
  });
});
