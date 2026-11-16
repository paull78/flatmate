import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Primitive } from "../src/view/scene-types";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { objectsLayer } from "../src/view/objects-layer";
import { wallsLayer } from "../src/view/walls-layer";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";
import { floorView } from "../src/view/plan-view";

// The plan as a horizontal cut (heights.15, .38, AC-09): walls ending at or below the cut draw as thin unfilled
// outlines, pieces wholly above it as a dashed outline with no fill and no symbol, pieces lowest bottom first.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });

/** A 6 × 4 room with a desk on the top wall and a wall cabinet on the bottom one, and a free-standing 1.10 m half wall. */
function drawing(): Document {
  let doc = ok(roomDoc(), place("d", "desk", 1.5, 3.9), { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "wallCabinet" }, at: { x: 4, y: 0.1 }, rotation: 180 });
  doc = ok(doc, { type: "addWall", opId: "pen", from: { at: { x: 2, y: 2 } }, to: { at: { x: 3.5, y: 2 } } }, { type: "setWallTop", wallId: "pen/w0", top: 1.1 });
  return doc;
}
const NONE = "";
const objects = (doc: Document, style: PlanStyle = CANVAS_STYLE) => objectsLayer(doc, floorView(doc, "s0"), style, NONE, 80);
const walls = (doc: Document, style: PlanStyle = CANVAS_STYLE) => wallsLayer(doc, floorView(doc, null).level, style, NONE, null, NONE, null);
/** The primitives drawn for a piece: those inside its footprint's box. */
const near = (ps: readonly Primitive[], x0: number, x1: number, y0: number, y1: number): Primitive[] =>
  ps.filter((p) => {
    const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : [];
    return pts.length > 0 && pts.every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= y0 - 1e-6 && q.y <= y1 + 1e-6);
  });
const kinds = (ps: readonly Primitive[]) => [...new Set(ps.map((p) => (p.kind === "segment" && p.dash ? "dashed" : p.kind)))].sort();

describe("the cut on the canvas (AC-09)", () => {
  it("under 2.50 a wall cabinet at 1.40 draws dashed, with no polygon and no symbol; the desk as today", () => {
    const doc = drawing();
    const cabinet = near(objects(doc), 3.7, 4.3, 0.1, 0.45); // x 3.7–4.3, y 0.1–0.45
    expect(kinds(cabinet)).toEqual(["dashed"]);
    expect(cabinet).toHaveLength(4);
    const desk = near(objects(doc), 0.9, 2.1, 3.3, 3.9);
    expect(kinds(desk)).toEqual(["polygon", "segment"]);
  });

  it("a 1.10 half wall draws as an unfilled outline; a full wall as today", () => {
    const doc = drawing();
    const half = near(walls(doc), 1.8, 3.7, 1.8, 2.2);
    expect(kinds(half)).toEqual(["segment"]);
    expect(half.every((p) => p.kind === "segment" && "px" in p.width && p.width.px === CANVAS_STYLE.projectionWidth)).toBe(true);
    const full = near(walls(doc), -0.2, 6.2, -0.2, 0.2);
    expect(kinds(full)).toEqual(["polygon", "segment"]);
  });

  it("a half wall exactly at the cut draws in projection; 1 cm above it, solid", () => {
    const at = ok(drawing(), { type: "setWallTop", wallId: "pen/w0", top: 1.2 });
    expect(kinds(near(walls(at), 1.8, 3.7, 1.8, 2.2))).toEqual(["segment"]);
    const above = ok(drawing(), { type: "setWallTop", wallId: "pen/w0", top: 1.21 });
    expect(kinds(near(walls(above), 1.8, 3.7, 1.8, 2.2))).toEqual(["polygon", "segment"]);
  });

  it("lowering the ceiling to 2.20 moves the cut to 1.10: a cabinet at 1.15 turns dashed, and the chip reads \"Cut +1.10\"", () => {
    const low = ok(drawing(), { type: "setObjectSize", objectId: "c/o0", w: 0.6, d: {}, z: { standard: 1.15 } });
    expect(kinds(near(objects(low), 3.7, 4.3, 0.1, 0.45))).toEqual(["polygon", "segment"]);
    const lower = ok(low, { type: "setCeiling", height: 2.2 });
    expect(kinds(near(objects(lower), 3.7, 4.3, 0.1, 0.45))).toEqual(["dashed"]);
    expect(FakeShell.withDocument(low).view().cut).toBe("Cut +1.20");
    expect(FakeShell.withDocument(lower).view().cut).toBe("Cut +1.10");
  });

  it("pieces draw lowest bottom first, dashed last: a raised bed over a table comes after the table", () => {
    const doc = ok(roomDoc(), place("z", "desk", 3, 3.9), place("a", "liftBed", 3, 3.9)); // the bed's ID sorts first
    const ps = objects(doc);
    const firstDashed = ps.findIndex((p) => p.kind === "segment" && p.dash !== undefined);
    const lastPolygon = ps.map((p) => p.kind).lastIndexOf("polygon");
    expect(firstDashed).toBeGreaterThan(lastPolygon);
  });
});

describe("cut parity (heights.30)", () => {
  it("canvas, presentation and look styles classify the same walls and pieces, under 2.50 and 2.20", () => {
    for (const ceiling of [2.5, 2.2]) {
      const doc = ok(drawing(), { type: "setCeiling", height: ceiling });
      const shape = (style: PlanStyle) => [kinds(near(objects(doc, style), 3.7, 4.3, 0.1, 0.45)), kinds(near(walls(doc, style), 1.8, 3.7, 1.8, 2.2))];
      expect(shape(PRESENTATION_STYLE)).toEqual(shape(CANVAS_STYLE));
      expect(shape(LOOK_STYLE)).toEqual(shape(CANVAS_STYLE));
    }
  });

  it("the memoised layers stay the same arrays on an unchanged document", () => {
    const doc = drawing();
    expect(objects(doc)).toBe(objects(doc));
    expect(walls(doc)).toBe(walls(doc));
  });
});
