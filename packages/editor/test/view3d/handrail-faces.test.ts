import { describe, expect, it } from "vitest";
import { emptyDocument, flightHandrails, rectangleRoom, type Command, type Document, type Handrail, type Section } from "@fm/domain";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { newell } from "../../src/view3d/prism";
import { sectionPicture } from "../../src/view3d/section-picture";
import { stairFaces } from "../../src/view3d/stair-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { withCommands } from "../builders";

// A handrail in 3D and in a section (AC-11): a sloped rail on a post at each end, in the stair's own faces. The 8 × 6 room's
// loft is at x 0.1–2.1, y 1.5–4.5; the stair's back is at (2.1, 3), running +x to its foot at x 5.088, y 2.55–3.45: 12 risers
// of 0.179, 11 goings of 0.2716, its pitch line 0.179 at the foot and level at 1.971 past the last nosing.

const LOFT = "l/k0";
const RISER = 2.15 / 12;
const RUN = 2.988;
const GOING = RUN / 11;
const LEVEL = RUN - GOING;
const FOOT = 5.088;
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const place = (kind = "stair", shape: "straight" | "l-right" = "straight"): Command => ({ type: "placeStair", opId: "ps", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape });
const pieces = (doc: Document): PieceItem[] => view3dItems(doc, "s0", null, new Set(), false).filter((i): i is PieceItem => i.item === "piece");
const pieceOf = (doc: Document): PieceItem => {
  const [item] = pieces(doc);
  if (!item) throw new Error("no piece");
  return item;
};
/** The faces handrails add to a piece, which are at the end of its list. */
const railFaces = (item: PieceItem): Face3d[] => {
  const bare = { ...item };
  delete bare.handrails;
  const all = stairFaces("o", item, STYLE_3D.stair, STYLE_3D.glass) ?? [];
  const body = stairFaces("o", bare, STYLE_3D.stair, STYLE_3D.glass) ?? [];
  return all.slice(body.length);
};
const pitch = (a: number): number => RISER + Math.min(a, LEVEL) * (RISER / GOING);
/** How far up the run a world point on this flight is. */
const up = (p: { x: number }): number => FOOT - p.x;
const near = (p: { y: number }, y: number): boolean => Math.abs(p.y - y) <= 0.021;

describe("a handrail in 3D", () => {
  it("is added to the stair's own faces, an open side's worth each", () => {
    const item = pieceOf(room(place()));
    expect(item.handrails).toHaveLength(2);
    const rails = railFaces(item);
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.every((f) => f.points.every((p) => near(p, 3 - 0.43) || near(p, 3 + 0.43)))).toBe(true);
  });

  it("isn't on a side against a wall", () => {
    const item = pieceOf(room({ type: "addWall", opId: "wr", from: { at: { x: 2.1, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } }, place()));
    const rails = railFaces(item);
    expect(rails.some((f) => f.points.some((p) => near(p, 3 - 0.43)))).toBe(true);
    expect(rails.some((f) => f.points.some((p) => near(p, 3 + 0.43)))).toBe(false);
  });

  it("follows the pitch line, its top 0.90 above it the whole way", () => {
    const rails = railFaces(pieceOf(room(place())));
    const points = rails.flatMap((f) => f.points);
    for (const p of points) expect(p.z).toBeLessThanOrEqual(pitch(up(p)) + 0.9 + 1e-6);
    // Its top at the foot, at the bend and at the top of the run.
    for (const a of [0, LEVEL, RUN]) {
      const top = Math.max(...points.filter((p) => Math.abs(up(p) - a) < 1e-6).map((p) => p.z));
      expect(top, `at ${a}`).toBeCloseTo(pitch(a) + 0.9, 6);
    }
  });

  it("stands on a post at each end, each reaching down to the tread under it", () => {
    const points = railFaces(pieceOf(room(place()))).flatMap((f) => f.points);
    const lowest = (a: number): number => Math.min(...points.filter((p) => Math.abs(up(p) - a) < 0.05).map((p) => p.z));
    expect(lowest(0)).toBeCloseTo(RISER, 6);
    expect(lowest(RUN)).toBeCloseTo(11 * RISER, 6);
    // Nothing touches down between them.
    const middle = points.filter((p) => up(p) > 0.1 && up(p) < RUN - 0.1);
    for (const p of middle) expect(p.z).toBeGreaterThan(pitch(up(p)) + 0.8);
  });

  it("a stretch ending part way up has its post reach the tread there, not hang off the pitch line", () => {
    // The wall's end at x 3.5 is 1.588 up the run, on the sixth tread (top 6 risers), whose pitch there is higher than it.
    const item = pieceOf(room({ type: "addWall", opId: "wr", from: { at: { x: 3.5, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } }, place()));
    const rails = railFaces(item).flatMap((f) => f.points).filter((p) => near(p, 3 + 0.43));
    const low = Math.min(...rails.map((p) => p.z));
    expect(low).toBeCloseTo(6 * RISER, 3);
  });

  it("a stretch shorter than a post keeps its faces real", () => {
    const item = pieceOf(room({ type: "addWall", opId: "wr", from: { at: { x: 2.125, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } }, place()));
    const rails = railFaces(item).flatMap((f) => f.points).filter((p) => near(p, 3 + 0.43));
    expect(rails.length).toBeGreaterThan(0);
    for (const p of rails) {
      expect(Number.isFinite(p.z)).toBe(true);
      expect(up(p)).toBeGreaterThan(RUN - 0.03);
      expect(p.z).toBeLessThanOrEqual(pitch(RUN) + 0.9 + 1e-6);
    }
    expect(Math.max(...rails.map((p) => p.z))).toBeCloseTo(pitch(RUN) + 0.9, 6);
    // Its post's top is the rail's there, not the foot of a rail read off the wrong end.
    expect(Math.min(...rails.map((p) => p.z))).toBeCloseTo(11 * RISER, 6);
  });

  it("stops at the ceiling", () => {
    const rails = railFaces(pieceOf(room({ type: "setCeiling", height: 2.6 }, place()))).flatMap((f) => f.points);
    expect(Math.max(...rails.map((p) => p.z))).toBeCloseTo(2.6, 6);
  });

  it("every face is wound from outside", () => {
    const item = pieceOf(room(place()));
    const tops = railFaces(item).filter((f) => f.points.every((p) => p.y < 3 && p.z > pitch(up(p)) + 0.89 - 1e-6));
    expect(tops.length).toBeGreaterThan(0);
    for (const f of tops) expect(newell(f.points).z).toBeGreaterThan(0);
    // The side facing +y turned out, the one facing −y turned the other way.
    const sides = railFaces(item).filter((f) => f.points.every((p) => p.y < 3) && new Set(f.points.map((p) => Math.round(p.y * 1e6))).size === 1);
    expect(sides.length).toBeGreaterThan(0);
    for (const f of sides) expect(Math.sign(newell(f.points).y)).toBe((f.points[0]?.y ?? 0) > 3 - 0.43 ? 1 : -1);
  });

  it("takes the selection's colour with its stair", () => {
    const doc = room(place());
    const [item] = view3dItems(doc, "s0", null, new Set(["ps/s0/p0"]), false).filter((i): i is PieceItem => i.item === "piece");
    if (!item) throw new Error("no piece");
    const colours = new Set(faces3d(item).filter((f) => f.points.every((p) => p.z > 2.2)).map((f) => f.color));
    expect(colours.size).toBeGreaterThan(0);
    for (const c of colours) expect([STYLE_3D.selected.top, STYLE_3D.selected.lit, STYLE_3D.selected.shaded]).toContain(c);
  });

  it.each(["stair", "openStair", "storageStair", "shipsLadder", "alternatingTread"])("a %s has it, in its faces", (kind) => {
    const item = pieceOf(room(place(kind)));
    const rails: readonly Handrail[] = item.handrails ?? [];
    expect(rails).toHaveLength(2);
    const added = railFaces(item);
    expect(added.length).toBeGreaterThan(0);
    const top = Math.max(...rails.flatMap((r) => r.knots.map((k) => k.top)));
    expect(Math.max(...added.flatMap((f) => f.points.map((p) => p.z)))).toBeCloseTo(top, 6);
    expect(Math.max(...faces3d(item).flatMap((f) => f.points.map((p) => p.z)))).toBeCloseTo(top, 6);
  });

  it.each(["rungLadder", "spiralStair"])("a %s has none", (kind) => {
    const item = pieceOf(room(place(kind)));
    expect(item.handrails).toBeUndefined();
    expect(railFaces(item)).toEqual([]);
  });

  it("an L's two flights both have it", () => {
    const flights = pieces(room(place("stair", "l-right")));
    expect(flights).toHaveLength(2);
    for (const f of flights) expect(railFaces(f).length).toBeGreaterThan(0);
  });

  it("the plan and 3D read one list", () => {
    const doc = room(place());
    expect(pieceOf(doc).handrails).toEqual(flightHandrails(doc).get(pieceOf(doc).object));
  });
});

describe("a handrail in a section", () => {
  // A section's picture has x from the line's `a`, so with `a` at x 1 the flight is x' 1.10–4.09; side 1 looks along +y here.
  const picture = (doc: Document, s: Section): readonly Primitive[] => sectionPicture(doc, s, "s0", CANVAS_STYLE, 70).primitives;
  const INK = CANVAS_STYLE.section;
  type Polygon = Extract<Primitive, { kind: "polygon" }>;
  const facing: Section = { id: "A", a: { x: 1, y: 2 }, b: { x: 7, y: 2 }, side: 1, depth: 2.5 };
  const along: Section = { id: "A", a: { x: 1, y: 3 }, b: { x: 7, y: 3 }, side: 1, depth: 2 };
  const wall: Command = { type: "addWall", opId: "wr", from: { at: { x: 2.1, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } };
  /** What rises above the stair's 2.15 top, over the flight, and stops under the loft's guard, which is up at the ceiling. */
  const overFlight = (ps: readonly Primitive[]) => ps.filter((p): p is Polygon => {
    if (p.kind !== "polygon" || !p.points.every((q) => q.x >= 1.05 && q.x <= 4.1)) return false;
    const top = Math.max(...p.points.map((q) => q.y));
    return top > 2.2 && top < 2.95;
  });
  const topOf = (ps: readonly Polygon[]): number => Math.max(...ps.flatMap((p) => p.points.map((q) => q.y)));

  it("past the line, it's in the picture by itself, as white shapes, its top on the rail's", () => {
    const rails = overFlight(picture(room(place()), facing));
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.every((p) => p.color === INK.beyond)).toBe(true);
    expect(topOf(rails)).toBeCloseTo(1.971 + 0.9, 2);
  });

  it("it isn't there looking the other way", () => {
    expect(overFlight(picture(room(place()), { ...facing, side: -1, depth: 1 }))).toEqual([]);
  });

  it("a line along the flight's middle shows the rail past it", () => {
    expect(topOf(overFlight(picture(room(place()), along)))).toBeCloseTo(1.971 + 0.9, 2);
  });

  it("with the far side against a wall, there's none past that line: the near rail is behind it", () => {
    expect(overFlight(picture(room(wall, place()), along))).toEqual([]);
  });

  it("a line crossing it draws no cut shape, and shows the part past the line", () => {
    const across: Section = { id: "A", a: { x: 3.5, y: 1 }, b: { x: 3.5, y: 5 }, side: 1, depth: null };
    const ps = picture(room(place()), across);
    const cutUp = ps.filter((p): p is Polygon => p.kind === "polygon" && p.color === INK.cut && p.points.every((q) => q.y > 0.5 && q.y < 2.95));
    expect(cutUp).toEqual([]);
    // Side 1 looks toward the flight's high end, so the rail is up there.
    const past = ps.filter((p): p is Polygon => p.kind === "polygon" && p.color === INK.beyond && p.points.some((q) => q.y > 2.2 && q.y < 2.95) && Math.max(...p.points.map((q) => q.y)) < 2.95);
    expect(past.length).toBeGreaterThan(0);
  });
});
