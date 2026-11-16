import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// An `L` piece's arms with two editors and the real server (catalog.18, AC-02): one client changes the arms, in
// Properties or with its sizes in one size command, and the other client's document has them. The shared room is
// 6 × 4 m, inner faces at y 0.1 / 3.9; the corner desk stands against the top wall, x 2.2–3.8, y 2.7–3.9.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";

async function withDesk(net: Net): Promise<{ alice: Client; bob: Client; desk: string }> {
  const { alice, bob } = await sharedRoom(net);
  run(alice, { type: "placeObject", deck: null, opId: "k", state: firstState(alice), object: { kind: "cornerDesk" }, at: { x: 3, y: 3.9 } });
  await net.settle();
  const desk = Object.values(bob.shell.doc().objects).find((o) => o.kind === "cornerDesk")?.id ?? "";
  expect(desk).not.toBe("");
  return { alice, bob, desk };
}

describe("arms with two editors", () => {
  it("Alice types a 0.50 back arm in Properties and Bob's document has it", async () => {
    const net = new Net();
    const { alice, bob, desk } = await withDesk(net);
    alice.shell.key("v"); // the Select tool, after the drawn room
    alice.shell.click({ x: 3, y: 3.7 });
    alice.shell.ui({ type: "setField", fieldId: "backArm", value: "0.5" });
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.doc().objects[desk]?.arms).toEqual({ back: 0.5, left: 0.6 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("Alice shrinks the depth with a thinner arm in one size command and Bob's document has both", async () => {
    const net = new Net();
    const { alice, bob, desk } = await withDesk(net);
    run(alice, { type: "setObjectSize", objectId: desk, w: 1.6, d: { standard: 0.65 }, arms: { back: 0.4, left: 0.6 } });
    await net.settle();
    expect(bob.shell.doc().objects[desk]).toMatchObject({ d: { standard: 0.65 }, arms: { back: 0.4, left: 0.6 } });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
