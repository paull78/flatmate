import { describe, expect, it } from "vitest";
import { stackOrder, type Command, type Document } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import { roomDoc, withCommands } from "./builders";

// A stair draws over the pieces it passes over (stairs.59): the user's desk under an alternating tread's high end hid the
// stair's dashed upper half, the desk being drawn after it (equal bottoms, then by ID).

describe("stacking stairs", () => {
  it("a stair comes after a piece whose bottom is below its top, and before one wholly above it", () => {
    const stair = { id: "a", range: { bottom: 0, top: 2.15 }, stair: true };
    const desk = { id: "z", range: { bottom: 0, top: 0.75 } };
    const cabinet = { id: "b", range: { bottom: 2.3, top: 2.9 } };
    expect([cabinet, desk, stair].sort(stackOrder).map((x) => x.id)).toEqual(["z", "a", "b"]);
    expect([stair, desk].sort(stackOrder).map((x) => x.id)).toEqual(["z", "a"]);
  });

  it("an alternating tread over a desk draws its dashed upper half after the desk's fill", () => {
    // roomDoc: inner faces x 0.1–5.9, y 0.1–3.9; a loft over x 0.1–3.6; the stair's back edge on its edge at (3.6, 2.1),
    // rising toward −x (x 3.6–4.72); a desk whose id sorts after the stair's ("zz" > "s") reaching under its high end.
    const doc: Document = withCommands(roomDoc(),
      { type: "setCeiling", height: 3.2 } as Command,
      { type: "addDeck", opId: "k", preset: "loft", at: { x: 1.85, y: 2 }, w: 3.5, d: 3.8 } as Command,
      { type: "placeObject", opId: "s", state: "s0", object: { kind: "alternatingTread" }, at: { x: 3.6, y: 2.1 }, rotation: 90, deck: null } as Command,
      { type: "placeObject", opId: "zz", state: "s0", object: { kind: "desk" }, at: { x: 3.375, y: 2.4 }, rotation: 0, deck: null } as Command);
    const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    const deskFill = layer.findIndex((p) => p.kind === "polygon" && p.points.length >= 4 && p.points.some((q) => Math.abs(q.x - 2.775) < 1e-6));
    const lastDash = layer.reduce((last, p, i) => (p.kind === "segment" && p.dash ? i : last), -1);
    expect(deskFill).toBeGreaterThanOrEqual(0);
    expect(lastDash).toBeGreaterThan(deskFill);
    expect(layer.slice(0, deskFill).some((p) => p.kind === "segment" && p.dash)).toBe(false);
  });

  it("a stair's label draws over every piece, as WebGL's text overlay draws it", () => {
    // A chair on the loft is drawn after the stair (its bottom is the stair's top); the label still comes last.
    const doc: Document = withCommands(roomDoc(),
      { type: "setCeiling", height: 3.2 } as Command,
      { type: "addDeck", opId: "k", preset: "loft", at: { x: 1.85, y: 2 }, w: 3.5, d: 3.8 } as Command,
      { type: "placeObject", opId: "s", state: "s0", object: { kind: "alternatingTread" }, at: { x: 3.6, y: 2.1 }, rotation: 90, deck: null } as Command,
      { type: "placeObject", opId: "zz", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 3 }, rotation: 0, deck: "k/k0" } as Command);
    const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    const firstText = layer.findIndex((p) => p.kind === "text");
    const lastShape = layer.reduce((last, p, i) => (p.kind !== "text" ? i : last), -1);
    expect(layer.some((p) => p.kind === "text" && p.text.startsWith("UP"))).toBe(true);
    expect(firstText).toBeGreaterThan(lastShape);
  });
});
