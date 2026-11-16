import { describe, expect, it } from "vitest";
import type { Section, Document } from "@fm/domain";
import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { sectionPicture } from "../../src/view3d/section-picture";
import { cabinDoc, withCommands } from "../builders";

// Guards in a section (AC-10, guards.09): past the line as thin outlines, never as cut shapes. The cabin's loft has one
// open edge, x 2.10, y 0.10–2.90, from 2.15 to the 3.05 ceiling; the cuts look along +x or +y.

const LOFT = "loft/k0";
const INK = CANVAS_STYLE.section;
const picture = (doc: Document, s: Section): readonly Primitive[] => sectionPicture(doc, s, "s0", CANVAS_STYLE, 70).primitives;
const polygons = (ps: readonly Primitive[]) => ps.filter((p): p is Extract<Primitive, { kind: "polygon" }> => p.kind === "polygon");
/** Shapes wholly in the rail's height: above the loft's top, up to the ceiling. */
const inRailHeight = (ps: readonly Primitive[]) => polygons(ps).filter((p) => p.points.every((q) => q.y >= 2.15 - 1e-6 && q.y <= 3.05 + 1e-6));
/** Looking at the open edge across x, from the room's far side. */
const facing = (depth: number | null = null): Section => ({ id: "A", a: { x: 3.5, y: 3.5 }, b: { x: 3.5, y: -0.5 }, side: -1, depth });
/** A line along x that crosses the rail, looking along y. */
const crossing: Section = { id: "A", a: { x: 1, y: 1.5 }, b: { x: 3.5, y: 1.5 }, side: 1, depth: null };

describe("a guard past the line", () => {
  it("a Railing draws its posts and its top rail as outlined shapes", () => {
    const shapes = inRailHeight(picture(cabinDoc(), facing()));
    expect(shapes.length).toBeGreaterThanOrEqual(4); // three or more posts, and the rail
  });

  it("they're white with thin outlines, as a piece's parts are", () => {
    const ps = picture(cabinDoc(), facing());
    expect(inRailHeight(ps).every((p) => p.color === INK.beyond)).toBe(true);
    // Only what's above the loft's top: the slab draws in the same ink, so a test of the whole picture proves nothing.
    const lines = ps.filter((p): p is Extract<Primitive, { kind: "segment" }> => p.kind === "segment" && p.a.y > 2.15 + 1e-6 && p.b.y > 2.15 + 1e-6 && p.a.y < 3.05 - 1e-6 && p.b.y < 3.05 - 1e-6 && p.color !== INK.beyondWall);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.color).toBe(INK.beyondPart);
      expect(l.width).toEqual({ px: INK.beyondPartWidth });
    }
  });

  it("a Glass guard draws a plain panel, and no posts", () => {
    const doc = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "glass" });
    const shapes = inRailHeight(picture(doc, facing()));
    expect(shapes.length).toBe(2); // the pane and its rail
  });

  it("None draws none", () => {
    const doc = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "none" });
    expect(inRailHeight(picture(doc, facing()))).toEqual([]);
  });

  it("a side set to None draws nothing in a section, and only that side (edges AC-01)", () => {
    expect(inRailHeight(picture(withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guardRight: { kind: "none" } }), facing()))).toEqual([]);
    const front = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guardFront: { kind: "none" } });
    expect(inRailHeight(picture(front, facing())).length).toBeGreaterThanOrEqual(4);
  });

  it("past the section's depth, none", () => {
    expect(inRailHeight(picture(cabinDoc(), facing(0.5)))).toEqual([]);
  });
});

describe("a line crossing a rail", () => {
  it("draws no cut shape for it: the cut is the same with and without a guard", () => {
    const cuts = (doc: Document) => polygons(picture(doc, crossing)).filter((p) => p.color === INK.cut).map((p) => p.points);
    const none = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "none" });
    expect(cuts(cabinDoc())).toEqual(cuts(none));
    expect(cuts(none).length).toBeGreaterThan(0);
  });
});
