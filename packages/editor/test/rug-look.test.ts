import { describe, expect, it } from "vitest";
import { footprintQuad, kindConfigs, motifDefaults, pointInPolygon, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { flipObjectsLayer, objectsLayer } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { planPicture } from "../src/view/picture";
import { CANVAS_STYLE, PRESENTATION_STYLE, onFinishes, type PlanStyle } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { labelledDoc, roomDoc, withCommands } from "./builders";

// How a rug draws (catalog.15, the mockup): under every piece, in its own lighter fill in both looks and on paper. Every
// renderer draws a layer's fills before its lines (clip.ts), so a piece's fill can't hide the rug's lines: they are
// clipped. roomDoc: a 6 × 4 room; a rug 3.00 × 2.00 at x 1.5–4.5, y 1.2–3.2, a sofa on it at x 1.95–4.05, y 2.1–3.0.

const place = (opId: string, kind: string, at: Point, rotation = 0, preset?: string): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: preset === undefined ? { kind } : { kind, preset }, at, rotation });
const RUG = (id = "z"): Command => place(id, "rug", { x: 3, y: 3.2 }, 0, "300");
const SOFA = place("s", "sofa", { x: 3, y: 3 });
const layer = (doc: Document, style: PlanStyle = CANVAS_STYLE, selected = ""): readonly Primitive[] => objectsLayer(doc, floorView(doc, "s0"), style, selected, 50);
const fills = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));
const lines = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const inside = (q: Point, x0: number, x1: number, y0: number, y1: number): boolean => q.x > x0 + 1e-6 && q.x < x1 - 1e-6 && q.y > y0 + 1e-6 && q.y < y1 - 1e-6;
const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const apart = (a: string, b: string): number => Math.max(...channels(a).map((v, i) => Math.abs(v - (channels(b)[i] ?? 0))));

describe("the rug's fill", () => {
  it("is the mockup's #ecebe6, opaque, lighter than the grey pieces, off the white ones", () => {
    expect(COLORS.rug).toBe("#ecebe6");
    expect(CANVAS_STYLE.rugFill).toBe(COLORS.rug);
    expect(channels(CANVAS_STYLE.rugFill).every((v, i) => v > (channels(CANVAS_STYLE.objectFill)[i] ?? 0))).toBe(true);
    const white = onFinishes(CANVAS_STYLE);
    expect(white.rugFill).toMatch(/^#[0-9a-f]{6}$/);
    expect(apart(white.rugFill, white.objectFill)).toBeGreaterThanOrEqual(16);
  });

  it("reads on paper: apart from the white sheet and from the pieces' fill, with its outline in ink", () => {
    expect(apart(PRESENTATION_STYLE.rugFill, "#ffffff")).toBeGreaterThanOrEqual(16);
    expect(apart(PRESENTATION_STYLE.rugFill, PRESENTATION_STYLE.objectFill)).toBeGreaterThanOrEqual(8);
    const doc = withCommands(roomDoc(), RUG(), SOFA);
    const objects = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true).objects;
    expect(fills(objects).map((p) => p.color)).toEqual([PRESENTATION_STYLE.rugFill, PRESENTATION_STYLE.objectFill]);
    expect(lines(objects).filter((s) => s.color === PRESENTATION_STYLE.objectLine).length).toBeGreaterThan(4);
  });

  it("over finishes keeps the rug's own fill, under white pieces", () => {
    const doc = withCommands(labelledDoc(), place("r", "rug", { x: 1.5, y: 3 }), { type: "setFinish", id: "L1", finish: motifDefaults("planks") }, place("a", "armchair", { x: 1.5, y: 2.7 }));
    const objects = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true).objects;
    expect(fills(objects).map((p) => p.color)).toEqual([COLORS.rug, COLORS.objectOnFinish]);
  });

  it("selected, a rug fills like any selected piece", () => {
    const doc = withCommands(roomDoc(), RUG());
    expect(fills(layer(doc, CANVAS_STYLE, "z/p0"))[0]?.color).toBe(COLORS.objectSelected);
  });

  it("the palette's cards fill in it, and only the rugs' cards and the set with a rug", () => {
    const filled = PALETTE.flatMap((g) => g.cards).filter((c) => tileLook(c).some((p) => p.kind === "polygon" && p.color === CANVAS_STYLE.rugFill)).map((c) => c.kind);
    expect(filled).toEqual(["sofaAndRug", "rug", "roundRug"]);
  });
});

describe("a rug draws under every piece", () => {
  it.each([["z", "a rug whose ID sorts last"], ["a", "a rug whose ID sorts first"]])("%s: %s fills before the sofa", (id) => {
    const doc = withCommands(roomDoc(), RUG(id), SOFA);
    expect(fills(layer(doc)).map((p) => p.color)).toEqual([CANVAS_STYLE.rugFill, CANVAS_STYLE.objectFill]);
  });

  it("its lines are cut outside the sofa's fill: nothing of the rug shows through, in any renderer", () => {
    // The sofa across the rug's front, x 1.95–4.05, y 0.8–1.7: over its border, y 1.3, and its edge, y 1.2.
    const across = place("s", "sofa", { x: 3, y: 1.7 });
    const atBorder = (ps: readonly Primitive[]) => lines(ps).filter((s) => Math.abs(s.a.y - 1.3) < 1e-9 && Math.abs(s.b.y - 1.3) < 1e-9);
    const alone = atBorder(layer(withCommands(roomDoc(), RUG())));
    expect(alone).toHaveLength(1); // the fixture: one border line, under where the sofa will stand
    const cut = atBorder(layer(withCommands(roomDoc(), RUG(), across)));
    expect(cut).toHaveLength(2);
    for (const s of cut) {
      expect(inside(s.a, 1.95, 4.05, 0.8, 1.7), `${s.a.x}`).toBe(false);
      expect(inside(s.b, 1.95, 4.05, 0.8, 1.7), `${s.b.x}`).toBe(false);
    }
  });

  it("a piece above the cut has no fill, so it hides none of the rug's lines", () => {
    const withCabinet = withCommands(roomDoc(), RUG(), place("k", "wallCabinet", { x: 3, y: 2.5 }));
    const ofRug = (doc: Document): number => lines(layer(doc)).filter((s) => s.color === CANVAS_STYLE.objectDetail).length;
    expect(ofRug(withCabinet)).toBe(ofRug(withCommands(roomDoc(), RUG())));
    expect(fills(layer(withCabinet)).map((p) => p.color)).toEqual([CANVAS_STYLE.rugFill]);
  });

  it("a set hides the rug's lines by its parts, not its box: they show between the table and its chairs", () => {
    // A 1.20 × 2.00 set with its back at y 3.1, its front at y 1.1: the rug's border, y 1.3, runs through its front row of chairs,
    // x 2.475–2.925 and 3.075–3.525, and shows between them.
    const c = kindConfigs("seatedDining")[0];
    const objects = layer(withCommands(roomDoc(), RUG(), place("d", "seatedDining", { x: 3, y: 3.1 })));
    const parts = fills(objects).slice(1).map((f) => f.points);
    expect(parts.length).toBeGreaterThan(1);
    const border = lines(objects).filter((s) => Math.abs(s.a.y - 1.3) < 1e-9 && Math.abs(s.b.y - 1.3) < 1e-9);
    const mid = (s: { a: Point; b: Point }): Point => ({ x: (s.a.x + s.b.x) / 2, y: s.a.y });
    for (const s of border) for (const ring of parts) expect(pointInPolygon(mid(s), ring), `${s.a.x}…${s.b.x}`).toBe(false);
    const box = footprintQuad({ x: 3, y: 3.1 }, c?.w ?? 0, c?.d ?? 0, 0);
    expect(border.some((s) => pointInPolygon(mid(s), box))).toBe(true);
  });

  it("selected, its lines come whole, after every piece", () => {
    const doc = withCommands(roomDoc(), RUG(), SOFA);
    const objects = layer(doc, CANVAS_STYLE, "z/p0");
    const sofaFill = objects.findIndex((p) => p.kind === "polygon" && p.color === CANVAS_STYLE.objectFill);
    const rugLines = objects.flatMap((p, i) => (p.kind === "segment" && p.color === COLORS.wallSelected ? [i] : []));
    expect(rugLines.length).toBe(lines(layer(withCommands(roomDoc(), RUG()), CANVAS_STYLE, "z/p0")).length);
    expect(Math.min(...rugLines)).toBeGreaterThan(sofaFill);
  });

  it("two rugs: the later rug's fill hides the earlier one's lines", () => {
    // Rug a: x 2–4, y 1.6–3, its border at y 1.698. Round rug b, the later ID: centre (3, 2.1), radius 0.8, across that border.
    const a = place("a", "rug", { x: 3, y: 3 });
    const atBorder = (ps: readonly Primitive[]) => lines(ps).filter((s) => Math.abs(s.a.y - 1.698) < 1e-9 && Math.abs(s.b.y - 1.698) < 1e-9);
    expect(atBorder(layer(withCommands(roomDoc(), a)))).toHaveLength(1);
    expect(atBorder(layer(withCommands(roomDoc(), a, place("b", "roundRug", { x: 3, y: 2.9 }))))).toHaveLength(2);
  });

  it("during a flip a rug still fills first, in its own fill", () => {
    const doc = withCommands(roomDoc(), RUG(), SOFA);
    const flipped = flipObjectsLayer(doc, floorView(doc, "s0").level, { from: "s0", to: "s0", t: 0.5 });
    expect(fills(flipped).map((p) => p.color.slice(0, 7))).toEqual([CANVAS_STYLE.rugFill, CANVAS_STYLE.objectFill]);
  });

  it("a rug raised above the cut draws its dashed outline, no fill", () => {
    const raised = withCommands(roomDoc(), RUG(), { type: "setObjectSize", objectId: "z/o0", w: 3, d: { standard: 2 }, z: { standard: 1.5 } });
    expect(fills(layer(raised))).toEqual([]);
    expect(lines(layer(raised)).length).toBeGreaterThan(0);
    expect(lines(layer(raised)).every((s) => s.dash !== undefined)).toBe(true);
  });

  it("a rug on a loft isn't drawn at the floor, and a piece under it keeps its own place", () => {
    const doc = withCommands(roomDoc(),
      { type: "addDeck", opId: "deck", preset: "loft", at: { x: 3, y: 2 }, w: 4, d: 3 },
      { type: "placeObject", deck: "deck/k0", opId: "r", state: "s0", object: { kind: "rug" }, at: { x: 3, y: 2.7 } },
      place("a", "armchair", { x: 3, y: 2.6 }));
    expect(fills(layer(doc)).map((p) => p.color)).toEqual([CANVAS_STYLE.objectFill]);
  });
});
