import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, zoneExtent, type Command, type Document } from "@fm/domain";
import { zoneFrames } from "../src/snapping/zone-drag";
import { dragTry } from "../src/tools/drag";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A zone off its deck's edge (AC-05): its handles stop at the edge with it, and what's stored isn't touched. The platform
// runs y 1.75–3.25; the sofa on it y 2.25–3.15, its front zone 1.00 deep, so 0.50 of it on the platform.

const on = (y: number, ...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "r"),
  { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 2.5 }, w: 3, d: 1.5, top: 0.45, solid: false },
  { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa", preset: "2 seats" }, at: { x: 3, y }, rotation: 0, deck: "plat/k0" },
  { type: "setZoneSides", placementId: "sofa/p0", sides: { front: true, back: false, left: false, right: false } },
  { type: "setZoneExtent", placementId: "sofa/p0", side: "front", extent: { depth: 1, start: 0, end: 0 } },
  ...more,
);

describe("a zone off its deck's edge", () => {
  it("its frame stops at the edge, with the stored depth kept", () => {
    const doc = on(3.15);
    const [f] = zoneFrames(doc, "sofa/p0", "front");
    expect(f?.extent.depth).toBeCloseTo(0.5, 6);
    const p = doc.placements["sofa/p0"];
    expect(p && zoneExtent(doc, p, "front")?.depth).toBe(1);
  });

  it("dragging its depth handle in stores what the drag shows", () => {
    const doc = on(3.15);
    const shell = FakeShell.withDocument(doc);
    const press = { x: 3, y: 1.75 }; // on the outer line, at the edge
    const { tried } = dragTry(shell.state, doc, { kind: "zoneDepth", placementId: "sofa/p0", side: "front" }, press, { x: 3, y: 1.95 }, 0);
    expect(tried).toMatchObject({ kind: "zoneExtent", side: "front", extent: { depth: 0.3 } });
  });

  it("none left on the deck: no frame, so no handles or chip", () => {
    expect(zoneFrames(on(2.65), "sofa/p0", "front")).toEqual([]);
  });
});
