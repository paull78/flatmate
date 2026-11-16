import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Sections through the real server (section.09; AC-02): the letter is the row's ID, so taking one is an ordinary edit of
// one row, with no new rule.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const add = (y: number): Command => ({ type: "addSection", a: { x: 1, y }, b: { x: 5, y }, side: 1 });

describe("sections against the real server", () => {
  it("a section's points cross the wire", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "addSection", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: -1, depth: 1.5 });
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.doc().sections).toEqual({ A: { id: "A", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: -1, depth: 1.5 } });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a dragged end and a dragged far line reach the other client", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "addSection", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, side: 1, depth: 0.5 });
    await net.settle();
    alice.shell.key("v");
    alice.shell.click({ x: 2, y: 2 });
    alice.shell.drag({ x: 3, y: 2 }, { x: 3, y: 3 }, { ctrl: true });
    await net.settle();
    expect(bob.shell.doc().sections["A"]).toEqual({ id: "A", a: { x: 1, y: 2 }, b: { x: 3, y: 3 }, side: 1, depth: 0.5 });
    alice.shell.drag({ x: 1.776, y: 2.947 }, { x: 1.552, y: 3.394 }, { ctrl: true }); // the far grip, on the far line's middle, 0.5 m further
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.doc().sections["A"]?.depth).toBe(1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("two clients taking B at once converge on one row, and the second is refused", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, add(1));
    await net.settle();
    run(alice, add(2));
    run(bob, add(3)); // both see only A, so both take B
    alice.pump();
    bob.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect(Object.keys(bob.shell.doc().sections).sort()).toEqual(["A", "B"]);
    expect(bob.shell.doc().sections["B"]?.a.y).toBe(2); // Alice's
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("different letters land together: only the same row clashes", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, add(1));
    await net.settle();
    run(alice, add(2));
    await net.settle();
    run(alice, { type: "setSection", sectionId: "A", side: -1 });
    run(bob, { type: "setSection", sectionId: "B", side: -1 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBeNull();
    expect(alice.shell.doc().sections["A"]?.side).toBe(-1);
    expect(alice.shell.doc().sections["B"]?.side).toBe(-1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a letter deleted and taken again lands, and undo of the delete reaches the other client", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, add(1));
    await net.settle();
    run(alice, { type: "deleteEntities", ids: [{ table: "sections", id: "A" }] });
    await net.settle();
    expect(bob.shell.doc().sections).toEqual({});
    alice.shell.ui({ type: "undo" });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().sections["A"]?.a.y).toBe(1);
    run(alice, { type: "deleteEntities", ids: [{ table: "sections", id: "A" }] });
    await net.settle();
    run(bob, add(4)); // A's row is a tombstone now, which Bob's next edit expects
    await net.settle();
    expect(bob.shell.view().toast).toBeNull();
    expect(alice.shell.doc().sections["A"]?.a.y).toBe(4);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("the server refuses a section too short, whoever sent it", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.tamper = (m) => {
      if (m.type !== "submit") return m;
      const puts = m.changeset.patch.puts.map((p) => ({ ...p, entity: { ...p.entity, b: { x: 1.1, y: 1 } } }));
      return { ...m, changeset: { ...m.changeset, patch: { ...m.changeset.patch, puts } } };
    };
    run(alice, add(1));
    await net.settle();
    expect(alice.shell.view().toast).toBe("This section can't be stored");
    expect(alice.shell.doc().sections).toEqual({});
    expect(bob.shell.doc().sections).toEqual({});
  });
});
