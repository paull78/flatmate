import { describe, expect, it } from "vitest";
import { execute, levelOf, unwrap, type Document } from "@fm/domain";
import { contactPlace } from "../src/snapping/contact";
import type { ObjectGhost } from "../src/tools/types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Object tool's ghost and its click pass the new piece's heights to the fit (heights.12, step 03): a desk fits
// under a raised bed, a wardrobe does not.

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);

/** The 6 × 4 room with a 1.60 × 2.00 bed on the top wall (x 2.2–3.8, y 1.9–3.9) raised to 1.45–1.80 as a loft. */
function loftDoc(): Document {
  let doc = unwrap(execute(roomDoc(), { type: "placeObject", deck: null, opId: "loft", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } })).doc;
  doc = unwrap(execute(doc, { type: "setObjectSize", objectId: "loft/o0", w: 1.6, d: { standard: 2 } })).doc;
  const bed = doc.objects["loft/o0"];
  if (!bed) throw new Error("no bed");
  return { ...doc, objects: { ...doc.objects, [bed.id]: { ...bed, h: { standard: 0.35 }, z: { standard: 1.45 } } } };
}

describe("the Object tool in height", () => {
  it("a desk's ghost fits under the loft and its click places it; a wardrobe's ghost is red there", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "pickKind", kind: "desk" });
    shell.moveTo({ x: 3, y: 3.5 });
    expect(ghost(shell)).toMatchObject({ kind: "desk", fits: true });
    shell.click({ x: 3, y: 3.5 });
    expect(Object.values(shell.doc().objects).map((o) => o.kind).sort()).toEqual(["bed", "desk"]);
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 3, y: 2.5 });
    expect(ghost(shell)).toMatchObject({ kind: "wardrobe", fits: false });
  });
});

describe("contact plus fit in height", () => {
  it("a turn onto a wall is taken when the turned piece fits under a raised one, by the piece's own heights", () => {
    // The loft turned against the left wall: x 0.1–2.1, y 1.2–2.8 at 1.45–1.80.
    let doc = unwrap(execute(roomDoc(), { type: "placeObject", deck: null, opId: "loft", state: "s0", object: { kind: "bed" }, at: { x: 0.1, y: 2 }, rotation: 90 })).doc;
    doc = unwrap(execute(doc, { type: "setObjectSize", objectId: "loft/o0", w: 1.6, d: { standard: 2 } })).doc;
    const bed = doc.objects["loft/o0"];
    if (!bed) throw new Error("no bed");
    doc = { ...doc, objects: { ...doc.objects, [bed.id]: { ...bed, h: { standard: 0.35 }, z: { standard: 1.45 } } } };
    // A desk whose left side is 5 cm from the left wall's face: the contact turns that side to the back.
    const desk = (heights: { h: number; z: number }) =>
      contactPlace(doc, "s0", { w: 1.2, d: 0.6 }, { x: 0.75, y: 2 }, 0, { tolerance: 0.125, free: false, kind: "desk", riser: null, heights, surface: null, land: false, level: levelOf(doc, null) });
    expect(desk({ h: 0.75, z: 0 }).rotation).toBe(90);
    expect(desk({ h: 1.6, z: 0 }).rotation).toBe(0); // a 1.60 m box would hit the loft: the turn is not taken
  });
});
