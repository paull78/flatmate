import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { CEILING_ID, type Ceiling, type Document } from "../src/model";
import { highSide, roofOf, type Falls } from "../src/roof";
import { ceilingAtPoint } from "../src/roof";
import { wallRange } from "../src/queries/vertical";
import { validateDocument } from "../src/validate";
import { place, rectDoc, withDeck } from "./helpers";

// setCeiling with a roof (roofs.03, .07, .15, .20) and every check under the slope (roofs.02, .09, .17; AC-03, AC-04, AC-06).

/** A 6.00 × 2.55 m outer box; the room inside runs 0.20 to 5.80 and 0.20 to 2.35. */
const house = (): Document => rectDoc(0.1, 0.1, 5.9, 2.45);
const roofed = (doc: Document, c: Omit<Ceiling, "id">): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const shedOn = (doc: Document, height: number, falls: Falls = "-y", pitch = 10): Document => roofed(doc, { height, shape: "shed", pitch, falls, overhang: 0.3 });
const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const wardrobe = (doc: Document, y: number, h = 2.4): Document =>
  place(doc, { object: "w", kind: "wardrobe", at: [3, y], state: "s0", size: { w: { standard: 1 }, d: { standard: 0.6 }, h: { standard: h } } });

describe("setCeiling with a roof", () => {
  it("takes the whole set, and a later height alone keeps the shape and the pitch", () => {
    const shed = run(house(), { type: "setCeiling", shape: "shed", height: 2.75, pitch: 10 });
    expect(roofOf(shed)).toMatchObject({ shape: "shed", height: 2.75, pitch: 10 });
    const higher = run(shed, { type: "setCeiling", height: 2.85 });
    expect(roofOf(higher)).toMatchObject({ shape: "shed", height: 2.85, pitch: 10 });
    expect(highSide(higher)).toBe(3.3);
  });

  it("solves the pitch from a high side, and refuses a pitch and a high side together", () => {
    const shed = run(house(), { type: "setCeiling", shape: "shed", height: 2.75, pitch: 10 });
    expect(highSide(run(shed, { type: "setCeiling", highSide: 3.4 }))).toBe(3.4);
    const both = execute(shed, { type: "setCeiling", pitch: 12, highSide: 3.4 });
    expect(both.ok ? null : both.error.kind).toBe("invalidInput");
    const flat = execute(house(), { type: "setCeiling", highSide: 3.4 });
    expect(flat.ok ? null : flat.error.kind).toBe("invalidInput");
  });

  it("starts the direction from the box on a first Shed or Gable, and keeps it across shapes (roofs.15)", () => {
    expect(roofOf(run(house(), { type: "setCeiling", shape: "shed" })).falls).toBe("-y");
    expect(roofOf(run(rectDoc(0.1, 0.1, 2.45, 5.9), { type: "setCeiling", shape: "gable" })).falls).toBe("-x");
    const right = run(run(house(), { type: "setCeiling", shape: "shed", falls: "+x" }), { type: "setCeiling", shape: "gable" });
    expect(roofOf(run(right, { type: "setCeiling", shape: "shed" })).falls).toBe("+x");
  });

  it("refuses a direction or a shape that isn't one", () => {
    expect(execute(house(), { type: "setCeiling", shape: "hip" as "shed" }).ok).toBe(false);
    expect(execute(house(), { type: "setCeiling", shape: "shed", falls: "north" as "-y" }).ok).toBe(false);
  });
});

describe("switching shapes (roofs.07, AC-06)", () => {
  it("Flat to Shed keeps the height as the low side and is never refused", () => {
    const furnished = wardrobe(roofed(house(), { height: 2.5 }), 0.8, 2.45);
    const shed = run(furnished, { type: "setCeiling", shape: "shed" });
    expect(roofOf(shed).height).toBe(2.5);
  });

  it("back to Flat is refused when something stands above the low side, and nothing changes", () => {
    const doc = wardrobe(shedOn(house(), 2.3), 2.35);
    const r = execute(doc, { type: "setCeiling", shape: "flat" });
    expect(r.ok).toBe(false);
  });
});

describe("pieces under the slope (AC-04)", () => {
  it("a 2.40 m wardrobe against the low wall is refused with the ceiling there, and accepted by the high wall", () => {
    const doc = shedOn(house(), 2.3);
    const low = execute(doc, { type: "placeObject", opId: "o1", state: "s0", object: { kind: "wardrobe", size: { w: 1, d: 0.6, h: 2.4 } }, at: { x: 3, y: 0.8 }, deck: null });
    expect(low.ok).toBe(false);
    expect(low.ok ? "" : low.error.message).toContain("2.34");
    const high = execute(doc, { type: "placeObject", opId: "o1", state: "s0", object: { kind: "wardrobe", size: { w: 1, d: 0.6, h: 2.4 } }, at: { x: 3, y: 2.35 }, deck: null });
    expect(high.ok).toBe(true);
  });
});

describe("wall edits move the roof (AC-03)", () => {
  it("moving the high wall 0.50 m out keeps the low side and the pitch, and raises the high side", () => {
    const doc = shedOn(house(), 2.75);
    const out = run(doc, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 5.9, y: 2.95 } }, { jointId: "J4", to: { x: 0.1, y: 2.95 } }] });
    expect(roofOf(out)).toMatchObject({ height: 2.75, pitch: 10 });
    expect(highSide(out)).toBe(3.288);
    for (const p of [{ x: 1, y: 0.3 }, { x: 3, y: 1.2 }, { x: 5, y: 2.5 }]) expect(ceilingAtPoint(out, p)).toBeGreaterThanOrEqual(ceilingAtPoint(doc, p));
  });

  it("moving the low wall in, under a piece that then no longer fits, is refused and nothing changes", () => {
    const doc = wardrobe(shedOn(house(), 2.3, "+y"), 1.2);
    const r = execute(doc, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 5.9, y: 1.55 } }, { jointId: "J4", to: { x: 0.1, y: 1.55 } }] });
    expect(r.ok).toBe(false);
  });
});

describe("walls under the slope (roofs.09, .17)", () => {
  it("a full wall's range tops at its highest point", () => {
    const doc = shedOn(house(), 2.75);
    expect(wallRange(doc, "W2")?.top).toBe(3.2); // the right wall, along y: from the low side up to the high one
    expect(wallRange(doc, "W1")?.top).toBe(2.785); // the low wall: the slope over its 0.20 m, at its inner face
  });

  it("a fixed-top wall must stay under the lowest ceiling along it", () => {
    const doc = shedOn(house(), 2.3);
    expect(execute(doc, { type: "setWallTop", wallId: "W1", top: 2.4 }).ok).toBe(false);
    expect(execute(doc, { type: "setWallTop", wallId: "W3", top: 2.4 }).ok).toBe(true);
  });

  it("a full wall is never refused for rising to the ceiling", () => {
    expect(execute(house(), { type: "setCeiling", shape: "gable", height: 2.3, pitch: 35 }).ok).toBe(true);
  });

  it("a loft whose slab meets the slope is refused, one under it accepted", () => {
    const doc = shedOn(house(), 2.3);
    expect(validateDocument(withDeck(doc, { id: "L", at: [3, 0.9], w: 2, d: 1.2, top: 2.4, solid: false })).ok).toBe(false);
    expect(validateDocument(withDeck(doc, { id: "L", at: [3, 1.9], w: 2, d: 0.8, top: 2.15, solid: false })).ok).toBe(true);
  });
});
