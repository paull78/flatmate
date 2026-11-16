import { describe, expect, it } from "vitest";
import { pieceShape, placedShape, type Arms, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectLook } from "../src/view/furniture";
import { flipObjectsLayer, objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { view3dItems } from "../src/view3d/items";
import { insideRing, reach } from "./object-look-helpers";
import { roomDoc, withCommands } from "./builders";

// The corner desk drawn with its own arms (catalog.14, .17, .19): the six-corner outline, the mitre from the inner
// corner to the outer back-left corner and the heavier front along the two inner edges, at any size and arm depth.
// Footprint space: x from −w/2 to w/2, y from −d (front) to 0 (back).

const TOL = 0.001;
const LOOK = { fill: "F", line: "L", frontPx: 3, linePx: 1, detail: "D" };
const near = (u: number, v: number) => Math.abs(u - v) < 1e-9;
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const joins = (s: { a: Point; b: Point }, a: Point, b: Point) =>
  (near(s.a.x, a.x) && near(s.a.y, a.y) && near(s.b.x, b.x) && near(s.b.y, b.y)) || (near(s.a.x, b.x) && near(s.a.y, b.y) && near(s.b.x, a.x) && near(s.b.y, a.y));

/** The sizes and arms the symbol is checked at: default, 1.20 × 1.20 and 10 × 10, each with the thinnest and the deepest arms. */
const CASES: { w: number; d: number; arms: Arms }[] = [[1.6, 1.2], [1.2, 1.2], [10, 10]].flatMap(([w = 0, d = 0]) => [
  { w, d, arms: { back: 0.1, left: 0.1 } },
  { w, d, arms: { back: d - 0.1, left: w - 0.1 } },
]);

describe("the corner desk symbol with its arms", () => {
  it("every point lies inside the outline (point in polygon), the mitre runs from the inner corner to the back-left corner", () => {
    for (const { w, d, arms } of CASES) {
      const { outline } = pieceShape("cornerDesk", w, d, arms);
      const look = objectLook("cornerDesk", "standard", w, d, LOOK, {}, arms);
      const msg = `${w}×${d} arms ${arms.back}/${arms.left}`;
      for (const q of look.flatMap(reach)) expect(insideRing(q, outline, TOL), `${msg} at (${q.x}, ${q.y})`).toBe(true);
      const detail = segments(look.filter((p) => p.color === "D"));
      expect(detail.some((s) => joins(s, { x: -w / 2 + arms.left, y: -arms.back }, { x: -w / 2, y: 0 })), msg).toBe(true);
    }
  });

  it("the front line is exactly the outline's second to fourth points: the left arm's inner edge, then the back arm's", () => {
    for (const { w, d, arms } of CASES) {
      const [, p1, p2, p3] = pieceShape("cornerDesk", w, d, arms).outline;
      if (!p1 || !p2 || !p3) throw new Error("no outline");
      const front = segments(objectLook("cornerDesk", "standard", w, d, LOOK, {}, arms)).filter((s) => "px" in s.width && s.width.px === 3);
      expect(front.map((s) => [s.a, s.b]), `${w}×${d} arms ${arms.back}/${arms.left}`).toEqual([[p1, p2], [p2, p3]]);
    }
  });

  it("its fill is the outline with its arms", () => {
    const arms = { back: 0.3, left: 0.4 };
    const [fill] = objectLook("cornerDesk", "standard", 1.6, 1.2, LOOK, {}, arms);
    expect(fill).toMatchObject({ kind: "polygon", points: pieceShape("cornerDesk", 1.6, 1.2, arms).outline });
  });
});

// A placed corner desk with arms of its own: every path that draws an object passes them (catalog.17).
describe("a placed corner desk draws with its stored arms", () => {
  const ARMS = { back: 0.3, left: 0.4 };
  const AT = { x: 0.9, y: 3.9 };
  const place: Command = { type: "placeObject", deck: null, opId: "cd", state: "s0", object: { kind: "cornerDesk" }, at: AT };
  function deskDoc(): Document {
    const doc = withCommands(roomDoc(), place);
    const desk = doc.objects["cd/o0"];
    if (!desk) throw new Error("no desk");
    return { ...doc, objects: { ...doc.objects, "cd/o0": { ...desk, arms: ARMS } } };
  }
  const outline = placedShape("cornerDesk", AT, 1.6, 1.2, 0, ARMS);
  const fills = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p.points] : []));

  it("the objects layer, selected or not, and the flip fill its outline", () => {
    const doc = deskDoc();
    expect(fills(objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80))).toEqual([outline]);
    expect(fills(objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "cd/p0", 80))).toEqual([outline]);
    expect(fills(flipObjectsLayer(doc, floorView(doc, "s0").level, { from: "s0", to: "s0", t: 0.5 }))).toEqual([outline]);
  });

  it("the objects layer's mitre starts at its inner corner", () => {
    const doc = deskDoc();
    const inner = { x: AT.x - 0.8 + ARMS.left, y: AT.y - ARMS.back };
    const lines = segments(objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80));
    expect(lines.some((s) => joins(s, inner, { x: AT.x - 0.8, y: AT.y }))).toBe(true);
  });

  it("the 3D view's piece carries its outline", () => {
    const [piece] = view3dItems(deskDoc(), "s0", null, new Set(), false).flatMap((i) => (i.item === "piece" ? [i] : []));
    expect(piece?.ring).toEqual(outline);
  });
});
