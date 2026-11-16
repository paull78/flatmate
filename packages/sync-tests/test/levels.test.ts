import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { hasPendingEdit } from "@fm/editor";
import { Net, sharedRoom, type Client } from "./net";

// Presence carries each viewer's level (AC-10, levels.11, .16): two editors and the real server app. The shared room
// is 6 × 4 m under a 2.50 ceiling; Loft (x 0.5–2.5) and Bunk (x 3.5–5.5) are lofts at 2.15, one level. Every edit
// waits for its acknowledgement before the next (heights lesson).

const LOFT = "loft/k0";
const BUNK = "bunk/k0";

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });

/** The labels next to the remote cursors in this client's scene. */
function cursorLabels(c: Client): string[] {
  const layer = c.shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
  return layer.flatMap((p) => (p.kind === "text" ? [p.text] : []));
}

/** Runs one edit and waits until the server acknowledged it and the other client holds it. */
async function edit(net: Net, by: Client, other: Client, command: Command): Promise<void> {
  run(by, command);
  await net.settle();
  const d = by.shell.state.document;
  expect(d !== null && !hasPendingEdit(d)).toBe(true);
  expect(other.shell.doc()).toEqual(by.shell.doc());
}

async function withLoft(net: Net, alice: Client, bob: Client): Promise<void> {
  await edit(net, alice, bob, { type: "addDeck", opId: "loft", preset: "loft", name: "Loft", at: { x: 1.5, y: 2 }, w: 2, d: 2 });
  expect(Object.keys(bob.shell.doc().decks)).toEqual([LOFT]);
}

/** Both move their cursors, so each sees the other's label. */
async function cursors(net: Net, alice: Client, bob: Client): Promise<void> {
  alice.shell.moveTo({ x: 1, y: 1 });
  bob.shell.moveTo({ x: 5, y: 1 });
  await net.settle();
}

const view = (c: Client, deck: string | null): void => c.shell.ui({ type: "setViewedLevel", deck });

describe("presence level with two editors (AC-10)", () => {
  it("› Alice at the floor sees \"Bob · Loft\"; Bob sees \"Alice · Floor\"", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await withLoft(net, alice, bob);
    await cursors(net, alice, bob);
    expect([cursorLabels(alice), cursorLabels(bob)]).toEqual([["Bob"], ["Alice"]]);
    view(bob, LOFT);
    await net.settle();
    expect(bob.shell.effectsOf("presence").at(-1)?.level).toBe(LOFT); // viewing a level tells the others at once
    expect([cursorLabels(alice), cursorLabels(bob)]).toEqual([["Bob · Loft"], ["Alice · Floor"]]);
  });

  it("› both at the loft: \"Bob\", \"Alice\"", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await withLoft(net, alice, bob);
    view(alice, LOFT);
    bob.shell.key("PageUp");
    await cursors(net, alice, bob);
    expect([cursorLabels(alice), cursorLabels(bob)]).toEqual([["Bob"], ["Alice"]]);
    bob.shell.key("PageDown");
    await net.settle();
    expect(bob.shell.effectsOf("presence").at(-1)?.level).toBeNull();
    expect([cursorLabels(alice), cursorLabels(bob)]).toEqual([["Bob · Floor"], ["Alice · Loft"]]);
  });

  it("› Bob in Night at the loft: \"Bob · Night · Loft\"", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await withLoft(net, alice, bob);
    bob.shell.ui({ type: "addState" }); // a copy of Layout, made active for Bob
    await net.settle();
    const night = bob.shell.view().states.find((s) => s.active)?.id ?? "";
    bob.shell.ui({ type: "renameState", id: night, name: "Night" });
    await net.settle();
    expect(alice.shell.view().states.map((s) => s.name)).toEqual(["Layout", "Night"]);
    view(bob, LOFT);
    await cursors(net, alice, bob);
    expect([cursorLabels(alice), cursorLabels(bob)]).toEqual([["Bob · Night · Loft"], ["Alice · Layout · Floor"]]);
  });

  it("› Bob views Bunk at 2.15 while Alice views Loft at 2.15: no suffix", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await withLoft(net, alice, bob);
    await edit(net, alice, bob, { type: "addDeck", opId: "bunk", preset: "loft", name: "Bunk", at: { x: 4.5, y: 2 }, w: 2, d: 2 });
    view(alice, LOFT); // not the strip's choice (the level's lowest deck id, Bunk): a deck of the level all the same
    view(bob, BUNK);
    await cursors(net, alice, bob);
    expect([alice.shell.effectsOf("presence").at(-1)?.level, bob.shell.effectsOf("presence").at(-1)?.level]).toEqual([LOFT, BUNK]);
    expect([cursorLabels(alice), cursorLabels(bob)]).toEqual([["Bob"], ["Alice"]]);
    view(alice, null);
    await net.settle();
    expect(cursorLabels(alice)).toEqual(["Bob · Bunk, Loft"]); // the level's name joins its decks' labels
  });

  it("› Alice moves from Loft to Bunk at one height, then Loft is raised: Bob, viewing Bunk, still reads \"Alice\"", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await withLoft(net, alice, bob);
    await edit(net, alice, bob, { type: "addDeck", opId: "bunk", preset: "loft", name: "Bunk", at: { x: 4.5, y: 2 }, w: 2, d: 2 });
    view(alice, LOFT);
    await cursors(net, alice, bob);
    view(alice, BUNK); // the same level, so only the deck id says where she is
    view(bob, BUNK);
    await net.settle();
    await edit(net, bob, alice, { type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(cursorLabels(bob)).toEqual(["Alice"]);
  });

  it("› Alice's loft is deleted: her presence updates to the floor", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await withLoft(net, alice, bob);
    view(alice, LOFT);
    await cursors(net, alice, bob);
    expect(cursorLabels(bob)).toEqual(["Alice · Loft"]);
    const sent = alice.shell.effectsOf("presence").length;
    await edit(net, bob, alice, { type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect(alice.shell.effectsOf("presence").slice(sent).map((e) => e.level)).toEqual([null]); // the remote delete moved her to the floor
    expect(cursorLabels(bob)).toEqual(["Alice"]);
    // Bob's undo brings the loft back with its id; Alice stays at the floor (levels.31), and Bob's label says so.
    bob.shell.ui({ type: "undo" });
    await net.settle();
    expect(Object.keys(alice.shell.doc().decks)).toEqual([LOFT]);
    expect(cursorLabels(bob)).toEqual(["Alice"]);
  });
});
