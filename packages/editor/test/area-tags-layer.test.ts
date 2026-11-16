import { describe, expect, it } from "vitest";
import { execute, levelOf, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { PRESENTATION_STYLE, CANVAS_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Area tags on the plan (areas step 03): drawn with the room tags at the floor, on screen, on paper and in look; hidden at
// a loft's level (AC-08); never a line along the rectangle (AC-02, areas.02).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const withKitchen = (): Document => run(roomDoc(),
  { type: "addArea", opId: "k", at: { x: 2, y: 2 }, w: 2.4, d: 2, name: "Kitchen" },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.6, y: 2 }, w: 2, d: 3 });
const texts = (prims: readonly Primitive[]): string[] => prims.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const onLine = (p: Point, a: Point, b: Point): boolean => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 1e-6
  && Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6 && Math.min(a.y, b.y) - 1e-6 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-6;
/** The rectangle 0.8–3.2 × 1–3's sides. */
const SIDES: [Point, Point][] = [[{ x: 0.8, y: 1 }, { x: 3.2, y: 1 }], [{ x: 3.2, y: 1 }, { x: 3.2, y: 3 }], [{ x: 3.2, y: 3 }, { x: 0.8, y: 3 }], [{ x: 0.8, y: 3 }, { x: 0.8, y: 1 }]];
const alongSide = (p: Primitive): boolean => {
  const pts = p.kind === "segment" ? [p.a, p.b] : p.kind === "polygon" ? p.points : [];
  return pts.length > 1 && SIDES.some(([a, b]) => pts.every((q) => onLine(q, a, b)));
};

describe("area tags in the plan picture", () => {
  it("draw at the floor on paper and on the canvas, with no line along the rectangle (AC-02)", () => {
    const doc = withKitchen();
    for (const style of [PRESENTATION_STYLE, CANVAS_STYLE]) {
      const picture = planPicture(doc, floorView(doc, "s0"), style, 40, true);
      expect(texts(picture.tags)).toContain("Kitchen");
      expect(pictureLayers(picture).filter(alongSide)).toEqual([]);
    }
  });

  it("are not drawn at a loft's level (AC-08)", () => {
    const doc = withKitchen();
    const loft = levelOf(doc, "loft/k0");
    const picture = planPicture(doc, viewAt("s0", loft), PRESENTATION_STYLE, 40, true);
    expect(texts(pictureLayers(picture))).not.toContain("Kitchen");
  });

  it("draw on the canvas scene with nothing selected, and no line along the rectangle", () => {
    const scene = FakeShell.withDocument(withKitchen()).scene();
    expect(texts(scene.layers.find((l) => l.name === "tags")?.primitives ?? [])).toContain("Kitchen");
    expect(scene.layers.flatMap((l) => l.primitives).filter(alongSide)).toEqual([]);
  });
});
