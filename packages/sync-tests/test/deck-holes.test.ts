import { describe, expect, it } from "vitest";
import { anchorAt, deckView, holeView, validateDocument, type Command, type Document } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Hole races with two editors and the real server (stairwell.14, .15, .34; AC-14). Both edits run before either client
// hears from the server; `first` reaches the server first. The shared room is 6 × 4 m (inner faces x 0.1–5.9,
// y 0.1–3.9), its ceiling raised to 3.05 as the cabin's; the loft (top 2.15, underside 2.03) is centred at (2, 2), 2.00 × 2.00: x 1–3, y 1–3.

const LOFT = "loft/k0";
const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";
const hole = (opId: string, x: number, y: number, w: number, d: number): Command => ({ type: "addDeckHole", opId, deck: LOFT, at: { x, y }, w, d });

async function race(net: Net, first: Client, second: Client): Promise<void> {
  first.pump();
  second.pump();
  await net.settle();
}

/** Both documents are equal and valid. */
function expectConverged(alice: Client, bob: Client): Document {
  const doc = alice.shell.doc();
  expect(bob.shell.doc()).toEqual(doc);
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}

async function withLoft(...more: Command[]): Promise<{ net: Net; alice: Client; bob: Client }> {
  const net = new Net();
  const { alice, bob } = await sharedRoom(net);
  // Each setup edit waits for its acknowledgement: one sent while another is pending is lost (heights lesson).
  for (const c of [{ type: "setCeiling", height: 3.05 } satisfies Command, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2, y: 2 }, w: 2, d: 2 } satisfies Command, ...more]) {
    run(alice, c);
    await net.settle();
  }
  expect(deckView(bob.shell.doc(), LOFT)).not.toBeNull();
  return { net, alice, bob };
}

describe("hole races with two editors (AC-14)", () => {
  it.each(["hole", "delete"] as const)("› a hole against a deck delete (the %s first)", async (winner) => {
    const { net, alice, bob } = await withLoft();
    run(alice, hole("h", 2, 2, 0.6, 0.6));
    run(bob, { type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    await (winner === "hole" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    // Whichever comes second is refused: a dangling hole never stays.
    if (winner === "hole") expect([deckView(doc, LOFT) !== null, holeView(doc, "h/h0") !== null]).toEqual([true, true]);
    else expect([deckView(doc, LOFT), Object.keys(doc.deckHoles)]).toEqual([null, []]);
  });

  it.each(["hole", "chair"] as const)("› a hole against a piece placed on that spot (the %s first)", async (winner) => {
    const { net, alice, bob } = await withLoft();
    run(alice, hole("h", 2, 2, 0.6, 0.6));
    run(bob, { type: "placeObject", opId: "chair", state: firstState(bob), object: { kind: "chair" }, at: anchorAt({ x: 2, y: 2 }, 0.45, 0), rotation: 0, deck: LOFT });
    await (winner === "hole" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect([holeView(doc, "h/h0") !== null, doc.placements["chair/p0"] !== undefined]).toEqual(winner === "hole" ? [true, false] : [false, true]);
  });

  it.each(["alice", "bob"] as const)("› two overlapping holes cut at once (%s first)", async (winner) => {
    const { net, alice, bob } = await withLoft();
    run(alice, hole("a", 1.8, 2, 0.6, 0.6));
    run(bob, hole("b", 2.1, 2, 0.6, 0.6));
    await (winner === "alice" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect(Object.keys(doc.deckHoles)).toEqual([winner === "alice" ? "a/h0" : "b/h0"]);
  });

  // A notch at the loft's east side, x 2.40–3.00, y 1.40–2.20; a ship's ladder rising west from its west side,
  // x 2.40–3.50, y 1.50–2.10. Shrunk to x 2.60–3.00, the notch would leave the ladder under the slab.
  it.each(["shrink", "ladder"] as const)("› a hole shrunk against a ladder placed through it (the %s first)", async (winner) => {
    const { net, alice, bob } = await withLoft(hole("n", 2.7, 1.8, 0.6, 0.8));
    run(alice, { type: "setDeckHole", holeId: "n/h0", at: { x: 2.8, y: 1.8 }, w: 0.4 });
    run(bob, { type: "placeObject", opId: "lad", state: firstState(bob), object: { kind: "shipsLadder" }, at: anchorAt({ x: 2.95, y: 1.8 }, 1.1, 90), rotation: 90, deck: null });
    await (winner === "shrink" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect([holeView(doc, "n/h0")?.hole.w, doc.placements["lad/p0"] !== undefined]).toEqual(winner === "shrink" ? [0.4, false] : [0.6, true]);
  });

  // The loft moved 0.50 east carries its hole (stairwell.34) while the other editor drags the hole: the second is refused.
  it.each(["move", "hole"] as const)("› a deck move against a move of its hole (the %s first)", async (winner) => {
    const { net, alice, bob } = await withLoft(hole("h", 2, 2, 0.6, 0.6));
    run(alice, { type: "setDeck", deckId: LOFT, at: { x: 2.5, y: 2 } });
    run(bob, { type: "setDeckHole", holeId: "h/h0", at: { x: 2.2, y: 2 } });
    await (winner === "move" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect([deckView(doc, LOFT)?.at.x, holeView(doc, "h/h0")?.hole.at.x]).toEqual(winner === "move" ? [2.5, 2.5] : [2, 2.2]);
  });
});
