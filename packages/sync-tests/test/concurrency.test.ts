import { describe, expect, it } from "vitest";
import { jointAt, pointOf, wallBetween } from "@fm/editor/testing";
import { REMOTE_REDO } from "@fm/editor";
import { Net, sharedRoom, submitIds } from "./net";

describe("concurrent edits against the real server (spec §4.0 cases, §9)", () => {
  it("same joint moved by both: the second is rejected as a conflict and both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    bob.shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    alice.pump(); // Alice's submission arrives first
    bob.pump();
    await net.settle();
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect(bob.shell.state.undo.past).toEqual([]);
  });

  it("different joints moved by both: both are accepted and both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    bob.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    jointAt(alice.shell.doc(), { x: 6, y: 4.6 });
    jointAt(alice.shell.doc(), { x: -0.4, y: 0 });
    expect(alice.shell.state.undo.past.at(-1)?.status).toBe("usable");
    expect(bob.shell.state.undo.past.at(-1)?.status).toBe("usable");
  });

  it("crossing walls drawn at once: each is valid alone, so the second is rejected as invalid", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("w");
    alice.shell.click({ x: 1, y: 1 });
    alice.shell.click({ x: 1, y: 3 });
    bob.shell.key("w");
    bob.shell.click({ x: 0.4, y: 2 });
    bob.shell.click({ x: 2, y: 2 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(Object.keys(alice.shell.doc().walls)).toHaveLength(5);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Walls can't cross"); // violation I5 (spec §4.0 case 3)
    const tool = bob.shell.state.tool;
    expect(tool.name === "wall" && tool.state.kind).toBe("idle");
  });

  it("an undo racing a remote edit of the same joint is refused by the server", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle();
    const dragId = submitIds(alice).at(-1);
    alice.shell.key("z", { meta: true }); // the undo request, not sent yet
    bob.shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5 });
    bob.pump(); // Bob's move arrives first
    alice.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBe("Someone else changed this first");
    expect(alice.shell.state.undo.past.map((e) => e.id)).not.toContain(dragId);
    expect(alice.shell.state.undo.future).toEqual([]);
    expect(alice.shell.state.undo.pending).toBeNull();
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 5 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("Bob moves the fixed endpoint while Alice submits a typed resize: her dependency expectation rejects it", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const right = wallBetween(alice.shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    // Phase 5 types this into the helper dimension; the command is what that gesture commits.
    alice.shell.command({ type: "setWallLength", wallId: right, length: 3.5, keep: "a" });
    bob.shell.key("v");
    bob.shell.drag({ x: 6, y: 0 }, { x: 6.4, y: 0 });
    bob.pump();
    alice.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBe("Someone else changed this first");
    jointAt(alice.shell.doc(), { x: 6, y: 4 }); // the resize never happened
    jointAt(alice.shell.doc(), { x: 6.4, y: 0 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("concurrent renames of one zone: the second conflicts through the label's expectation (spec §9)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("z");
    alice.shell.click({ x: 3, y: 2 }); // labels the room "Room 1" and selects the zone
    await net.settle();
    bob.shell.key("z");
    bob.shell.click({ x: 3, y: 2 }); // a labelled room: Bob only selects it
    alice.shell.ui({ type: "setField", fieldId: "name", value: "Kitchen" });
    bob.shell.ui({ type: "setField", fieldId: "name", value: "Dining" });
    alice.pump(); // Alice's rename arrives first
    bob.pump();
    await net.settle();
    const names = (c: typeof alice) => Object.values(c.shell.doc().zoneLabels).map((l) => l.name);
    expect(names(alice)).toEqual(["Kitchen"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
  });

  it("two users label the same unlabelled room at once: both labels are accepted and both show (spec §3.6)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("z");
    bob.shell.key("z");
    alice.shell.click({ x: 2, y: 2 });
    bob.shell.click({ x: 4, y: 2 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(Object.keys(alice.shell.doc().zoneLabels)).toHaveLength(2);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("demo step 8: after Alice undoes two moves, Bob's change to that joint makes her redo unavailable", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle();
    alice.shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5.2 });
    await net.settle();
    alice.shell.key("z", { meta: true });
    await net.settle();
    alice.shell.key("z", { meta: true });
    await net.settle();
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(alice.shell.view().canRedo).toBe(true);
    bob.shell.key("v");
    bob.shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    await net.settle();
    expect(alice.shell.state.undo.future.map((e) => e.status)).toEqual(["invalid", "invalid"]);
    expect(alice.shell.view().canRedo).toBe(false);
    const sent = submitIds(alice).length;
    alice.shell.key("z", { meta: true, shift: true });
    expect(alice.shell.view().toast).toBe(REMOTE_REDO);
    expect(submitIds(alice)).toHaveLength(sent);
  });

  it("a remote change cancels an affected drag but only refreshes an unaffected one", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const a = alice.shell;
    a.key("v");
    bob.shell.key("v");

    a.moveTo({ x: 6, y: 4 });
    a.down({ x: 6, y: 4 });
    a.moveTo({ x: 6, y: 4.4 });
    bob.shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    await net.settle();
    expect(a.view().toast).toBe("Drawing changed remotely");
    const sent = submitIds(alice).length;
    a.up({ x: 6, y: 4.4 });
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent);

    a.moveTo({ x: 6.4, y: 4 });
    a.down({ x: 6.4, y: 4 });
    a.moveTo({ x: 6.4, y: 4.4 });
    bob.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    await net.settle();
    const tool = a.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("moving");
    a.moveTo({ x: 6.4, y: 5 });
    a.up({ x: 6.4, y: 5 });
    await net.settle();
    jointAt(a.doc(), { x: 6.4, y: 5 });
    jointAt(a.doc(), { x: -0.4, y: 0 });
    expect(bob.shell.doc()).toEqual(a.doc());
  });
});
