import { describe, expect, it } from "vitest";
import { validateDocument, type Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// An L keeps one handrail value with two editors and the real server app (AC-13, guards.33): setting it on either flight
// sets both for both clients, undo restores both for both, and two edits at once, one per flight, leave the L one value.
// The shared room is 6 × 4 m, inner faces at x 0.1 / 5.9, y 0.1 / 3.9; the loft is x 4.1–5.9, top 2.15, and the L's
// upper flight has its back on its edge at (4.1, 2).

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const UPPER = "ps/s0/o0";
const LOWER = "ps/s1/o0";

async function withEll(net: Net): Promise<{ alice: Client; bob: Client }> {
  const { alice, bob } = await sharedRoom(net);
  run(alice, { type: "setCeiling", height: 3.05 });
  await net.settle();
  run(alice, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 5, y: 2 }, w: 1.8, d: 3.6 });
  await net.settle();
  const state = Object.keys(alice.shell.doc().states)[0] ?? "";
  run(alice, { type: "placeStair", opId: "ps", state, kind: "stair", surface: null, deck: "loft/k0", at: { x: 4.1, y: 2 }, shape: "l-right" });
  await net.settle();
  expect(Object.keys(bob.shell.doc().objects).sort()).toEqual([UPPER, LOWER]);
  return { alice, bob };
}
const both = (c: Client): unknown[] => [c.shell.doc().objects[UPPER]?.handrails?.left, c.shell.doc().objects[LOWER]?.handrails?.left];

describe("an L's handrail with two editors (AC-13)", () => {
  it("set on the lower flight reaches both flights for both clients, and undo restores both for both", async () => {
    const net = new Net();
    const { alice, bob } = await withEll(net);
    const before = alice.shell.doc();
    run(alice, { type: "setStair", objectId: LOWER, handrail: "glass" });
    await net.settle();
    expect(both(bob)).toEqual(["glass", "glass"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    alice.shell.ui({ type: "undo" });
    await net.settle();
    expect(alice.shell.doc()).toEqual(before);
    expect(bob.shell.doc()).toEqual(before);
    expect(net.fatal).toEqual([]);
  });

  it("two edits at once, one on each flight, both real changes, leave one value for the whole L, both clients equal", async () => {
    // Alice's handrail reaches the lower flight too, so Bob's riser on it, sent at once, must not overwrite it.
    const net = new Net();
    const { alice, bob } = await withEll(net);
    expect([bob.shell.doc().objects[LOWER]?.riser, ...both(bob)]).toEqual([undefined, "railing", "railing"]); // so both edits change something
    run(alice, { type: "setStair", objectId: UPPER, handrail: "glass" });
    run(bob, { type: "setStair", objectId: LOWER, riser: 0.17 });
    await net.settle();
    const doc = alice.shell.doc();
    expect(bob.shell.doc()).toEqual(doc);
    expect(validateDocument(doc).ok).toBe(true);
    const [upper, lower] = both(alice);
    expect(upper).toBe(lower);
    expect(net.fatal).toEqual([]);
  });
});
