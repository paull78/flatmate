import { describe, expect, it } from "vitest";
import { MIN_ZONE_SIZE, nullZones, zoneExtent, type Document } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Use-zone extents with two editors (furnish.14, .20; spec: layouts): setZoneExtent depends on its placement, its
// object and its layout, so it conflicts with a resize or a Kind switch of the same piece in either order. The
// resize-first race is layout.test.ts's (furnish.57); this file races the other order and the Kind switch.

const LEFT = { depth: 0.4, start: 0.45, end: 0.3 };
const CONFLICT = "Someone else changed this first";

/** Alice places a bed by command at (3, 3.9): x 2.15–3.85, y 1.80–3.90, its head on the far wall. */
async function bedRoom(): Promise<{ net: Net; alice: Client; bob: Client }> {
  const net = new Net();
  const { alice, bob } = await sharedRoom(net);
  const layout = alice.shell.view().states.find((s) => s.name === "Layout")?.id;
  if (layout === undefined) throw new Error("no Layout");
  alice.shell.command({ type: "placeObject", deck: null, opId: "bed", state: layout, object: { kind: "bed" }, at: { x: 3, y: 3.9 } });
  await net.settle();
  return { net, alice, bob };
}
const leftOf = (doc: Document) => {
  const p = doc.placements["bed/p0"];
  return p ? zoneExtent(doc, p, "left") : null;
};
const leftKeys = (c: Client) => {
  const z = c.shell.doc().placements["bed/p0"]?.zones;
  return [z?.leftDepth, z?.leftStart, z?.leftEnd];
};

describe("use-zone extents with two editors (furnish.20, spec: layouts)", () => {
  it("a zone drag that arrives before a resize of the same bed wins; the resize is refused; both converge", async () => {
    const { net, alice, bob } = await bedRoom();
    alice.shell.command({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: LEFT });
    bob.shell.command({ type: "setObjectSize", objectId: "bed/o0", w: 1.7, d: { standard: 0.8 } });
    alice.pump(); // the zone arrives first
    bob.pump();
    await net.settle();

    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, CONFLICT]);
    expect(alice.shell.doc().objects["bed/o0"]?.d["standard"]).toBe(2.1);
    expect(leftKeys(alice)).toEqual([0.4, 0.45, 0.3]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.state.undo.pending).toBeNull();
  });

  it("after the zone, a later resize is accepted and both clients read the same clamped zone", async () => {
    const { net, alice, bob } = await bedRoom();
    alice.shell.command({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: LEFT });
    await net.settle();
    bob.shell.command({ type: "setObjectSize", objectId: "bed/o0", w: 1.7, d: { standard: 0.8 } });
    await net.settle();

    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    expect(leftKeys(alice)).toEqual([0.4, 0.45, 0.3]);
    expect(leftKeys(bob)).toEqual([0.4, 0.45, 0.3]);
    const a = leftOf(alice.shell.doc());
    expect(leftOf(bob.shell.doc())).toEqual(a);
    expect(a && a.start + a.end + MIN_ZONE_SIZE).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(a?.start).toBeLessThan(0.45); // clamped when read
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a zone drag and a Kind switch race: one wins, both converge", async () => {
    // Zone first: the switch, which resets the zones in every layout, is refused.
    {
      const { net, alice, bob } = await bedRoom();
      alice.shell.command({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: LEFT });
      bob.shell.command({ type: "setObjectKind", objectId: "bed/o0", kind: "wardrobe" });
      alice.pump();
      bob.pump();
      await net.settle();
      expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, CONFLICT]);
      expect(alice.shell.doc().objects["bed/o0"]?.kind).toBe("bed");
      expect(leftKeys(alice)).toEqual([0.4, 0.45, 0.3]);
      expect(bob.shell.doc()).toEqual(alice.shell.doc());
    }
    // Switch first, on a fresh net: the zone is refused.
    {
      const { net, alice, bob } = await bedRoom();
      alice.shell.command({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: LEFT });
      bob.shell.command({ type: "setObjectKind", objectId: "bed/o0", kind: "wardrobe" });
      bob.pump();
      alice.pump();
      await net.settle();
      expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([CONFLICT, null]);
      expect(alice.shell.doc().objects["bed/o0"]?.kind).toBe("wardrobe");
      expect(alice.shell.doc().placements["bed/p0"]?.zones).toEqual(nullZones());
      expect(bob.shell.doc()).toEqual(alice.shell.doc());
      expect(alice.shell.state.undo.pending).toBeNull();
    }
  });
});
