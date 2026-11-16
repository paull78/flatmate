import { describe, expect, it } from "vitest";
import { serialize, type Dimension, type DimensionEnd } from "@fm/domain";
import { jointAt } from "@fm/editor/testing";
import { type Client, Net, sharedRoom, submitIds } from "./net";

// A dimension against a concurrent delete of its corner joint (AC-13). The room is 6 × 4 with 0.20 m walls; J is the
// joint at (6,4). Zoom 80: tolerance 0.125 m, so a click on J's inner face corner (5.9,3.9) anchors to it.

const ANCHOR_REFUSED = "A dimension needs this corner";

const rows = (c: Client): Dimension[] => Object.values(c.shell.doc().dimensions);
const texts = (c: Client): string[] =>
  (c.shell.scene().layers.find((l) => l.name === "dimensions")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));

/** The Dimension tool from J's inner corner to (0.1,3.9), offset 0.4 (the line at y = 3.5). */
function placeDimension(c: Client): void {
  c.shell.key("m");
  c.shell.click({ x: 5.9, y: 3.9 });
  c.shell.click({ x: 0.1, y: 3.9 });
  c.shell.click({ x: 3, y: 3.5 });
}

/** Select J and delete it, with the right and top walls. */
function deleteJ(c: Client): void {
  c.shell.key("v");
  c.shell.click({ x: 6, y: 4 });
  c.shell.key("Delete");
}

function expectFreeNear(end: DimensionEnd | undefined, x: number, y: number): void {
  if (end === undefined || "joint" in end) throw new Error(`expected a free end, got ${JSON.stringify(end)}`);
  expect(end.x).toBeCloseTo(x, 6);
  expect(end.y).toBeCloseTo(y, 6);
}

describe("dimensions against the real server (AC-13)", () => {
  it("a dimension Alice adds shows on Bob's drawing", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const j = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    placeDimension(alice);
    await net.settle();
    const [row] = rows(bob);
    expect(rows(bob)).toHaveLength(1);
    expect(row?.a).toMatchObject({ joint: j });
    expect(serialize(bob.shell.doc())).toEqual(serialize(alice.shell.doc()));
    expect(texts(bob)).toEqual(["5.80"]);
  });

  it("add first, then delete: Bob's delete is refused", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const j = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    placeDimension(alice);
    deleteJ(bob);
    alice.pump(); // Alice's add arrives first
    bob.pump();
    await net.settle();
    expect(bob.shell.view().toast).toBe(ANCHOR_REFUSED);
    for (const c of [alice, bob]) {
      expect(c.shell.doc().joints[j]).toBeDefined();
      expect(rows(c)).toHaveLength(1);
    }
    expect(bob.shell.state.undo.past).toEqual([]);
    expect(serialize(bob.shell.doc())).toEqual(serialize(alice.shell.doc()));
  });

  it("delete first, then add: Alice's add is refused", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const j = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    placeDimension(alice);
    deleteJ(bob);
    bob.pump(); // Bob's delete arrives first
    alice.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBe(ANCHOR_REFUSED);
    for (const c of [alice, bob]) {
      expect(c.shell.doc().joints[j]).toBeUndefined();
      expect(c.shell.doc().dimensions).toEqual({});
    }
    const addId = submitIds(alice).at(-1);
    expect(addId).toBeDefined();
    expect(alice.shell.state.undo.past.map((e) => e.id)).not.toContain(addId);
    expect(serialize(bob.shell.doc())).toEqual(serialize(alice.shell.doc()));
  });

  it("a half-placed dimension survives Bob's delete and commits free ends", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("m");
    alice.shell.click({ x: 5.9, y: 3.9 });
    alice.shell.click({ x: 0.1, y: 3.9 });
    const before = alice.shell.state.tool;
    expect(before.name === "dimension" && before.state.kind).toBe("offset");
    deleteJ(bob);
    await net.settle();
    const after = alice.shell.state.tool;
    expect(after.name === "dimension" && after.state.kind).toBe("offset");
    alice.shell.click({ x: 3, y: 3.5 });
    await net.settle();
    const [row] = rows(alice);
    expect(rows(alice)).toHaveLength(1);
    expectFreeNear(row?.a, 5.9, 3.9);
    expectFreeNear(row?.b, 0.1, 3.9); // (0,4) is now a free wall end whose corners are 0.1 away
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBeNull();
    expect(serialize(bob.shell.doc())).toEqual(serialize(alice.shell.doc()));
  });
});
