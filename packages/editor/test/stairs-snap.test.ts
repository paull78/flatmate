import { describe, expect, it } from "vitest";
import { emptyDocument, levelOf, rectangleRoom, validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import { contactPlace } from "../src/snapping/contact";
import { ON_FLOOR, jointAt, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The reach snap (stairs.10): a stair's back snaps flush to a deck's edge as it does to a wall face. Touching links
// nothing (stairdraw.08): in the Object tool the deck's edge catches the stair, and two clicks place it on the edge,
// linked (stairdraw.11). Furniture ignores deck edges.
//
// The landing scenarios' studio: inner faces x 0.1–6.9, y 0.1–2.4, ceiling 3.05; the loft (loft/k0, top 2.15) covers
// x 0.1–3.6; the platform (plat/k0, top 0.45) x 4.5–6.9, y 0.1–1.4. Free floor beside the loft's right edge above y 1.4.

const LOFT = "loft/k0";

function studio(): Document {
  let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"), { type: "addWall", opId: "part", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 2.5 } } });
  const partition = wallBetween(doc, { x: 2, y: 0 }, { x: 2, y: 2.5 });
  void jointAt;
  doc = withCommands(
    doc,
    { type: "setWallTop", wallId: partition, top: 2.03 },
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 5.7, y: 0.75 }, w: 2.4, d: 1.3 },
  );
  return doc;
}

const STAIR = { w: 0.6, d: 1.99 };
const opts = (doc: Document, kind: string) => ({ tolerance: 0.125, free: false, kind, riser: null, heights: ON_FLOOR, surface: null, land: false as const, level: levelOf(doc, null) });

describe("contactPlace with deck edges", () => {
  it("a storage stair near the loft's right edge turns its back to it and lands flush (rotation 90, back edge on x = 3.6)", () => {
    const doc = studio();
    // Centred at x 3.95 at rotation 0: its left side (x 3.65) is 5 cm from the loft's edge.
    expect(contactPlace(doc, "s0", STAIR, { x: 3.95, y: 1.95 }, 0, opts(doc, "storageStair"))).toMatchObject({ at: { x: 3.6, y: 1.95 }, rotation: 90 });
  });

  it("a custom box of the same size beside the loft ignores its edge", () => {
    const doc = studio();
    expect(contactPlace(doc, "s0", STAIR, { x: 3.95, y: 1.95 }, 0, opts(doc, "block"))).toMatchObject({ rotation: 0 });
  });
});

describe("the Object tool places a stair against a deck (stairs.10, stairdraw.08)", () => {
  function shellOf(doc: Document): FakeShell {
    expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setSnapStep", step: 0.1 });
    return shell;
  }
  const stairOf = (shell: FakeShell): Placement => {
    const p = Object.values(shell.doc().placements).find((q) => shell.doc().objects[q.object]?.kind === "storageStair");
    if (!p) throw new Error("no stair");
    return p;
  };

  it("clicked twice by the loft's edge, it lands on the edge, flush to its end, and reaches the loft at 2.15", () => {
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "storageStair" });
    shell.click({ x: 3.95, y: 2.03 });
    shell.click({ x: 3.95, y: 2.03 });
    const p = stairOf(shell);
    // The edge runs from y 0.1 to 2.4: the 0.60 stair's side is 0.07 from its end, within the 10 px (0.125 m at 80 px/m,
    // stairdraw.59), so it goes flush (y 2.4 − 0.3).
    expect({ at: p.at, rotation: p.rotation }).toEqual({ at: { x: 3.6, y: 2.1 }, rotation: 90 });
    expect(shell.doc().objects[p.object]).toMatchObject({ reaches: LOFT, h: { standard: 2.15 } });
  });

  it("dragged away it keeps the link; dropped against the platform's top edge it still reaches the loft at 2.15", () => {
    const commands: Command[] = [
      { type: "placeObject", opId: "s", state: "s0", object: { kind: "storageStair", size: { w: 0.6, d: 0.9 } }, at: { x: 3.6, y: 1.95 }, rotation: 90, deck: null, reaches: LOFT },
    ];
    const shell = shellOf(withCommands(studio(), ...commands));
    expect(shell.doc().objects["s/o0"]).toMatchObject({ reaches: LOFT });
    shell.drag({ x: 4.05, y: 1.95 }, { x: 4.45, y: 1.95 }); // its middle, 0.4 m right: away from the loft
    expect(shell.doc().objects["s/o0"]).toMatchObject({ reaches: LOFT, h: { standard: 2.15 } });
    // Now by the platform's top edge (y 1.4): its left side 5 cm above it, the stair turns its back down onto it (180).
    shell.drag({ x: 4.45, y: 1.95 }, { x: 5.7, y: 1.75 });
    expect(shell.doc().placements["s/p0"]).toMatchObject({ at: { y: 1.4 }, rotation: 180 }); // flush on the platform's edge
    expect(shell.doc().objects["s/o0"]).toMatchObject({ reaches: LOFT, h: { standard: 2.15 } });
  });
});
