import { describe, expect, it } from "vitest";
import { levelOf, type Document } from "@fm/domain";
import { pictureLayers, planPicture } from "../src/view/picture";
import { presentationStyle } from "../src/view/plan-style";
import { paperView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { cabinDoc, withCommands } from "./builders";

// The final gate's AC-06 gap: a guard on paper through the exports' own path, planPicture with presentationStyle(doc) at a
// paper view, as page-plan.ts does. The cabin's loft has one open edge, x 2.10, y 0.10–2.90, a 2.80 m rail.

const LOFT = "loft/k0";
const ZOOM = 20; // paper millimetres per metre, a 1:50 page
type Segment = Extract<Primitive, { kind: "segment" }>;
type Disc = Extract<Primitive, { kind: "disc" }>;
const onEdge = (p: { x: number }): boolean => Math.abs(p.x - 2.1) < 1e-6;

/** The paper picture's guard marks along the loft's open edge: lines of the guard's width, and post discs. */
function paperGuard(doc: Document, deck: string | null) {
  const style = presentationStyle(doc);
  const picture = pictureLayers(planPicture(doc, paperView("s0", levelOf(doc, deck)), style, ZOOM, false));
  const lines = picture.filter((p): p is Segment => p.kind === "segment" && onEdge(p.a) && onEdge(p.b) && "px" in p.width && p.width.px === style.guard.line);
  const posts = picture.filter((p): p is Disc => p.kind === "disc" && onEdge(p.center) && "px" in p.radius && p.radius.px === style.guard.post);
  return { lines, posts, ink: style.guard.ink };
}

describe("a guard on paper (AC-06)", () => {
  it("at the loft's level a Railing is an ink line with post marks, a Glass guard an ink line with none; at the floor, neither", () => {
    const railing = paperGuard(cabinDoc(), LOFT);
    expect(railing.lines).toHaveLength(1);
    expect(railing.lines.flatMap((l) => [l.a.y, l.b.y]).sort((p, q) => p - q)).toEqual([expect.closeTo(0.1, 6), expect.closeTo(2.9, 6)]);
    expect(railing.lines[0]?.color).toBe(railing.ink);
    expect(railing.posts.length).toBeGreaterThanOrEqual(3); // both ends, and between them
    expect(new Set(railing.posts.map((d) => d.color))).toEqual(new Set([railing.ink]));

    const glass = paperGuard(withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "glass" }), LOFT);
    expect(glass.lines.map((l) => l.color)).toEqual([glass.ink]);
    expect(glass.posts).toEqual([]);

    const floor = paperGuard(cabinDoc(), null);
    expect([floor.lines, floor.posts]).toEqual([[], []]);
  });
});
