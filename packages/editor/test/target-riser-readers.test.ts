import { describe, expect, it } from "vitest";
import { type Document } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import { stairFaces } from "../src/view3d/stair-faces";
import { view3dItems } from "../src/view3d/items";
import { LOFT_ROOM_LOFT, loftRoomDoc, withCommands } from "./builders";

// Every reader of a stair's numbers takes its target (riser.09): the plan's label and treads, and 3D's treads, with no
// reader left on the kind's default.

function stairDoc(riser?: number): Document {
  const doc = withCommands(loftRoomDoc(), { type: "placeObject", deck: null, opId: "st", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 2.1 } }, at: { x: 3.7, y: 2.6 }, rotation: 90, reaches: LOFT_ROOM_LOFT });
  const o = doc.objects["st/o0"];
  if (!o) throw new Error("no stair");
  return riser === undefined ? doc : { ...doc, objects: { ...doc.objects, [o.id]: { ...o, riser } } };
}

const label = (doc: Document): string =>
  objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80).flatMap((p) => (p.kind === "text" ? [p.text] : [])).find((t) => t.startsWith("UP")) ?? "";

function treads3d(doc: Document): number {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i) => i.item === "piece" && i.objectKind === "stair");
  if (!item || item.item !== "piece") throw new Error("no stair item");
  return stairFaces("o", item, { top: "#000000", lit: "#000000", shaded: "#000000" }, "#000000")?.length ?? 0;
}

describe("a target riser reaches every reader", () => {
  it("the plan's label counts by the target", () => {
    expect(label(stairDoc())).toBe("UP · 12 R");
    expect(label(stairDoc(0.16))).toBe("UP · 14 R");
  });

  it("3D draws the target's treads", () => {
    expect(treads3d(stairDoc(0.16))).toBeGreaterThan(treads3d(stairDoc()));
  });

  it("the 3D item carries it only when there is one", () => {
    const item = (d: Document) => view3dItems(d, "s0", null, new Set(), false).find((i) => i.item === "piece");
    expect(item(stairDoc())).not.toHaveProperty("riser");
    expect(item(stairDoc(0.16))).toHaveProperty("riser", 0.16);
  });
});
