import { describe, expect, it } from "vitest";
import { tucks, type Command } from "@fm/domain";
import { Net, sharedRoom, submitIds, type Client } from "./net";

// The tuck rule with two editors and the real server (spec "Seating: the tuck rule", AC-05): a tuck reaches the other
// client, and a concurrent desk move that would put the desk over the chair's backrest is refused by the server's
// validator, the existing path for any overlap.
//
// The shared room is 6 × 4 m (inner faces x 0.1–5.9, y 0.1–3.9). The desk (1.20 × 0.60) stands against the top wall:
// anchor (3, 3.9), x 2.4–3.6, y 3.3–3.9, its front on y 3.3. The chair (0.45 × 0.45) at rotation 180 faces it; its
// anchor is its back edge's middle, so tucked 0.35 m its anchor is (3, 3.2) and its backrest strip is y 3.2–3.3.
//
//  3.9 ┌──[ desk ]──┐
//  3.3 │  └▣▣▣▣▣┘   │  the chair's seat under the desk's front, its backrest flush with it
//  3.2 │            │

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";
const placementOf = (c: Client, kind: string) => {
  const doc = c.shell.doc();
  const p = Object.values(doc.placements).find((x) => doc.objects[x.object]?.kind === kind);
  if (p === undefined) throw new Error(`${c.name} has no ${kind}`);
  return p;
};

/** Alice places the desk and Bob a chair 0.75 m in front of it (y 2.55–3.0), both settled. */
async function deskAndChair(net: Net, alice: Client, bob: Client): Promise<void> {
  run(alice, { type: "placeObject", deck: null, opId: "desk", state: firstState(alice), object: { kind: "desk" }, at: { x: 3, y: 3.9 } });
  await net.settle();
  run(bob, { type: "placeObject", deck: null, opId: "chair", state: firstState(bob), object: { kind: "chair" }, at: { x: 3, y: 2.55 }, rotation: 180 });
  await net.settle();
}

describe("the tuck rule with two editors", () => {
  it("sync: a tuck converges on both clients", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await deskAndChair(net, alice, bob);
    expect(tucks(alice.shell.doc())).toEqual([]);
    run(bob, { type: "movePlacement", placementId: placementOf(bob, "chair").id, at: { x: 3, y: 3.2 }, rotation: 180 });
    await net.settle();
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    expect(placementOf(alice, "chair").at).toEqual({ x: 3, y: 3.2 });
    expect(tucks(alice.shell.doc()).map((t) => [t.seat, t.table])).toEqual([[placementOf(alice, "chair").id, placementOf(alice, "desk").id]]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a desk move racing the tuck, valid alone, is refused by the server; both converge on the tuck", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await deskAndChair(net, alice, bob);
    alice.holding = true;
    bob.holding = true;
    const sent = submitIds(alice).length;
    run(bob, { type: "movePlacement", placementId: placementOf(bob, "chair").id, at: { x: 3, y: 3.2 }, rotation: 180 });
    bob.pump(); // Bob's tuck reaches the server first
    // Alice moves the desk 0.05 m into the room: valid alone, but its front (y 3.25) would cross the tucked backrest.
    run(alice, { type: "movePlacement", placementId: placementOf(alice, "desk").id, at: { x: 3, y: 3.85 }, rotation: 0 });
    expect(submitIds(alice)).toHaveLength(sent + 1); // her own pre-check passed: she has not seen the tuck yet
    await net.settle();
    alice.holding = false;
    bob.holding = false;
    await net.settle();
    expect(bob.shell.view().toast).toBeNull();
    expect(alice.shell.view().toast).toBe("Furniture would not fit"); // a server-only refusal names no piece
    for (const c of [alice, bob]) {
      expect(placementOf(c, "desk").at).toEqual({ x: 3, y: 3.9 });
      expect(placementOf(c, "chair").at).toEqual({ x: 3, y: 3.2 });
    }
    expect(tucks(alice.shell.doc())).toHaveLength(1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
