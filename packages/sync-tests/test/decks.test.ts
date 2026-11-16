import { describe, expect, it } from "vitest";
import { deckView, footprintOf, insideDeck, placementRange, validateDocument, type Command, type Document } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Deck races with two editors and the real server (AC-13, decks.15, .36). Both edits run before either client hears
// from the server; `first` reaches the server first. The shared room is 6 × 4 m, inner faces at x 0.1 / 5.9 and
// y 0.1 / 3.9, ceiling 2.50. A placement's `at` is the middle of its back edge (front towards −y); a deck's is its centre.

const CONFLICT = "Someone else changed this first";

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";

/** Sends both clients' edits to the server in the given order, then lets every reply arrive. */
async function race(net: Net, first: Client, second: Client): Promise<void> {
  first.pump();
  second.pump();
  await net.settle();
}

/** Both documents are equal and valid, and every piece on a deck lies inside it. */
function expectConverged(alice: Client, bob: Client): Document {
  const doc = alice.shell.doc();
  expect(bob.shell.doc()).toEqual(doc);
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  for (const p of Object.values(doc.placements)) {
    if (p.deck === null) continue;
    const deck = deckView(doc, p.deck);
    const ring = footprintOf(doc, p);
    expect(deck && ring && insideDeck(deck, [ring])).toBe(true);
  }
  return doc;
}

const toasts = (alice: Client, bob: Client): (string | null)[] => [alice.shell.view().toast, bob.shell.view().toast];

describe("deck races with two editors (AC-13)", () => {
  it("two clients setting a deck's guard converge, on the first to reach the server (guards AC-04)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "addDeck", opId: "k", preset: "loft", at: { x: 2, y: 2 }, w: 2, d: 2, top: 1.2 });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().decks["k/k0"]?.guardFront.kind).toBe("railing");
    run(alice, { type: "setDeck", deckId: "k/k0", guard: "glass" });
    run(bob, { type: "setDeck", deckId: "k/k0", guard: "none" });
    await race(net, alice, bob);
    const doc = expectConverged(alice, bob);
    expect(doc.decks["k/k0"]?.guardFront.kind).toBe("glass");
  });

  // A loft at top 1.20 centred at (2, 2.35), 2.00 × 2.40 m: x 1.0–3.0, y 1.15–3.55. A bed 1.70 × 2.10 × 1.00 at
  // (2, 3.4) spans x 1.15–2.85, y 1.3–3.4 and 1.20–2.20: on it, under the ceiling.
  it.each(["delete", "place"] as const)("› deck delete against a piece placed on it (the %s first)", async (winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2, y: 2.35 }, w: 2, d: 2.4, top: 1.2 });
    await net.settle();
    const deck = "loft/k0";
    expect(Object.keys(bob.shell.doc().decks)).toEqual([deck]);
    run(alice, { type: "deleteEntities", ids: [{ table: "decks", id: deck }] });
    run(bob, { type: "placeObject", opId: "bed", state: firstState(bob), object: { kind: "bed" }, at: { x: 2, y: 3.4 }, deck });
    expect([alice.shell.doc().decks, Object.keys(bob.shell.doc().placements)]).toEqual([{}, ["bed/p0"]]); // each pre-check passed
    await (winner === "delete" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "delete") {
      // Bob's placement depends on the deck row (decks.15): a conflict, not a dangling surface.
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect([Object.keys(doc.decks), Object.keys(doc.placements)]).toEqual([[], []]);
    } else {
      // The server's I9 refuses a placement left on a missing deck (decks.15), with I9's own toast (cleanup.09).
      expect(toasts(alice, bob)).toEqual(["This edit needs something that was just removed", null]);
      expect([Object.keys(doc.decks), doc.placements["bed/p0"]?.deck]).toEqual([[deck], deck]);
    }
  });

  // A platform centred at (2, 2), 2.00 × 1.40 m: x 1–3, y 1.3–2.7. Alice moves it to (4.5, 2): x 3.5–5.5. Bob drops a
  // chair 0.45 × 0.45 at (2, 2.2), on the old place: x 1.775–2.225, y 1.75–2.2.
  it.each(["move", "chair"] as const)("› deck move against a piece landing on its old place (the %s first)", async (winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "addDeck", opId: "plat", preset: "platform", at: { x: 2, y: 2 } });
    await net.settle();
    const deck = "plat/k0";
    run(alice, { type: "setDeck", deckId: deck, at: { x: 4.5, y: 2 } });
    run(bob, { type: "placeObject", opId: "chair", state: firstState(bob), object: { kind: "chair" }, at: { x: 2, y: 2.2 }, deck });
    expect([alice.shell.doc().decks[deck]?.at, Object.keys(bob.shell.doc().placements)]).toEqual([{ x: 4.5, y: 2 }, ["chair/p0"]]);
    await (winner === "move" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "move") {
      // The chair depends on the deck row: the move conflicts it.
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect([doc.decks[deck]?.at, Object.keys(doc.placements)]).toEqual([{ x: 4.5, y: 2 }, []]);
    } else {
      // Alice's move knew of no piece, so carries none: validation finds the chair left behind (a server-only
      // refusal names no piece).
      expect(toasts(alice, bob)).toEqual(["Furniture would not fit", null]);
      expect([doc.decks[deck]?.at, doc.placements["chair/p0"]?.at]).toEqual([{ x: 2, y: 2 }, { x: 2, y: 2.2 }]);
    }
  });

  // A loft at top 1.20 under the 2.50 ceiling carries a bed 1.00 high (1.20–2.20). Raising the loft to 1.45 (bed to
  // 2.45) fits, and so does a bed 1.25 high (1.20–2.45); both together put the bed's top at 2.70.
  it.each(["raise", "resize"] as const)("› deck raise against a resize of a piece on it (the %s first)", async (winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2, y: 2.35 }, w: 2, d: 2.4, top: 1.2 });
    await net.settle();
    const deck = "loft/k0";
    run(alice, { type: "placeObject", opId: "bed", state: firstState(alice), object: { kind: "bed" }, at: { x: 2, y: 3.4 }, deck });
    await net.settle();
    const bed = "bed/o0";
    expect(placementRange(bob.shell.doc(), "bed/p0")).toEqual({ bottom: 1.2, top: 2.2 });
    run(alice, { type: "setDeck", deckId: deck, top: 1.45 });
    run(bob, { type: "setObjectSize", objectId: bed, w: 1.7, d: {}, h: { standard: 1.25 } });
    expect(placementRange(alice.shell.doc(), "bed/p0")).toEqual({ bottom: 1.45, top: 2.45 }); // each fits alone
    expect(placementRange(bob.shell.doc(), "bed/p0")).toEqual({ bottom: 1.2, top: 2.45 });
    await (winner === "raise" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "raise") {
      // The resize depends on the object and its placements, not the deck: the server's validator refuses it.
      expect(toasts(alice, bob)).toEqual([null, "Heights must fit under the ceiling"]);
      expect(placementRange(doc, "bed/p0")).toEqual({ bottom: 1.45, top: 2.45 });
    } else {
      // The raise depends on every carried piece's object (decks.36): a conflict.
      expect(toasts(alice, bob)).toEqual([CONFLICT, null]);
      expect(placementRange(doc, "bed/p0")).toEqual({ bottom: 1.2, top: 2.45 });
    }
  });
});
