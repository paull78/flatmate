import { describe, expect, it } from "vitest";
import { levelOf, swingZone, zoneRings, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { sheetPages } from "../src/export/sheet";
import { COLORS } from "../src/view/colors";
import { lookPicture } from "../src/view/look";
import { CANVAS_STYLE, PRESENTATION_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import { floorView, viewAt } from "../src/view/plan-view";
import type { LayerName, Primitive } from "../src/view/scene-types";
import { shownWarnings, warningMarks } from "../src/view/warnings";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The outline and the "!" of a shown warning (clarity.02, .12): on the canvas only, the mark a fixed size in pixels.

const place = (opId: string, kind: string, at: Point, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, rotation });

/** A desk on the top wall, its front zone x 2.65–3.35, y 2.5–3.3, with a block standing in it. */
const blockedDesk = (): Document => withCommands(roomDoc(), place("desk", "desk", { x: 3, y: 3.9 }), place("b", "block", { x: 3, y: 3.2 }));
/** A door on the bottom wall (x 3–3.8, swinging up to y 0.9) with a chair in its swing. */
function blockedDoor(): Document {
  const base = roomDoc();
  return withCommands(base,
    { type: "addOpening", opId: "o", wall: wallBetween(base, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 3 },
    place("c", "chair", { x: 3.65, y: 0.7 }),
  );
}
/** A big corner desk with a nightstand in one strip of its front zone: one warning on one `L` ring. */
const blockedCornerDesk = (): Document => withCommands(roomDoc(),
  place("k", "cornerDesk", { x: 3, y: 3.9 }),
  { type: "setObjectSize", objectId: "k/o0", w: 2.4, d: { standard: 2 } },
  place("n", "nightstand", { x: 2.9, y: 2.4 }),
);

const layer = (doc: Document, name: LayerName, zoom?: number): readonly Primitive[] => {
  const shell = FakeShell.withDocument(doc);
  if (zoom !== undefined) shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
};
const inColor = (ps: readonly Primitive[], ...colors: string[]) => ps.filter((p) => colors.includes(p.color));
const edgesOf = (ring: readonly Point[]): Primitive[] => ring.map((a, i) => ({ kind: "segment", a, b: ring[(i + 1) % ring.length] ?? a, width: { px: 2 }, color: COLORS.warningLine, cap: "butt" }));
const discsOf = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "disc" ? [p] : []));
const expectAt = (p: Point | undefined, q: Point) => expect(p).toEqual({ x: expect.closeTo(q.x, 9), y: expect.closeTo(q.y, 9) });

describe("the outline", () => {
  it("a blocked use zone keeps the amber fill and gains the outline", () => {
    const doc = blockedDesk();
    const ring = shownWarnings(doc, floorView(doc, "s0"))[0]?.ring ?? [];
    expect(ring).toHaveLength(4);
    const [fill, ...edges] = layer(doc, "warnings");
    expect(fill).toEqual({ kind: "polygon", points: ring, holes: [], color: COLORS.warning });
    expect(edges).toEqual(edgesOf(ring));
    expect(COLORS.warningLine).toBe("#92400e");
  });

  it("an L front's union ring is outlined as one", () => {
    const doc = blockedCornerDesk();
    const ring = zoneRings(doc).get("k/p0")?.find((z) => z.side === "front")?.ring ?? [];
    expect(ring).toHaveLength(6);
    expect(layer(doc, "warnings").filter((p) => p.kind === "segment")).toEqual(edgesOf(ring));
  });

  it("every fill comes before every outline, so a neighbour's fill never crosses one in any renderer", () => {
    // Two warnings: Canvas2D draws in order, and the GPU draws a layer's polygons first.
    const doc = withCommands(blockedDesk(), place("d2", "desk", { x: 1.4, y: 3.9 }), place("b2", "block", { x: 1.4, y: 3.2 }));
    expect(layer(doc, "warnings").map((p) => p.kind)).toEqual([...Array<string>(2).fill("polygon"), ...Array<string>(8).fill("segment")]);
  });
});

describe("the mark", () => {
  it("a blocked door swing gets the outline and a mark", () => {
    const doc = blockedDoor();
    const ring = swingZone(doc, "o/d0") ?? [];
    expect(layer(doc, "warnings")).toEqual([{ kind: "polygon", points: ring, holes: [], color: COLORS.warning }, ...edgesOf(ring)]);
    const marks = inColor(layer(doc, "overlays"), COLORS.warningLine, COLORS.warningMark, COLORS.warningGlyph);
    const [outer, inner, glyph] = marks;
    expect(marks).toHaveLength(3);
    expect(outer).toMatchObject({ kind: "disc", radius: { px: 11 }, color: "#92400e" });
    expect(inner).toMatchObject({ kind: "disc", radius: { px: 9.5 }, color: "#f59e0b" });
    expect(glyph).toMatchObject({ kind: "text", text: "!", size: 13, color: "#111111", align: "center", rotation: 0 });
    if (outer?.kind !== "disc" || inner?.kind !== "disc" || glyph?.kind !== "text") throw new Error("not a mark");
    expect(inner.center).toEqual(outer.center);
    expect(glyph.at).toEqual(outer.center);
  });

  it("a mark's radius stays in px and its place follows the zoom", () => {
    const doc = blockedDesk();
    const corner = { x: 3.35, y: 3.3 }; // the largest x + y
    const centre = { x: 3, y: 2.9 };
    const length = Math.hypot(centre.x - corner.x, centre.y - corner.y);
    for (const zoom of [40, 160]) {
      const [outer] = discsOf(inColor(layer(doc, "overlays", zoom), COLORS.warningLine));
      expect(outer?.radius).toEqual({ px: 11 });
      const inset = 14 / zoom / length;
      expectAt(outer?.center, { x: corner.x + (centre.x - corner.x) * inset, y: corner.y + (centre.y - corner.y) * inset });
    }
  });

  it("a zone smaller than the inset holds its mark at the centroid", () => {
    const doc = blockedDesk();
    // The corner is 0.53 m from the centroid: at 20 px/m the inset is 0.70 m, at 28 px/m exactly 0.50 m, still short of it.
    const spot = (zoom: number) => discsOf(warningMarks(doc, floorView(doc, "s0"), zoom))[0]?.center;
    expectAt(spot(20), { x: 3, y: 2.9 });
    expect(spot(28)?.x).toBeGreaterThan(3);
  });

  it("an L's mark moves toward its area centroid", () => {
    const doc = blockedCornerDesk();
    const ring = shownWarnings(doc, floorView(doc, "s0"))[0]?.ring ?? [];
    // Back strip x 2.4–4.2, y 2.5–3.3 and the left strip's part below it, x 2.4–3.2, y 1.9–2.5.
    const area = 1.8 * 0.8 + 0.8 * 0.6;
    const centre = { x: (1.8 * 0.8 * 3.3 + 0.8 * 0.6 * 2.8) / area, y: (1.8 * 0.8 * 2.9 + 0.8 * 0.6 * 2.2) / area };
    expect(ring).toContainEqual({ x: expect.closeTo(4.2, 9), y: expect.closeTo(3.3, 9) });
    expectAt(discsOf(warningMarks(doc, floorView(doc, "s0"), 1))[0]?.center, centre);
  });

  it("two marks stack alike in every renderer: discs, then glyphs", () => {
    // A renderer's text draws above its geometry, on the GPU across the layer, so Canvas2D gets the same order (clarity.12).
    const doc = withCommands(blockedDesk(), place("d2", "desk", { x: 1.4, y: 3.9 }), place("b2", "block", { x: 1.4, y: 3.2 }));
    expect(warningMarks(doc, floorView(doc, "s0"), 80).map((p) => p.kind)).toEqual(["disc", "disc", "disc", "disc", "text", "text"]);
  });

  it("a selected piece's grips draw over its mark", () => {
    const shell = FakeShell.withDocument(blockedDesk());
    shell.click({ x: 3, y: 3.6 });
    const overlays = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    const glyph = overlays.findIndex((p) => p.color === COLORS.warningGlyph);
    const grip = overlays.findIndex((p) => p.color === COLORS.wallSelected);
    expect(glyph).toBeGreaterThanOrEqual(0);
    expect(grip).toBeGreaterThan(glyph);
  });

  it("no marks on a clear plan, none for a hidden level", () => {
    const clear = withCommands(roomDoc(), place("desk", "desk", { x: 3, y: 3.9 }));
    expect(shownWarnings(clear, floorView(clear, "s0"))).toEqual([]);
    expect(warningMarks(clear, floorView(clear, "s0"), 80)).toEqual([]);
    expect(inColor(layer(clear, "overlays"), COLORS.warningMark, COLORS.warningGlyph)).toEqual([]);

    // A sofa against the bottom wall, its front zone running into it: a warning at the floor, gone at the loft under which the sofa stands.
    const doc = withCommands(roomDoc(),
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 2 }, w: 2.4, d: 3.8 },
      place("s", "sofa", { x: 4.5, y: 1 }),
    );
    expect(warningMarks(doc, floorView(doc, "s0"), 80)).toHaveLength(3);
    const atLoft = viewAt("s0", levelOf(doc, "loft/k0"));
    expect(shownWarnings(doc, atLoft)).toEqual([]);
    expect(warningMarks(doc, atLoft, 80)).toEqual([]);
  });
});

describe("the canvas only", () => {
  it("paper and look draw none of it", () => {
    const docs = [blockedDesk(), blockedDoor()];
    const host = new FakeHost();
    host.today = () => "2026-11-02";
    for (const doc of docs) {
      const look = lookPicture(doc, null);
      if ("refused" in look) throw new Error(look.refused);
      const page = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host, finishes: true })?.pages[0];
      if (!page) throw new Error("no page");
      const pictures = [PRESENTATION_STYLE, CANVAS_STYLE].map((style) => pictureLayers(planPicture(doc, floorView(doc, "s0"), style, 20, true)));
      for (const ps of [...pictures, look.primitives, page.primitives]) {
        expect(ps.length).toBeGreaterThan(0);
        expect(inColor(ps, COLORS.warning, COLORS.warningLine, COLORS.warningMark, COLORS.warningGlyph)).toEqual([]);
      }
    }
  });
});
