import { describe, expect, it } from "vitest";
import { ceilingHeight, placementRange, wallRange, type Command } from "@fm/domain";
import { wallBetween } from "@fm/editor/testing";
import type { ClientMessage, Point } from "@fm/protocol";
import { Net, projectIdOf, sharedRoom, submitIds, type Client } from "./net";

// Heights with two editors and the real server (heights.27, AC-04): the ceiling, wall tops and heights reach the other
// client, and the server's validator refuses the loser of a race in height. The shared room is 6 × 4 m, inner faces
// at y 0.1 / 3.9.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });
const firstState = (c: Client): string => Object.values(c.shell.doc().states)[0]?.id ?? "";

describe("heights with two editors (AC-04)", () => {
  it("a half wall and a ceiling set by one client reach the other", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const bottom = wallBetween(alice.shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    run(alice, { type: "setWallTop", wallId: bottom, top: 1.1 });
    await net.settle();
    run(alice, { type: "setCeiling", height: 2.2 });
    await net.settle();
    expect(ceilingHeight(bob.shell.doc())).toBe(2.2);
    expect(wallRange(bob.shell.doc(), bottom)).toEqual({ bottom: 0, top: 1.1 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("the Ceiling section in Properties sets 2.20 and it reaches the other client (AC-04)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("Escape"); // nothing selected: the Ceiling section shows
    expect(alice.shell.view().ceiling?.find((f) => f.id === "ceiling.height")?.value).toBe("2.50");
    alice.shell.ui({ type: "setField", fieldId: "ceiling.height", value: "2.2" });
    await net.settle();
    expect(ceilingHeight(bob.shell.doc())).toBe(2.2);
    expect(bob.shell.view().ceiling?.find((f) => f.id === "ceiling.height")?.value).toBe("2.20");
    expect(bob.shell.view().cut).toBe("Cut +1.10");
  });

  it("one client lowers the ceiling to 2.20 while the other raises a wardrobe to 2.30: the server refuses the second, both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, { type: "placeObject", deck: null, opId: "w", state: firstState(alice), object: { kind: "wardrobe" }, at: { x: 1, y: 3.6 } });
    await net.settle();
    const wardrobe = Object.values(bob.shell.doc().objects).find((o) => o.kind === "wardrobe")?.id ?? "";
    expect(wardrobe).not.toBe("");
    alice.holding = true;
    bob.holding = true;
    const sent = submitIds(bob).length;
    run(alice, { type: "setCeiling", height: 2.2 });
    run(bob, { type: "setObjectSize", objectId: wardrobe, w: 1.2, d: {}, h: { standard: 2.3 } });
    expect(submitIds(bob)).toHaveLength(sent + 1); // Bob's own pre-check passed: he has not seen the ceiling yet
    await net.settle(); // both reach the server, Alice's first; the replies wait
    alice.holding = false;
    bob.holding = false;
    await net.settle();
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, "Heights must fit under the ceiling"]); // a server-only refusal names no piece
    for (const c of [alice, bob]) {
      const doc = c.shell.doc();
      const p = Object.values(doc.placements).find((x) => x.object === wardrobe);
      expect([ceilingHeight(doc), p && placementRange(doc, p.id)]).toEqual([2.2, { bottom: 0, top: 2.05 }]);
    }
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});

// A piece lowered to fit (clarity.06, AC-09): the 2.03 comes from a real gesture under a loft over x 0.1–3.1, and goes
// through the stored `h`.
describe("a piece lowered to fit, with two editors", () => {
  const UNDER: Point = { x: 1.5, y: 2 };
  const addLoft: Command = { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.6, y: 2 }, w: 3, d: 3.8 };
  const wardrobeHeights = (c: Client): (number | undefined)[] => Object.values(c.shell.doc().objects).filter((o) => o.kind === "wardrobe").map((o) => o.h["standard"]);

  /** Under a loft, a wardrobe from the library, as a click with the Object tool. */
  function clickWardrobe(c: Client): void {
    c.shell.ui({ type: "pickKind", kind: "wardrobe" });
    c.shell.moveTo(UNDER);
    c.shell.click(UNDER);
  }
  /** The submitted piece at another height: what an editor skipping its own check would send. */
  const atHeight = (h: number) => (m: ClientMessage): ClientMessage => {
    if (m.type !== "submit") return m;
    const puts = m.changeset.patch.puts.map((p) => (p.table === "objects" ? { ...p, entity: { ...p.entity, h: { standard: h } } } : p));
    return { ...m, changeset: { ...m.changeset, patch: { ...m.changeset.patch, puts } } };
  };

  it("a placed piece's h reaches the other client and both documents match", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, addLoft);
    await net.settle();
    clickWardrobe(alice);
    await net.settle();
    expect(wardrobeHeights(bob)).toEqual([2.03]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    const carol = net.join("Carol"); // from the store, not from a message
    await net.settle();
    carol.shell.ui({ type: "openProject", id: projectIdOf(alice) });
    await net.settle();
    expect(wardrobeHeights(carol)).toEqual([2.03]);
  });

  it("a bad h is refused by the server's validation", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    run(alice, addLoft);
    await net.settle();
    for (const [bad, what] of [[0.001, "under the smallest height"], [2.04, "into the loft"], [2.6, "through the ceiling"]] as const) {
      alice.tamper = atHeight(bad);
      clickWardrobe(alice);
      await net.settle();
      expect(alice.shell.view().toast, what).not.toBeNull();
      expect([wardrobeHeights(alice), wardrobeHeights(bob)], what).toEqual([[], []]);
      expect(bob.shell.doc(), what).toEqual(alice.shell.doc());
    }
    alice.tamper = atHeight(2.02); // the same message is accepted at a good height
    clickWardrobe(alice);
    await net.settle();
    expect([wardrobeHeights(alice), wardrobeHeights(bob)]).toEqual([[2.02], [2.02]]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
