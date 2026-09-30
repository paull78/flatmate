import { describe, expect, it } from "vitest";
import { zones } from "@fm/domain";
import { Net, seqOf, sharedRoom, submitIds } from "./net";

const areas = (doc: Parameters<typeof zones>[0]) => zones(doc).map((z) => z.area?.toFixed(2));

describe("two editors on the real server app", () => {
  it("creates, opens and draws a room; the second editor sees the same drawing", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    expect(Object.keys(alice.shell.doc().walls)).toHaveLength(4);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(seqOf(bob)).toBe(seqOf(alice));
    expect(alice.shell.view().project).toEqual({ name: "Apartment", status: "saved", dirty: false, canEdit: true });
    expect(submitIds(alice)).toHaveLength(4);
    expect(net.fatal).toEqual([]);
  });

  it("relays presence between the editors and removes it when one leaves", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.moveTo({ x: 1, y: 1 });
    await net.settle();
    expect(bob.shell.view().presence).toEqual([{ clientId: "alice", name: "Alice", color: alice.shell.state.me.color, at: { x: 1, y: 1 } }]);
    alice.disconnect();
    await net.settle();
    expect(bob.shell.view().presence).toEqual([]);
  });

  it("demo step 7: Bob moves a wall and Alice's room area changes", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    expect(areas(alice.shell.doc())).toEqual(["22.04"]); // 5.8 × 3.8 clear
    bob.shell.key("v");
    bob.shell.drag({ x: 6, y: 2 }, { x: 7, y: 2 });
    await net.settle();
    expect(areas(alice.shell.doc())).toEqual(["25.84"]); // 6.8 × 3.8 clear
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
