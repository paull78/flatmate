import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Named areas through the real server (areas.05, .09): a stored table on the wire, I26 checked on the server, so two
// clients drawing overlapping areas at once converge with one of them refused. sharedRoom: a 6 × 4 room.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const add = (opId: string, x: number, name: string): Command => ({ type: "addArea", opId, at: { x, y: 2 }, w: 2, d: 2, name });

describe("named areas against the real server", () => {
  it("an area added by one client shows in the other, and a rename by the other comes back", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, add("k", 1.5, "Kitchen"));
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.doc().areas["k/a0"]).toEqual({ id: "k/a0", name: "Kitchen", at: { x: 1.5, y: 2 }, w: 2, d: 2 });
    run(bob, { type: "setArea", areaId: "k/a0", name: "Dining" });
    await net.settle();
    expect(alice.shell.doc().areas["k/a0"]?.name).toBe("Dining");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("two clients adding overlapping areas at once converge, and the second is refused", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, add("k", 1.5, "Kitchen"));
    run(bob, add("l", 2.5, "Living")); // both see no area, so both pass their own check
    alice.pump();
    bob.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBe("Named areas can't overlap"); // a server rejection carries no names (I26)
    expect(Object.values(bob.shell.doc().areas).map((a) => a.name)).toEqual(["Kitchen"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("areas side by side land together", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, add("k", 1.1, "Kitchen")); // x 0.1–2.1
    run(bob, add("l", 3.1, "Living")); // x 2.1–4.1: touching
    alice.pump();
    bob.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBeNull();
    expect(Object.keys(alice.shell.doc().areas).sort()).toEqual(["k/a0", "l/a0"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
