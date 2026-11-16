import { describe, expect, it } from "vitest";
import { columnOf, validateDocument, wallRange, type Command, type Document } from "@fm/domain";
import { wallBetween } from "@fm/editor/testing";
import { Net, sharedRoom, submitIds, type Client } from "./net";

// Column races with two editors and the real server (AC-20, pillars). Both edits run before either client hears from
// the server; `first` reaches the server first. The shared room is 6 × 4 m (wall centrelines x 0 / 6, y 0 / 4) under
// the 2.50 ceiling; its bottom wall runs from (0, 0) to (6, 0). Loft is a hollow loft (top 2.15, slab 0.12) centred at
// (4, 2), 2 × 2 m: x 3–5, y 1–3.

const CONFLICT = "Someone else changed this first";
const LOFT = "loft/k0";

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });

/** Sends both clients' edits to the server in the given order, then lets every reply arrive. */
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

const toasts = (alice: Client, bob: Client): (string | null)[] => [alice.shell.view().toast, bob.shell.view().toast];

/** The shared room with Loft in it, known to both editors. */
async function roomWithLoft(net: Net): Promise<{ alice: Client; bob: Client }> {
  const { alice, bob } = await sharedRoom(net);
  run(alice, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4, y: 2 }, w: 2, d: 2 });
  await net.settle();
  expect(Object.keys(bob.shell.doc().decks)).toEqual([LOFT]);
  return { alice, bob };
}

/** A column's centre, width and vertical range, rounded to the millimetre. */
function post(doc: Document, id: string): { at: { x: number; y: number }; width: number; bottom: number; top: number } | null {
  const c = columnOf(doc, id);
  const r = wallRange(doc, id);
  if (!c || !r) return null;
  const mm = (v: number): number => Math.round(v * 1000) / 1000;
  return { at: { x: mm(c.centre.x), y: mm(c.centre.y) }, width: mm(c.width), bottom: mm(r.bottom), top: mm(r.top) };
}

describe("column races with two editors (AC-20)", () => {
  // A free post 0.20 × 0.20 at (4, 2) under Loft, its top Loft: 0 to the underside, 2.03. Alice raises Loft by 0.15 to
  // 2.30 (underside 2.18); Bob moves the post to (4.4, 2.3), still under Loft, or widens it to 0.30.
  const edits = { move: { at: { x: 4.4, y: 2.3 } }, width: { width: 0.3 } } as const;
  it.each([
    ["move", "raise"],
    ["move", "post"],
    ["width", "raise"],
    ["width", "post"],
  ] as const)("› loft raise against a post edit (%s) converge, the %s first", async (edit, winner) => {
    const net = new Net();
    const { alice, bob } = await roomWithLoft(net);
    run(alice, { type: "placeColumn", opId: "post", at: { x: 4, y: 2 }, width: 0.2, depth: 0.2, top: LOFT });
    await net.settle();
    const id = "post/w0";
    expect(post(bob.shell.doc(), id)).toEqual({ at: { x: 4, y: 2 }, width: 0.2, bottom: 0, top: 2.03 });
    run(alice, { type: "setDeck", deckId: LOFT, top: 2.3 });
    run(bob, { type: "setColumn", wallId: id, ...edits[edit] });
    const moved = { at: edit === "move" ? { x: 4.4, y: 2.3 } : { x: 4, y: 2 }, width: edit === "width" ? 0.3 : 0.2 };
    expect([post(alice.shell.doc(), id), post(bob.shell.doc(), id)]).toEqual([
      { at: { x: 4, y: 2 }, width: 0.2, bottom: 0, top: 2.18 }, // each pre-check passed
      { ...moved, bottom: 0, top: 2.03 },
    ]);
    await (winner === "raise" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "raise") {
      // The post edit depends on the deck it reaches up to: the raise conflicts it.
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect([doc.decks[LOFT]?.top, post(doc, id)]).toEqual([2.3, { at: { x: 4, y: 2 }, width: 0.2, bottom: 0, top: 2.18 }]);
    } else {
      // A deck edit depends on every wall row, but moving or widening a post rewrites only its joints: both land, and
      // the post spans 0 to the raised loft's underside at its new place.
      expect(toasts(alice, bob)).toEqual([null, null]);
      expect([doc.decks[LOFT]?.top, post(doc, id)]).toEqual([2.3, { ...moved, bottom: 0, top: 2.18 }]);
    }
  });

  // A post 0.20 × 0.20 on Loft at (4, 2), 0.20 high: 2.15–2.35. Raising Loft to 2.25 (post 2.25–2.45) fits, and so does
  // Bob moving the post to (4.4, 2.3) and making it 0.30 high (2.15–2.45); both together put its top at 2.55.
  it.each(["raise", "post"] as const)("› loft raise against a move of a post on it, together through the ceiling (the %s first)", async (winner) => {
    const net = new Net();
    const { alice, bob } = await roomWithLoft(net);
    run(alice, { type: "placeColumn", opId: "cap", at: { x: 4, y: 2 }, width: 0.2, depth: 0.2, base: LOFT, top: 0.2 });
    await net.settle();
    const id = "cap/w0";
    expect(post(bob.shell.doc(), id)).toEqual({ at: { x: 4, y: 2 }, width: 0.2, bottom: 2.15, top: 2.35 });
    run(alice, { type: "setDeck", deckId: LOFT, top: 2.25 });
    run(bob, { type: "setColumn", wallId: id, at: { x: 4.4, y: 2.3 }, top: 0.3 });
    expect([post(alice.shell.doc(), id)?.top, post(bob.shell.doc(), id)?.top]).toEqual([2.45, 2.45]); // each fits alone
    await (winner === "raise" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "raise") {
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect([doc.decks[LOFT]?.top, post(doc, id)]).toEqual([2.25, { at: { x: 4, y: 2 }, width: 0.2, bottom: 2.25, top: 2.45 }]);
    } else {
      expect(toasts(alice, bob)).toEqual([CONFLICT, null]);
      expect([doc.decks[LOFT]?.top, post(doc, id)]).toEqual([2.15, { at: { x: 4.4, y: 2.3 }, width: 0.2, bottom: 2.15, top: 2.45 }]);
    }
  });

  // The same post on Loft (2.15–2.35): raising Loft to 2.40 would put its top at 2.60, so Alice's own editor refuses the
  // raise and sends nothing; Bob's move lands whichever editor is pumped first.
  it.each(["alice", "bob"] as const)("› a raise pushing a post on the loft through the ceiling is refused; the move lands (%s pumped first)", async (first) => {
    const net = new Net();
    const { alice, bob } = await roomWithLoft(net);
    run(alice, { type: "placeColumn", opId: "cap", at: { x: 4, y: 2 }, width: 0.2, depth: 0.2, base: LOFT, top: 0.2 });
    await net.settle();
    const id = "cap/w0";
    const sent = submitIds(alice).length;
    run(alice, { type: "setDeck", deckId: LOFT, top: 2.4 });
    run(bob, { type: "setColumn", wallId: id, at: { x: 4.4, y: 2.3 } });
    expect([submitIds(alice).length, alice.shell.doc().decks[LOFT]?.top]).toEqual([sent, 2.15]);
    expect(alice.shell.view().toast).not.toBeNull();
    await (first === "alice" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect(bob.shell.view().toast).toBeNull();
    expect([doc.decks[LOFT]?.top, post(doc, id)]).toEqual([2.15, { at: { x: 4.4, y: 2.3 }, width: 0.2, bottom: 2.15, top: 2.35 }]);
  });

  // Alice drops a 0.30 × 0.30 column into the bottom wall's line at x 2 (x 1.85–2.15); Bob ends a new wall from (x, 2)
  // on the same wall, at x 4 (clear of the column) or at x 2.05 (inside its span). Both rewrite the bottom wall's row.
  it.each([
    [4, "column"],
    [4, "wall"],
    [2.05, "column"],
    [2.05, "wall"],
  ] as const)("› column drop against a wall split at x %s converge, the %s first", async (x, winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const bottom = wallBetween(alice.shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    const before = Object.keys(alice.shell.doc().walls).length;
    run(alice, { type: "placeColumn", opId: "col", at: { x: 2, y: 0 }, width: 0.3, depth: 0.3 });
    run(bob, { type: "addWall", opId: "stub", from: { at: { x, y: 2 } }, to: { at: { x, y: 0 } } });
    expect(columnOf(alice.shell.doc(), "col/w0")?.line).toEqual([bottom, "col/w1"]); // each pre-check passed
    expect(Object.keys(bob.shell.doc().walls)).toHaveLength(before + 2);
    await (winner === "column" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "column") {
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect([columnOf(doc, "col/w0")?.line, Object.keys(doc.walls).length]).toEqual([[bottom, "col/w1"], before + 2]);
    } else {
      expect(toasts(alice, bob)).toEqual([CONFLICT, null]);
      expect([doc.walls["col/w0"], wallBetween(doc, { x, y: 2 }, { x, y: 0 })]).toEqual([undefined, "stub/w0"]);
    }
  });

  // The 0.30 column sits in the bottom wall's line at x 2: the wall keeps its ID from (0, 0) to x 1.85, `col/w1` runs
  // on from x 2.15 to (6, 0). Alice deletes the column (the halves heal into the bottom wall) while Bob adds a 0.80 door
  // on one half: at 0.60 along the first (x 0.6–1.4), or 1.00 along the second (x 3.15–3.95).
  it.each([
    ["first", "heal"],
    ["first", "door"],
    ["second", "heal"],
    ["second", "door"],
  ] as const)("› a heal against a door on the %s half converge, the %s first", async (half, winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const bottom = wallBetween(alice.shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    run(alice, { type: "placeColumn", opId: "col", at: { x: 2, y: 0 }, width: 0.3, depth: 0.3 });
    await net.settle();
    expect(columnOf(bob.shell.doc(), "col/w0")?.line).toEqual([bottom, "col/w1"]);
    const wall = half === "first" ? bottom : "col/w1";
    run(alice, { type: "deleteEntities", ids: [{ table: "walls", id: "col/w0" }] });
    run(bob, { type: "addOpening", opId: "door", wall, kind: "swing", offset: half === "first" ? 0.6 : 1, width: 0.8 });
    expect([Object.keys(alice.shell.doc().walls).length, Object.keys(bob.shell.doc().openings)]).toEqual([4, ["door/d0"]]);
    await (winner === "heal" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    const door = doc.openings["door/d0"];
    if (winner === "heal") {
      // The door depends on its wall's row, which the heal rewrites or removes.
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect([Object.keys(doc.walls).length, wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), door]).toEqual([4, bottom, undefined]);
    } else if (half === "first") {
      // The heal knew of no door, but the bottom wall keeps its ID and its joint a: the door stays where Bob put it.
      expect(toasts(alice, bob)).toEqual([null, null]);
      expect([Object.keys(doc.walls).length, door?.wall, door?.offset]).toEqual([4, bottom, 0.6]);
    } else {
      // The heal would remove `col/w1` from under the door, which it knew nothing of: the server's validator refuses
      // it (the door would sit on no wall), and the column stays.
      expect(toasts(alice, bob)).toEqual(["Doors and windows must fit their wall", null]);
      expect([columnOf(doc, "col/w0")?.line, door?.wall, door?.offset]).toEqual([[bottom, "col/w1"], "col/w1", 1]);
    }
  });
});
