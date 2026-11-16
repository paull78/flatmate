import { describe, expect, it } from "vitest";
import { Net, sharedRoom } from "./net";

// The new opening kinds over the wire (openkinds, library.19): a stored-shape change, so a kind one client adds must
// reach the other unchanged and draw the same there. The shared room is 6 × 4, its bottom wall along y 0.

describe("new opening kinds between two clients", () => {
  it("a folding door and a pocket door Alice places reach Bob as stored, and draw the same for both", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "pickOpeningKind", kind: "folding" });
    alice.shell.click({ x: 1.5, y: 0.05 });
    await net.settle();
    alice.shell.ui({ type: "pickOpeningKind", kind: "pocket" });
    alice.shell.click({ x: 4.5, y: 0.05 });
    await net.settle();

    expect(net.fatal).toEqual([]);
    const kinds = Object.values(alice.shell.doc().openings).map((o) => o.kind).sort();
    expect(kinds).toEqual(["folding", "pocket"]);
    expect(bob.shell.doc().openings).toEqual(alice.shell.doc().openings);
    const openings = (c: typeof alice) => c.shell.simpleScene().layers.find((l) => l.name === "openings")?.primitives;
    expect(openings(bob)).toEqual(openings(alice));
  });

  it("a pocket door refused for its pocket on one client changes nothing for the other", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "pickOpeningKind", kind: "window" });
    alice.shell.click({ x: 3, y: 0.05 }); // x 2.5–3.5
    await net.settle();
    bob.shell.ui({ type: "pickOpeningKind", kind: "pocket" });
    bob.shell.click({ x: 1.4, y: 0.05 }); // its pocket would run x 1.8–2.6, over the window
    await net.settle();

    expect(bob.shell.view().toast).toBe("A pocket door's pocket would overlap a window");
    expect(Object.values(alice.shell.doc().openings).map((o) => o.kind)).toEqual(["window"]);
    expect(bob.shell.doc().openings).toEqual(alice.shell.doc().openings);
  });
});
