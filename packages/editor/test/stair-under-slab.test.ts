import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A flight under a slab on the plan (riser.05, AC-05, AC-11): at the level it reaches, only what shows through the hole;
// at the floor, the flight with its break line, as ever. The room is 8 × 3; the floor slab 2.58–2.70 over all of it, its
// hole x 2.8–6, y 1–2; the flight runs from its back at x 6 to its foot at x 2.22, y 1.05–1.95.

const FLOOR = "floor/k0";
function building(...more: Command[]): Document {
  return withCommands(
    emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"),
    { type: "setCeiling", height: 5.4 },
    { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 },
    { type: "addDeckHole", opId: "h", deck: FLOOR, at: { x: 4.4, y: 1.5 }, w: 3.2, d: 1 },
    { type: "placeObject", opId: "st", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 3.78 } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR },
    ...more,
  );
}
const loftLevel = (doc: Document): Level => {
  const up = levels(doc).find((l) => l.deckIds.includes(FLOOR));
  if (!up) throw new Error("no level");
  return up;
};
const points = (p: Primitive): readonly Point[] => {
  switch (p.kind) {
    case "segment": return [p.a, p.b];
    case "polygon": return p.points;
    case "disc": return [p.center];
    default: return [];
  }
};
const SLAB_END = 2.8; // the hole's west side: the flight's lower part runs on to x 2.22 under the slab

describe("at the level a flight reaches", () => {
  const layer = (doc: Document) => objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80);

  it("draws no line, fill or dot of the flight over the slab", () => {
    const over = layer(building()).filter((p) => p.kind !== "text").flatMap(points).filter((q) => q.x < SLAB_END - 1e-6);
    expect(over).toEqual([]);
  });

  it("draws the part in the hole, and still labels it DN", () => {
    const l = layer(building());
    expect(l.flatMap(points).some((q) => q.x > 5)).toBe(true);
    expect(l.flatMap((p) => (p.kind === "text" ? [p.text] : [])).some((t) => t.startsWith("DN"))).toBe(true);
    expect(l.some((p) => p.kind === "polygon")).toBe(true);
  });

  it("keeps the whole flight through a hole that holds it all", () => {
    const doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"), { type: "setCeiling", height: 5.4 },
      { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 },
      { type: "addDeckHole", opId: "h", deck: FLOOR, at: { x: 4.1, y: 1.5 }, w: 3.8, d: 1 },
      { type: "placeObject", opId: "st", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 3.78 } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR });
    expect(layer(doc).flatMap(points).some((q) => q.x < 2.3)).toBe(true);
  });

  it("shows a piece on the slab over the lower flight, with nothing under it", () => {
    const doc = building({ type: "placeObject", opId: "bed", state: "s0", object: { kind: "block", size: { w: 0.5, d: 0.5, h: 0.5 } }, at: { x: 2.5, y: 1.7 }, rotation: 0, deck: FLOOR });
    const over = layer(doc).filter((p) => p.kind === "polygon").flatMap(points).filter((q) => q.x < SLAB_END - 1e-6);
    expect(over.length).toBeGreaterThan(0); // the bed's own fill
    expect(over.every((q) => q.x >= 2.25 - 1e-6)).toBe(true);
    expect(layer(doc).filter((p) => p.kind === "segment").flatMap(points).filter((q) => q.x < 2.25 - 1e-6)).toEqual([]);
  });

  it("doesn't pick the stair at the loft's level, on the slab or in the hole: it is picked from the floor", () => {
    const shell = FakeShell.withDocument(building());
    shell.ui({ type: "setViewedLevel", deck: FLOOR });
    shell.click({ x: 2.5, y: 1.5 });
    expect(shell.state.selection.some((s) => s.table === "placements")).toBe(false);
    shell.click({ x: 4.5, y: 1.5 });
    expect(shell.state.selection.some((s) => s.table === "placements")).toBe(false);
    shell.ui({ type: "setViewedLevel", deck: null });
    shell.click({ x: 4.5, y: 1.5 });
    expect(shell.state.selection.some((s) => s.table === "placements")).toBe(true);
  });
});

describe("at the floor", () => {
  it("shows the flight past the hole's end too, with its break line and UP", () => {
    const doc = building();
    const l = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    expect(l.flatMap(points).some((q) => q.x < 2.3)).toBe(true);
    expect(l.flatMap((p) => (p.kind === "text" ? [p.text] : [])).some((t) => t.startsWith("UP"))).toBe(true);
  });
});

describe("a piece hung over a flight (AC-11)", () => {
  const withCupboard = (): Document => withCommands(
    emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"), { type: "setCeiling", height: 3.2 },
    { type: "placeObject", opId: "st", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 3.78 } }, at: { x: 2, y: 1.5 }, rotation: 90, deck: null },
    { type: "setObjectSize", objectId: "st/o0", w: 0.9, d: {}, h: { standard: 2.7 } },
    { type: "placeObject", opId: "cup", state: "s0", object: { kind: "block", size: { w: 0.8, d: 0.8, h: 0.8 } }, at: { x: 7.2, y: 1.9 }, rotation: 0, deck: null },
    { type: "setObjectSize", objectId: "cup/o0", w: 0.8, d: {}, z: { standard: "ceiling" } },
    { type: "movePlacement", placementId: "cup/p0", at: { x: 5.2, y: 1.9 }, rotation: 0 },
  );

  it("draws its dashed outline after the flight's fill, so every renderer shows it", () => {
    const doc = withCupboard();
    const l = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    const lastFill = l.map((p) => p.kind).lastIndexOf("polygon");
    const dashes = l.flatMap((p, i) => (p.kind === "segment" && p.dash !== undefined && points(p).every((q) => q.x >= 4.8 - 1e-6 && q.x <= 5.6 + 1e-6 && q.y >= 1.1 - 1e-6 && q.y <= 1.9 + 1e-6) ? [i] : []));
    expect(dashes.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...dashes)).toBeGreaterThan(lastFill);
  });
});
