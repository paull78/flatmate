import { describe, expect, it } from "vitest";
import { deckView, emptyDocument, levelOf, pointInPolygon, rectangleRoom, wallOutlines, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { deckLabelsLayer, decksLayer, overheadsLayer } from "../src/view/decks-layer";
import { deckLabelBox, labelledDecks } from "../src/view/deck-label";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { LAYER_ORDER } from "../src/view/scene";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";
import { floorView } from "../src/view/plan-view";
import { textWidth } from "../src/view/fonts";

// The decks layer (spec "The plan", decks.07, .19; AC-08): every deck classified by the cut like walls and pieces.
// Below it a tinted fill and a solid outline, above it a dashed outline and no fill, crossing it the fill and an outline
// at the cut weight; each with a "Name +0.45" label. Overhead lines draw on top: the dashed outlines of decks above the
// cut are their own layer, over the pieces. Labels are a layer over the walls and openings, hanging from a point 0.12 m
// inside the deck's top-left corner, so a partition under a loft never paints over one.

/** roomDoc (6 × 4, ceiling 2.50, cut 1.20) with a platform (x 0.5–2.5, y 0.5–1.9) and a loft (x 3.5–5.5, y 2.1–3.5). */
function decksDoc(...more: Command[]): Document {
  return withCommands(
    roomDoc(),
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.5, y: 1.2 } },
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.5, y: 2.8 } },
    ...more,
  );
}
/** One more deck at (1.5, 3), x 0.5–2.5, y 2.3–3.7: `top` and `solid` as given. */
const extra = (top: number, solid: boolean): Command => ({ type: "addDeck", opId: "x", preset: "platform", at: { x: 1.5, y: 3 }, top, solid, name: "Step", guard: "none" });

const NONE = "";
const ZOOM = 80; // drawing units per metre
/**
 * The three deck layers, in drawing order (pieces, walls and openings go between them), the labels without their
 * canvas plates (tested on their own below).
 */
const drawn = (doc: Document, style: PlanStyle = CANVAS_STYLE, selected = NONE, zoom = ZOOM): Primitive[] => [
  ...decksLayer(doc, floorView(doc, null).level, style, selected, ""),
  ...overheadsLayer(doc, floorView(doc, null).level, style, selected, null),
  ...deckLabelsLayer(doc, floorView(doc, null).level, style, zoom).filter((p) => p.kind === "text"),
];
/**
 * Where a label goes, worked out from the deck's own frame: the corner at local (sx·w/2, sy·d/2), 0.12 m in along both
 * axes, then half the label's size (drawing units, `zoom` per metre) down, since text is centred on its point.
 */
function labelPoint(at: Point, w: number, d: number, degrees: number, sx: number, sy: number, size: number, zoom: number): Point {
  const r = (degrees * Math.PI) / 180;
  const lx = sx * (w / 2 - 0.12);
  const ly = sy * (d / 2 - 0.12);
  return { x: at.x + lx * Math.cos(r) - ly * Math.sin(r), y: at.y + lx * Math.sin(r) + ly * Math.cos(r) - size / 2 / zoom };
}
const closeTo = (p: Point) => ({ x: expect.closeTo(p.x, 9), y: expect.closeTo(p.y, 9) });
/** The primitives inside a box, as cut.test.ts picks a piece's. */
const near = (ps: readonly Primitive[], x0: number, x1: number, y0: number, y1: number): Primitive[] =>
  ps.filter((p) => {
    const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : [];
    return pts.length > 0 && pts.every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= y0 - 1e-6 && q.y <= y1 + 1e-6);
  });
type Segment = Extract<Primitive, { kind: "segment" }>;
const segments = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const polygons = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p] : []));
/** The labels' title lines, without the area line each deck's label adds under its title (areas.10). */
const titles = (ps: readonly Primitive[]) => texts(ps).filter((t) => !t.text.endsWith(" m²"));
const px = (s: Segment): number => ("px" in s.width ? s.width.px : NaN);
const platform = (ps: readonly Primitive[]) => near(ps, 0.5, 2.5, 0.5, 1.9);
const loft = (ps: readonly Primitive[]) => near(ps, 3.5, 5.5, 2.1, 3.5);
const step = (ps: readonly Primitive[]) => near(ps, 0.5, 2.5, 2.3, 3.7);

describe("the decks layer (AC-08)", () => {
  it("a platform below the cut is filled and outlined with its label \"Platform +0.45\"", () => {
    const doc = decksDoc();
    const ps = platform(drawn(doc));
    const ring = deckView(doc, "p/k0")?.ring;
    expect(polygons(ps)).toEqual([{ kind: "polygon", points: ring, holes: [], color: CANVAS_STYLE.deck.tint }]);
    const edges = segments(ps);
    expect(edges).toHaveLength(4);
    for (const s of edges) {
      expect(s.dash).toBeUndefined();
      expect(s.color).toBe(CANVAS_STYLE.deck.line.color);
      expect(px(s)).toBe(CANVAS_STYLE.deck.line.width);
    }
    expect(edges.map((s) => s.a)).toEqual(ring);
    // Two corners share the smallest x (0.5): the higher one, (0.5, 1.9), is the top-left.
    const size = CANVAS_STYLE.deck.label.size;
    expect(titles(ps)).toEqual([
      { kind: "text", text: "Platform +0.45", at: closeTo({ x: 0.62, y: 1.78 - size / 2 / ZOOM }), size, color: CANVAS_STYLE.deck.label.color, align: "left", rotation: 0, font: "inter" },
    ]);
  });

  it("a loft above the cut is dashed with no fill and \"Loft +2.15\"", () => {
    const ps = loft(drawn(decksDoc()));
    expect(polygons(ps)).toEqual([]);
    const edges = segments(ps);
    expect(edges).toHaveLength(4);
    for (const s of edges) {
      expect(s.dash).toEqual([...CANVAS_STYLE.deck.dash]);
      expect(s.color).toBe(CANVAS_STYLE.deck.line.color);
      expect(px(s)).toBe(CANVAS_STYLE.deck.line.width);
    }
    expect(titles(ps).map((t) => [t.text, t.at, t.align])).toEqual([["Loft +2.15", closeTo(labelPoint({ x: 4.5, y: 2.8 }, 2, 1.4, 0, -1, 1, CANVAS_STYLE.deck.label.size, ZOOM)), "left"]]);
  });

  it("a deck crossing the cut uses the cut weight", () => {
    expect(CANVAS_STYLE.deck.cutLine).toBeGreaterThan(CANVAS_STYLE.deck.line.width);
    const ps = step(drawn(decksDoc(extra(1.3, true)))); // 0.00–1.30 across the 1.20 cut
    expect(polygons(ps).map((p) => p.color)).toEqual([CANVAS_STYLE.deck.tint]);
    const edges = segments(ps);
    expect(edges).toHaveLength(4);
    for (const s of edges) {
      expect(s.dash).toBeUndefined();
      expect(px(s)).toBe(CANVAS_STYLE.deck.cutLine);
    }
    expect(titles(ps).map((t) => t.text)).toEqual(["Step +1.30"]);
  });

  it("under a 2.20 ceiling (cut 1.10) a 1.30 top crosses", () => {
    // Fixtures that change the answer with the ceiling: a hollow 1.18–1.30 crosses the 1.20 cut and lies above 1.10;
    // a solid 0.00–1.15 lies below 1.20 and crosses 1.10.
    const hollow = (ceiling: number) => step(drawn(decksDoc(extra(1.3, false), { type: "setCeiling", height: ceiling })));
    expect(segments(hollow(2.5)).map((s) => [px(s), s.dash])).toEqual(Array(4).fill([CANVAS_STYLE.deck.cutLine, undefined]));
    expect(polygons(hollow(2.5))).toHaveLength(1);
    expect(segments(hollow(2.2)).map((s) => s.dash)).toEqual(Array(4).fill([...CANVAS_STYLE.deck.dash]));
    expect(polygons(hollow(2.2))).toEqual([]);
    const solid = (ceiling: number) => step(drawn(decksDoc(extra(1.15, true), { type: "setCeiling", height: ceiling })));
    expect(segments(solid(2.5)).map(px)).toEqual(Array(4).fill(CANVAS_STYLE.deck.line.width));
    expect(segments(solid(2.2)).map(px)).toEqual(Array(4).fill(CANVAS_STYLE.deck.cutLine));
    expect(titles(solid(2.2)).map((t) => t.text)).toEqual(["Step +1.15"]);
  });

  it("a deck whose top sits exactly at the cut is below it; 1 cm higher, it crosses", () => {
    expect(segments(step(drawn(decksDoc(extra(1.2, true))))).map(px)).toEqual(Array(4).fill(CANVAS_STYLE.deck.line.width));
    expect(segments(step(drawn(decksDoc(extra(1.21, true))))).map(px)).toEqual(Array(4).fill(CANVAS_STYLE.deck.cutLine));
  });

  it("a deck with a blank name is labelled \"Deck\", as refusals name it", () => {
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "b", preset: "platform", at: { x: 3, y: 2 }, name: " " });
    expect(titles(drawn(doc)).map((t) => t.text)).toEqual(["Deck +0.45"]);
  });

  it("a deck turned 30° draws its turned ring; its label hangs upright inside the leftmost corner", () => {
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "r", preset: "platform", at: { x: 3, y: 2 }, rotation: 30 });
    const ps = drawn(doc);
    const ring = deckView(doc, "r/k0")?.ring;
    expect(polygons(ps).map((p) => p.points)).toEqual([ring]);
    expect(segments(ps).map((s) => s.b)).toEqual([...(ring ?? []).slice(1), ring?.[0]].map((p) => closeTo(p ?? { x: NaN, y: NaN })));
    // Turned 30°, the corner at local (−1, +0.7) has the smallest x: 3 − 0.866 − 0.35.
    const want = labelPoint({ x: 3, y: 2 }, 2, 1.4, 30, -1, 1, CANVAS_STYLE.deck.label.size, ZOOM);
    expect(texts(ps).map((t) => [t.at, t.rotation, t.align])).toEqual([[closeTo(want), 0, "left"]]);
    for (const turn of [90, 180, 270, 315]) {
      const turned = withCommands(roomDoc(), { type: "addDeck", opId: "r", preset: "platform", at: { x: 3, y: 2 }, rotation: turn });
      const [label] = texts(drawn(turned));
      // The label's point lies inside the deck, near the corner with the smallest x.
      const corners = deckView(turned, "r/k0")?.ring ?? [];
      const minX = Math.min(...corners.map((c) => c.x));
      expect(label && pointInPolygon({ x: label.at.x, y: label.at.y + CANVAS_STYLE.deck.label.size / 2 / ZOOM }, corners)).toBe(true);
      expect(label && label.at.x - minX).toBeCloseTo(turn % 90 === 0 ? 0.12 : 0.12 * Math.SQRT2, 9);
      // Square turns put two corners on the smallest x, up to float noise: the higher one wins.
      if (turn % 90 === 0) expect(label && label.at.y + CANVAS_STYLE.deck.label.size / 2 / ZOOM).toBeCloseTo(Math.max(...corners.map((c) => c.y)) - 0.12, 9);
    }
  });

  it("the label hangs half its size below its anchor, whatever the zoom", () => {
    const doc = decksDoc();
    const at = (zoom: number) => titles(deckLabelsLayer(doc, floorView(doc, null).level, PRESENTATION_STYLE, zoom)).map((t) => t.at);
    const size = PRESENTATION_STYLE.deck.label.size;
    // The loft (l/k0) then the platform (p/k0): by deck ID.
    expect(at(20)).toEqual([closeTo({ x: 3.62, y: 3.38 - size / 40 }), closeTo({ x: 0.62, y: 1.78 - size / 40 })]);
    expect(at(10)).toEqual([closeTo({ x: 3.62, y: 3.38 - size / 20 }), closeTo({ x: 0.62, y: 1.78 - size / 20 })]);
  });

  it("a loft over a bathroom partition keeps its label off every wall (M1 gate)", () => {
    // The hands-on run: a 7 × 2.5 room (centrelines), a partition at x = 1.6 lowered to 2.03, a loft drawn from
    // (0.1, 0.1) to (2.6, 2.4); and the same loft widened to (3.1, 2.4), its centre on the partition's centreline.
    const room = withCommands(
      emptyDocument(),
      ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5),
      { type: "addWall", opId: "part", from: { at: { x: 1.6, y: 0 } }, to: { at: { x: 1.6, y: 2.5 } } },
      { type: "setWallTop", wallId: "part/w0", top: 2.03 },
    );
    for (const right of [2.6, 3.1]) {
      const centre = { x: (0.1 + right) / 2, y: 1.25 };
      const doc = withCommands(room, { type: "addDeck", opId: "l", preset: "loft", at: centre, w: right - 0.1, d: 2.3 });
      const walls = [...wallOutlines(doc).values()];
      const inWall = (p: Point) => walls.some((ring) => pointInPolygon(p, ring));
      for (const style of [CANVAS_STYLE, PRESENTATION_STYLE]) {
        const [label] = texts(deckLabelsLayer(doc, floorView(doc, null).level, style, ZOOM));
        if (!label) throw new Error("no label");
        expect(label.text).toBe("Loft +2.15");
        const anchor = { x: label.at.x, y: label.at.y + style.deck.label.size / 2 / ZOOM };
        expect(anchor).toEqual(closeTo({ x: 0.22, y: 2.28 }));
        expect(inWall(anchor)).toBe(false);
        expect(inWall(label.at)).toBe(false);
      }
      if (right === 3.1) expect(inWall(centre)).toBe(true); // where a centred label sat
    }
  });

  it("a selected deck draws its outline in the selection blue; the others and the labels keep their colours", () => {
    const ps = drawn(decksDoc(), CANVAS_STYLE, "l/k0");
    expect(segments(loft(ps)).map((s) => s.color)).toEqual(Array(4).fill(COLORS.wallSelected));
    expect(segments(platform(ps)).map((s) => s.color)).toEqual(Array(4).fill(CANVAS_STYLE.deck.line.color));
    expect(texts(ps).map((t) => t.color)).toEqual(Array(4).fill(CANVAS_STYLE.deck.label.color)); // titles and area lines
  });

  it("the decks layer: fills, then solid outlines, no labels; the labels layer only labels; no decks draws nothing", () => {
    const doc = decksDoc(extra(1.3, true)); // a platform below, a loft above, a step crossing
    expect(decksLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, "").map((p) => p.kind)).toEqual(["polygon", "polygon", ...Array(8).fill("segment")]);
    expect(texts(deckLabelsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, ZOOM)).map((p) => p.text).filter((t) => !t.endsWith(" m²"))).toEqual(["Loft +2.15", "Platform +0.45", "Step +1.30"]); // by deck ID
    expect(segments(decksLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, "")).some((s) => s.dash !== undefined)).toBe(false);
    expect(drawn(roomDoc())).toEqual([]);
  });

  it("the overheads layer: only the dashed outlines of decks above the cut, the selected one in blue", () => {
    const doc = decksDoc(extra(1.3, true));
    const over = overheadsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, null);
    expect(over).toEqual(loft(over));
    expect(segments(over)).toHaveLength(4);
    expect(over.every((p) => p.kind === "segment" && p.dash !== undefined)).toBe(true);
    expect(segments(overheadsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, "l/k0", null)).map((s) => s.color)).toEqual(Array(4).fill(COLORS.wallSelected));
    expect(segments(loft(decksLayer(doc, floorView(doc, null).level, CANVAS_STYLE, "l/k0", "")))).toEqual([]); // nor a second outline below the pieces
    expect(overheadsLayer(roomDoc(), floorView(roomDoc(), null).level, CANVAS_STYLE, NONE, null)).toEqual([]);
  });

  it("each style draws in its own units and inks; the tint differs from room floors and furniture", () => {
    for (const style of [CANVAS_STYLE, PRESENTATION_STYLE, LOOK_STYLE]) {
      const ps = drawn(decksDoc(), style);
      expect(polygons(ps).map((p) => p.color)).toEqual([style.deck.tint]);
      expect(new Set(segments(ps).map(px))).toEqual(new Set([style.deck.line.width]));
      expect(texts(ps).map((t) => t.size)).toEqual(Array(4).fill(style.deck.label.size)); // titles and area lines
      expect(style.deck.tint).not.toBe(style.objectFill);
    }
    expect(CANVAS_STYLE.deck.tint).not.toBe(COLORS.zoneFill);
    expect(PRESENTATION_STYLE.deck.label.size).toBe(PRESENTATION_STYLE.tag.size);
  });

  it("the layers are reused while their arguments are the same", () => {
    const doc = decksDoc();
    expect(deckLabelsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, ZOOM)).toBe(deckLabelsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, ZOOM));
    expect(decksLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, "")).toBe(decksLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, ""));
    expect(overheadsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, null)).toBe(overheadsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, null));
  });
});

describe("deck label plates (cleanup.05, AC-05)", () => {
  /** The text's box as the tags measure it: from `pad` left of the point to `pad` past the text, a tag line high. */
  const textBox = (t: Extract<Primitive, { kind: "text" }>, zoom: number) => {
    const { pad, line } = CANVAS_STYLE.tag;
    const width = textWidth(CANVAS_STYLE.font, t.text, t.size);
    return { x0: t.at.x - pad / zoom, x1: t.at.x + (width + pad) / zoom, y0: t.at.y - (line / 2 + pad / 2) / zoom, y1: t.at.y + (line / 2 + pad / 2) / zoom };
  };

  it("on the canvas each label sits on a plate in the background colour covering its text box, drawn before its text", () => {
    for (const zoom of [40, ZOOM, 200]) {
      const ps = deckLabelsLayer(decksDoc(), floorView(decksDoc(), null).level, CANVAS_STYLE, zoom);
      // Each label: a plate, then its title and, where it fits, its area line (areas.10).
      const groups: { plate: Extract<Primitive, { kind: "polygon" }>; lines: Extract<Primitive, { kind: "text" }>[] }[] = [];
      for (const p of ps) {
        if (p.kind === "polygon") groups.push({ plate: p, lines: [] });
        else if (p.kind === "text") groups.at(-1)?.lines.push(p);
      }
      expect(groups).toHaveLength(2);
      for (const { plate, lines } of groups) {
        expect(lines.length === 1 || lines.length === 2).toBe(true);
        expect(plate.color).toBe(COLORS.background);
        const boxes = lines.map((t) => textBox(t, zoom));
        // Exactly the lines' box, the tags' pad around it: no smaller (the text shows) and no larger (zoom applied).
        const xs = plate.points.map((q) => q.x);
        const ys = plate.points.map((q) => q.y);
        expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(9)), `${lines[0]?.text} at ${zoom}`).toEqual(
          [Math.min(...boxes.map((x) => x.x0)), Math.max(...boxes.map((x) => x.x1)), Math.min(...boxes.map((x) => x.y0)), Math.max(...boxes.map((x) => x.y1))].map((v) => +v.toFixed(9)),
        );
      }
    }
  });

  it("on paper and in look no plate is drawn, as with room tags", () => {
    for (const style of [PRESENTATION_STYLE, LOOK_STYLE]) {
      expect(style.tag.plate).toBeNull();
      expect(deckLabelsLayer(decksDoc(), floorView(decksDoc(), null).level, style, ZOOM).map((p) => p.kind)).toEqual(["text", "text", "text", "text"]); // a title and its area line each
    }
  });

  it("the plate hides an overhead outline crossing the label: the labels draw after the overheads", () => {
    expect(LAYER_ORDER.indexOf("deckLabels")).toBeGreaterThan(LAYER_ORDER.indexOf("overheads"));
    expect(LAYER_ORDER.indexOf("deckLabels")).toBeGreaterThan(LAYER_ORDER.indexOf("objects"));
  });
});

describe("one deck label box (tidy C4, AC-06)", () => {
  it("deckLabelBox is the box the canvas plate covers, at every zoom", () => {
    const doc = decksDoc();
    const level = floorView(doc, null).level;
    for (const zoom of [40, ZOOM, 200]) {
      const plates = polygons(deckLabelsLayer(doc, level, CANVAS_STYLE, zoom));
      const boxes = labelledDecks(doc, level).map((d) => deckLabelBox(d, CANVAS_STYLE, zoom));
      expect(boxes).toHaveLength(plates.length);
      boxes.forEach((b, i) => {
        const xs = (plates[i]?.points ?? []).map((q) => q.x);
        const ys = (plates[i]?.points ?? []).map((q) => q.y);
        expect([b.min.x, b.max.x, b.min.y, b.max.y].map((v) => +v.toFixed(9))).toEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(9)));
      });
    }
  });

  it("on paper, with no plate drawn, the box still surrounds the label's text", () => {
    const doc = decksDoc();
    const level = floorView(doc, null).level;
    const labels = titles(deckLabelsLayer(doc, level, PRESENTATION_STYLE, ZOOM));
    const boxes = labelledDecks(doc, level).map((d) => deckLabelBox(d, PRESENTATION_STYLE, ZOOM));
    expect(boxes).toHaveLength(labels.length);
    boxes.forEach((b, i) => {
      const t = labels[i];
      if (!t) throw new Error("no label");
      expect(b.at).toEqual(t.at);
      expect(b.min.x).toBeLessThan(t.at.x);
      expect(b.max.x).toBeGreaterThan(t.at.x + textWidth(PRESENTATION_STYLE.font, t.text, t.size) / ZOOM);
      expect(b.min.y).toBeLessThan(t.at.y);
      expect(b.max.y).toBeGreaterThan(t.at.y);
    });
  });

  it("the decks labelled at a level are those not under it", () => {
    const doc = decksDoc();
    expect(labelledDecks(doc, floorView(doc, null).level).map((d) => d.id).sort()).toEqual(["l/k0", "p/k0"]);
    expect(labelledDecks(doc, levelOf(doc, "l/k0")).map((d) => d.id)).toEqual(["l/k0"]); // the platform is under the loft
  });
});

describe("the decks layer on the canvas (decks.19)", () => {
  it("LAYER_ORDER puts decks between the zone fills, then the deck floors (deck-floors.06), and objects, overheads after objects and before walls", () => {
    const i = LAYER_ORDER.indexOf("decks");
    expect(LAYER_ORDER[i - 2]).toBe("zoneFills");
    expect(LAYER_ORDER[i - 1]).toBe("deckFloors");
    expect(LAYER_ORDER[i + 1]).toBe("objects");
    expect(LAYER_ORDER[i + 2]).toBe("overheads");
    expect(LAYER_ORDER.indexOf("overheads")).toBeLessThan(LAYER_ORDER.indexOf("walls"));
  });

  it("LAYER_ORDER puts deck labels after openings and before tags", () => {
    const i = LAYER_ORDER.indexOf("deckLabels");
    expect(LAYER_ORDER[i - 1]).toBe("openings");
    expect(LAYER_ORDER[i + 1]).toBe("tags");
  });

  it("the Scene's decks, overheads and deck labels layers are the deck builders in the canvas style, selected decks in blue", () => {
    const shell = FakeShell.withDocument(decksDoc());
    const layer = (name: "decks" | "overheads" | "deckLabels"): readonly Primitive[] => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
    expect(layer("decks")).toBe(decksLayer(shell.doc(), floorView(shell.doc(), null).level, CANVAS_STYLE, NONE, ""));
    expect(layer("deckLabels")).toBe(deckLabelsLayer(shell.doc(), floorView(shell.doc(), null).level, CANVAS_STYLE, shell.state.camera.zoom));
    expect(layer("overheads")).toBe(overheadsLayer(shell.doc(), floorView(shell.doc(), null).level, CANVAS_STYLE, NONE, null));
    shell.state = { ...shell.state, selection: [{ table: "decks", id: "p/k0" }, { table: "decks", id: "l/k0" }] };
    expect(segments(platform(layer("decks"))).map((s) => s.color)).toEqual(Array(4).fill(COLORS.wallSelected));
    expect(segments(layer("overheads")).map((s) => s.color)).toEqual(Array(4).fill(COLORS.wallSelected));
  });
});
