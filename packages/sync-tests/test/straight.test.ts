import { describe, expect, it } from "vitest";
import { validateDocument, type Command, type Document } from "@fm/domain";
import { jointAt, wallBetween } from "@fm/editor/testing";
import { Net, drawDivider, sharedRoom, type Client } from "./net";

// The straight cycle's races (AC-14): stitch, split, connect and a run move against a concurrent edit, in both arrival
// orders, each converging to one valid document. The shared room is 6 × 4 m, its bottom wall (0, 0) → (6, 0); the
// divider at x 3 T's into the bottom and top walls, so deleting it stitches each side back into one wall (straight.05).

const CONFLICT = "Someone else changed this first";
const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });

async function race(net: Net, first: Client, second: Client): Promise<void> {
  first.pump();
  second.pump();
  await net.settle();
}

function expectConverged(alice: Client, bob: Client): Document {
  const doc = alice.shell.doc();
  expect(bob.shell.doc()).toEqual(doc);
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}
const toasts = (alice: Client, bob: Client): (string | null)[] => [alice.shell.view().toast, bob.shell.view().toast];

/** The room with the divider, known to both; the divider's id and the bottom right piece's. */
async function divided(net: Net): Promise<{ alice: Client; bob: Client; divider: string; bottomRight: string }> {
  const { alice, bob } = await sharedRoom(net);
  await drawDivider(net, alice);
  const doc = bob.shell.doc();
  return { alice, bob, divider: wallBetween(doc, { x: 3, y: 0 }, { x: 3, y: 4 }), bottomRight: wallBetween(doc, { x: 3, y: 0 }, { x: 6, y: 0 }) };
}

describe("stitch on delete against a concurrent edit", () => {
  it.each(["stitch", "move"] as const)("against a move of a far joint, the %s first: one wins, nothing is overwritten", async (winner) => {
    const net = new Net();
    const { alice, bob, divider } = await divided(net);
    const corner = jointAt(bob.shell.doc(), { x: 6, y: 0 });
    run(alice, { type: "deleteEntities", ids: [{ table: "walls", id: divider }] });
    run(bob, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6.2, y: 0 } }] });
    await (winner === "stitch" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "stitch") {
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]);
      expect(Object.keys(doc.walls)).toHaveLength(4);
      expect(doc.joints[corner]).toMatchObject({ x: 6, y: 0 });
    } else {
      expect(toasts(alice, bob)).toEqual([CONFLICT, null]); // the stitch depends on the far joint Bob moved (straight.17)
      expect(Object.keys(doc.walls)).toHaveLength(7);
      expect(doc.joints[corner]).toMatchObject({ x: 6.2, y: 0 });
    }
  });

  it.each(["stitch", "door"] as const)("against a door added on one piece, the %s first", async (winner) => {
    const net = new Net();
    const { alice, bob, divider, bottomRight } = await divided(net);
    run(alice, { type: "deleteEntities", ids: [{ table: "walls", id: divider }] });
    run(bob, { type: "addOpening", opId: "door", wall: bottomRight, kind: "swing", offset: 1, width: 0.8 });
    await (winner === "stitch" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    if (winner === "stitch") {
      expect(toasts(alice, bob)).toEqual([null, CONFLICT]); // the door's wall was rewritten
      expect([Object.keys(doc.walls).length, doc.openings["door/d0"]]).toEqual([4, undefined]);
    } else {
      // The stitch knew of no door and would take its wall away: the server's validator refuses it, the divider stays.
      expect(toasts(alice, bob)).toEqual(["Doors and windows must fit their wall", null]);
      expect([Object.keys(doc.walls).length, doc.openings["door/d0"]?.wall]).toEqual([7, bottomRight]);
    }
  });
});

describe("split and connect against a concurrent edit", () => {
  it.each(["split", "thickness"] as const)("a split against a thickness change of the same wall, the %s first", async (winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const bottom = wallBetween(alice.shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    run(alice, { type: "splitWall", opId: "cut", wallId: bottom, offset: 1.2 });
    run(bob, { type: "setWallThickness", wallId: bottom, thickness: 0.3 });
    await (winner === "split" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect(toasts(alice, bob)).toEqual(winner === "split" ? [null, CONFLICT] : [CONFLICT, null]);
    expect(Object.keys(doc.walls)).toHaveLength(winner === "split" ? 5 : 4);
    expect(doc.walls[bottom]?.thickness).toBe(winner === "split" ? 0.2 : 0.3);
  });

  it.each(["connect", "delete"] as const)("a connect against a delete of the target wall, the %s first", async (winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const bottom = wallBetween(alice.shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    run(alice, { type: "addWall", opId: "free", from: { at: { x: 1, y: 1 } }, to: { at: { x: 3, y: 1 } } });
    await net.settle();
    const end = jointAt(bob.shell.doc(), { x: 3, y: 1 });
    run(alice, { type: "connectJoint", opId: "drop", jointId: end, to: { x: 3, y: 0 } });
    run(bob, { type: "deleteEntities", ids: [{ table: "walls", id: bottom }] });
    await (winner === "connect" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    expect(toasts(alice, bob)).toEqual(winner === "connect" ? [null, CONFLICT] : [CONFLICT, null]);
    expect(Object.keys(doc.walls)).toHaveLength(winner === "connect" ? 6 : 4);
  });
});

describe("a run move against a piece edit", () => {
  it.each(["move", "piece"] as const)("the bottom wall moved into a chair's place, the %s first: one is refused", async (winner) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const doc0 = alice.shell.doc();
    const bottom = wallBetween(doc0, { x: 0, y: 0 }, { x: 6, y: 0 });
    const layout = Object.keys(doc0.states)[0] ?? "s0";
    run(alice, { type: "moveWalls", walls: [bottom], by: { x: 0, y: 0.6 } }); // the wall's body then spans y 0.5 .. 0.7
    run(bob, { type: "placeObject", opId: "chair", deck: null, state: layout, object: { kind: "chair" }, at: { x: 3, y: 0.7 }, rotation: 0 }); // y 0.475 .. 0.925
    await (winner === "move" ? race(net, alice, bob) : race(net, bob, alice));
    const doc = expectConverged(alice, bob);
    const [a, b] = toasts(alice, bob);
    expect([a, b].filter((t) => t !== null)).toHaveLength(1); // whichever came second is refused for the overlap
    if (winner === "move") expect(doc.joints[jointAt(doc0, { x: 0, y: 0 })]).toMatchObject({ y: 0.6 });
    else expect(Object.keys(doc.placements)).toHaveLength(1);
  });
});
