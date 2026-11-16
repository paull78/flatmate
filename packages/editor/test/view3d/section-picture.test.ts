import { describe, expect, it } from "vitest";
import { SURROUNDINGS_VALUES, ceilingHeight, execute, pointInPolygon, unwrap, type Command, type Document, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { textWidth } from "../../src/view/fonts";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../../src/view/plan-style";
import type { PlanStyle } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { view3dItems } from "../../src/view3d/items";
import { clipRing, lineInside, sectionFrame } from "../../src/view3d/section-cut";
import { sectionBounds, sectionPicture, type SectionPicture } from "../../src/view3d/section-picture";
import { roomDoc, wallBetween, wallDoc } from "../builders";

// A section's cut (AC-06, AC-08): what the plane passes through, in metres with x along the line and y up. Every rule is
// read back as the picture: is this point of the picture filled, and in what colour.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const cutting = (a: Point, b: Point, side: 1 | -1 = 1, depth: number | null = null): Section => ({ id: "A", a, b, side, depth });
const picture = (doc: Document, s: Section, layout = "s0", style: PlanStyle = CANVAS_STYLE, zoom = 70): SectionPicture => sectionPicture(doc, s, layout, style, zoom);

type Polygon = Extract<Primitive, { kind: "polygon" }>;
const INK = CANVAS_STYLE.section;
const polygons = (p: SectionPicture, color: string): Polygon[] => p.primitives.flatMap((q) => (q.kind === "polygon" && q.color === color ? [q] : []));
/** Whether the picture's polygons of `color` fill (x, z): even-odd over a polygon's ring and holes, as every writer draws it. */
const filled = (p: SectionPicture, color: string, x: number, z: number): boolean =>
  polygons(p, color).some((q) => [q.points, ...q.holes].filter((r) => pointInPolygon({ x, y: z }, r)).length % 2 === 1);
const dark = (p: SectionPicture, x: number, z: number): boolean => filled(p, INK.cut, x, z);
const xsOf = (q: Polygon): number[] => [q.points, ...q.holes].flat().map((r) => r.x);
const zsOf = (q: Polygon): number[] => [q.points, ...q.holes].flat().map((r) => r.y);
const texts = (p: SectionPicture): Extract<Primitive, { kind: "text" }>[] => p.primitives.flatMap((q) => (q.kind === "text" ? [q] : []));
const heightLines = (p: SectionPicture): Extract<Primitive, { kind: "segment" }>[] => p.primitives.flatMap((q) => (q.kind === "segment" && q.color === INK.heightLine ? [q] : []));

function northWall(doc: Document): string {
  return wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
}

/** The 6 × 4 room with a door at x 2.0–2.8 and a window at x 3.5–4.5 on its north wall (y = 4, faces at 3.9 and 4.1). */
function openingsRoom(): Document {
  const doc = roomDoc();
  const wall = northWall(doc);
  const joint = doc.joints[doc.walls[wall]?.a ?? ""];
  const offset = (x0: number, x1: number): number => (joint?.x === 0 ? x0 : (joint?.x ?? 0) - x1);
  return ok(doc, { type: "addOpening", opId: "door", wall, kind: "swing", offset: offset(2, 2.8), width: 0.8 }, { type: "addOpening", opId: "win", wall, kind: "window", offset: offset(3.5, 4.5), width: 1 });
}

const HEAD = 2.1; // a door's and window's head in a 2.50 m room
const SILL = 0.9;
/** A section across the north wall at `x`, looking west: the wall lies at x 0.9 to 1.1 in the picture. */
const acrossNorth = (x: number): Section => cutting({ x, y: 3 }, { x, y: 5 });

describe("a section through doors and windows", () => {
  it("a cut through a door shows wall only above its head", () => {
    const p = picture(openingsRoom(), acrossNorth(2.4));
    expect(dark(p, 1, 1)).toBe(false);
    expect(dark(p, 1, HEAD - 0.05)).toBe(false);
    expect(dark(p, 1, HEAD + 0.05)).toBe(true);
    expect(filled(p, INK.pane, 1, 1)).toBe(false); // a door has no pane
  });

  it("the same cut past the door shows wall all the way up", () => {
    const p = picture(openingsRoom(), acrossNorth(1.5));
    expect(dark(p, 1, 1)).toBe(true);
    expect(dark(p, 1, HEAD + 0.05)).toBe(true);
    expect(dark(p, 0.85, 1)).toBe(false);
    expect(dark(p, 1.15, 1)).toBe(false);
  });

  it("a cut through a window shows wall above its head and below its sill, with a pale pane", () => {
    const p = picture(openingsRoom(), acrossNorth(4));
    expect(dark(p, 1, SILL - 0.05)).toBe(true);
    expect(dark(p, 1, 1.5)).toBe(false);
    expect(dark(p, 1, HEAD + 0.05)).toBe(true);
    const panes = polygons(p, INK.pane);
    expect(panes).toHaveLength(1);
    expect(filled(p, INK.pane, 1, 1.5)).toBe(true);
    expect(filled(p, INK.pane, 1, SILL - 0.05)).toBe(false);
    expect(filled(p, INK.pane, 1, HEAD + 0.05)).toBe(false);
    expect(Math.min(...panes.flatMap(xsOf))).toBeCloseTo(0.9, 9);
    expect(Math.max(...panes.flatMap(xsOf))).toBeCloseTo(1.1, 9);
  });

  it("a pane has its outline", () => {
    const p = picture(openingsRoom(), acrossNorth(4));
    const outline = p.primitives.filter((q) => q.kind === "segment" && q.color === INK.paneLine);
    expect(outline).toHaveLength(4);
  });
});

describe("a section along a wall", () => {
  const along = (): SectionPicture => picture(openingsRoom(), cutting({ x: -0.5, y: 4 }, { x: 6.5, y: 4 }));

  it("stays one shape, with no seams or slivers", () => {
    const shapes = polygons(along(), INK.cut);
    expect(shapes).toHaveLength(1);
    const shape = shapes[0];
    if (!shape) throw new Error("no shape");
    expect(shape.holes).toHaveLength(2); // the door's and the window's, framed by the floor's band
    for (const ring of [shape.points, ...shape.holes]) {
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length] ?? a;
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.05);
      });
    }
  });

  it("keeps the door's and the window's openings where they are along it", () => {
    const p = along();
    const x = (world: number): number => world + 0.5;
    expect(dark(p, x(1.9), 1)).toBe(true);
    expect(dark(p, x(2.1), 1)).toBe(false);
    expect(dark(p, x(2.7), 1)).toBe(false);
    expect(dark(p, x(2.9), 1)).toBe(true);
    expect(dark(p, x(2.4), HEAD + 0.05)).toBe(true);
    expect(dark(p, x(4), 1.5)).toBe(false);
    expect(dark(p, x(4), 0.5)).toBe(true);
    expect(filled(p, INK.pane, x(4), 1.5)).toBe(true);
    expect(filled(p, INK.pane, x(3.4), 1.5)).toBe(false);
  });

  it("a flip looks at it from the other side: the picture mirrors, and x still grows to the viewer's right", () => {
    const [a, b] = [{ x: -0.5, y: 4 }, { x: 6.5, y: 4 }];
    const flipped = picture(openingsRoom(), cutting(a, b, -1));
    const x = (world: number): number => 6.5 - world;
    expect(dark(flipped, x(2.4), 0.5)).toBe(false);
    expect(dark(flipped, x(1.9), 0.5)).toBe(true);
    expect(dark(flipped, 2.4 + 0.5, 0.5)).toBe(true); // where the door was before the flip
    expect(polygons(flipped, INK.cut)).toEqual(polygons(picture(openingsRoom(), cutting(b, a, 1)), INK.cut));
  });
});

describe("an oblique cut", () => {
  const free = (): Document => wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 });

  it("gives the wider interval", () => {
    const s = cutting({ x: 2, y: -1 }, { x: 4, y: 1 });
    const p = picture(free(), s);
    const middle = Math.SQRT2; // the wall's centre line, at (3, 0)
    const half = 0.1 * Math.SQRT2;
    expect(dark(p, middle, 1)).toBe(true);
    expect(dark(p, middle + half - 0.005, 1)).toBe(true);
    expect(dark(p, middle - half + 0.005, 1)).toBe(true);
    expect(dark(p, middle + half + 0.005, 1)).toBe(false);
    expect(dark(p, middle - half - 0.005, 1)).toBe(false);
  });

  it("across a door's jamb shows full wall on one side of it and the gap on the other", () => {
    const doc = ok(free(), { type: "addOpening", opId: "door", wall: Object.keys(free().walls)[0] ?? "", kind: "swing", offset: 2, width: 0.8 });
    // Through (2, 0), the jamb: y = −0.1 meets the wall at x 1.9, y = 0.1 at x 2.1.
    const p = picture(doc, cutting({ x: 1, y: -1 }, { x: 3, y: 1 }));
    const middle = Math.SQRT2;
    expect(dark(p, middle - 0.07, 1)).toBe(true);
    expect(dark(p, middle + 0.07, 1)).toBe(false);
    expect(dark(p, middle + 0.07, HEAD + 0.05)).toBe(true);
  });
});

describe("decks in section", () => {
  const room = (...cmds: Command[]): Document => ok(roomDoc(), { type: "setCeiling", height: 3 }, ...cmds);
  const across: Section = cutting({ x: 3, y: 0.5 }, { x: 3, y: 3.5 }); // x 0 is y 0.5

  it("a slab with a hole cuts in two", () => {
    const loft: Command = { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 }, w: 2, d: 2 };
    const solid = picture(room(loft), across);
    expect(dark(solid, 1.5, 2.1)).toBe(true);
    const holed = picture(room(loft, { type: "addDeckHole", opId: "h", deck: "l/k0", at: { x: 3, y: 2 }, w: 1, d: 1 }), across);
    expect(dark(holed, 1.5, 2.1)).toBe(false); // the hole, y 1.5 to 2.5
    expect(dark(holed, 0.75, 2.1)).toBe(true);
    expect(dark(holed, 2.25, 2.1)).toBe(true);
    const floating = polygons(holed, INK.cut).filter((q) => Math.min(...zsOf(q)) > 1);
    expect(polygons(solid, INK.cut).filter((q) => Math.min(...zsOf(q)) > 1 && Math.max(...zsOf(q)) < 3)).toHaveLength(1);
    expect(floating.filter((q) => Math.max(...zsOf(q)) < 3)).toHaveLength(2);
  });

  it("a hollow deck cuts as its slab", () => {
    const p = picture(room({ type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 }, w: 2, d: 2, top: 2.15 }), across);
    expect(dark(p, 1.5, 2.1)).toBe(true); // the 0.12 m slab under its top
    expect(dark(p, 1.5, 2.2)).toBe(false);
    expect(dark(p, 1.5, 2)).toBe(false);
    expect(dark(p, 1.5, 1)).toBe(false);
  });

  it("a solid deck cuts as its whole height", () => {
    const p = picture(room({ type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 }, w: 2, d: 2 }), across);
    expect(dark(p, 1.5, 0.05)).toBe(true);
    expect(dark(p, 1.5, 0.4)).toBe(true);
    expect(dark(p, 1.5, 0.5)).toBe(false);
  });
});

describe("furniture in section", () => {
  const place = (opId: string, kind: string, x: number, y: number, state = "s0", rotation = 0): Command => ({ type: "placeObject", linked: false, deck: null, opId, state, object: { kind }, at: { x, y }, rotation });
  /** Crosses the corner desk's two arms with its empty quarter between them. Its legs stay clear of the line. */
  const twice: Section = cutting({ x: 2, y: 0.77 }, { x: 4, y: 1.57 });
  const desk = (): Document => ok(roomDoc(), place("c", "cornerDesk", 3, 2));

  it("an L piece cut twice gives two grey shapes", () => {
    const p = picture(desk(), twice);
    const shapes = polygons(p, INK.furniture);
    expect(shapes).toHaveLength(2);
    for (const q of shapes) {
      expect(Math.min(...zsOf(q))).toBeCloseTo(0.72, 9);
      expect(Math.max(...zsOf(q))).toBeCloseTo(0.75, 9);
    }
    const stretch = (world: number): number => (world - 2) * Math.hypot(1, 0.4);
    const spans = shapes.map((q) => [Math.min(...xsOf(q)), Math.max(...xsOf(q))]).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(spans[0]?.[0]).toBeCloseTo(stretch(2.2), 9);
    expect(spans[0]?.[1]).toBeCloseTo(stretch(2.8), 9);
    expect(spans[1]?.[0]).toBeCloseTo(stretch(3.575), 9);
    expect(spans[1]?.[1]).toBeCloseTo(stretch(3.8), 9);
  });

  const ell: readonly Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 0, y: 2 }];

  it("a line crossing an L's arms and its empty quarter gives two intervals", () => {
    const got = lineInside(sectionFrame(cutting({ x: 0.5, y: 0.5 }, { x: 2.5, y: 0.9 })), [ell]);
    expect(got).toHaveLength(1); // only the first arm before it leaves
    const twoArms = lineInside(sectionFrame(cutting({ x: 0.5, y: 0.5 }, { x: 2.5, y: 1.5 })), [ell]);
    expect(twoArms).toHaveLength(2);
    expect(twoArms[0]?.[0]).toBeCloseTo(0, 9);
    expect(twoArms[1]?.[1]).toBeCloseTo(Math.hypot(2, 1), 9); // both ends of the line lie inside it
  });

  it("a line through an L's inner corner, inside on both sides of it, gives one interval", () => {
    const got = lineInside(sectionFrame(cutting({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 })), [ell]);
    expect(got).toHaveLength(1);
  });

  it("a part draws its outline in the style's line", () => {
    const p = picture(ok(roomDoc(), place("b", "block", 3, 2)), cutting({ x: 3, y: 0.5 }, { x: 3, y: 3.5 }));
    expect(polygons(p, INK.furniture)).toHaveLength(1);
    const lines = p.primitives.filter((q) => q.kind === "segment" && q.color === INK.furnitureLine);
    expect(lines).toHaveLength(4);
    expect(lines.every((q) => q.kind === "segment" && "px" in q.width && q.width.px === INK.furnitureWidth)).toBe(true);
  });

  it("a plane on a piece's face cuts nothing", () => {
    // Placed by its back edge's middle: the block's back face lies on y 2.
    const doc = ok(roomDoc(), place("b", "block", 3, 2));
    for (const side of [1, -1] as const) expect(polygons(picture(doc, cutting({ x: 1, y: 2 }, { x: 5, y: 2 }, side)), INK.furniture)).toHaveLength(0);
  });

  it("a section shows the layout it's asked for", () => {
    const doc = ok(roomDoc(), place("b", "block", 3, 2), { type: "addState", opId: "n", name: "Night" });
    const across = cutting({ x: 3, y: 0.5 }, { x: 3, y: 3.5 });
    expect(polygons(picture(doc, across, "s0"), INK.furniture)).toHaveLength(1);
    expect(polygons(picture(doc, across, "n/s0"), INK.furniture)).toHaveLength(0);
  });

  it("a stair the plane passes through makes no cut", () => {
    const doc = ok(roomDoc(), { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 }, place("s", "storageStair", 1.9, 2, "s0", 90));
    const s = cutting({ x: 3, y: 1 }, { x: 3, y: 3 });
    const stair = view3dItems(doc, "s0", null, new Set(), false).find((i) => i.item === "piece");
    expect(stair?.item === "piece" && lineInside(sectionFrame(s), [stair.ring]).length).toBe(1);
    expect(polygons(picture(doc, s), INK.furniture)).toHaveLength(0);
  });
});

describe("half walls", () => {
  /** A 7 × 2.5 shell under a 3.05 ceiling, a partition at x 1.5 across it, 2.03 tall, a T at each end. */
  function partitioned(): Document {
    const shell = ok(roomDoc(), { type: "setCeiling", height: 3.05 }, { type: "addWall", opId: "part", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 4 } } });
    return ok(shell, { type: "setWallTop", wallId: wallBetween(shell, { x: 1.5, y: 0 }, { x: 1.5, y: 4 }), top: 2.03 });
  }
  /** Along the partition's centre line, from y 1 into the north wall; x is y − 1. */
  const along: Section = cutting({ x: 1.5, y: 1 }, { x: 1.5, y: 5 });

  it("a half wall stops at its top", () => {
    const p = picture(partitioned(), along);
    expect(dark(p, 1, 2)).toBe(true);
    expect(dark(p, 1, 2.1)).toBe(false);
  });

  it("with its cap: the joint's share above it stays wall, so the taller wall shows no notch", () => {
    const p = picture(partitioned(), along);
    // The partition's share of the T joint runs from the north wall's face at y 3.9 to the joint at y 4: x 2.9 to 3.
    expect(dark(p, 2.85, 2.5)).toBe(false);
    expect(dark(p, 2.95, 2.5)).toBe(true);
    expect(dark(p, 3.05, 2.5)).toBe(true);
    expect(polygons(p, INK.cut)).toHaveLength(1);
  });
});

describe("the floor's and ceiling's bands", () => {
  const CEILING = 2.5;
  const inRoom = cutting({ x: 1, y: 2 }, { x: 4, y: 2 });

  it("the floor's band lies wholly below 0.00", () => {
    const p = picture(roomDoc(), inRoom);
    expect(dark(p, 1.5, -0.05)).toBe(true);
    expect(dark(p, 1.5, -0.095)).toBe(true);
    expect(dark(p, 1.5, 0.005)).toBe(false);
    expect(dark(p, 1.5, -0.105)).toBe(false);
  });

  it("the ceiling's wholly above the ceiling height", () => {
    const p = picture(roomDoc(), inRoom);
    expect(dark(p, 1.5, CEILING + 0.05)).toBe(true);
    expect(dark(p, 1.5, CEILING + 0.095)).toBe(true);
    expect(dark(p, 1.5, CEILING - 0.005)).toBe(false);
    expect(dark(p, 1.5, CEILING + 0.105)).toBe(false);
  });

  it("no height label moves with them", () => {
    const p = picture(roomDoc(), inRoom);
    const lines = heightLines(p);
    expect(lines.map((l) => l.a.y)).toEqual([0, CEILING]);
    expect(lines.every((l) => l.a.y === l.b.y)).toBe(true);
    expect(texts(p).map((t) => t.at.y)).toEqual([0, CEILING]);
  });
});

describe("the heights at the side", () => {
  const deck = (opId: string, preset: "loft" | "platform", x: number, y: number, top?: number): Command => ({ type: "addDeck", opId, preset, at: { x, y }, w: 1, d: 1, ...(top === undefined ? {} : { top }) });
  const values = (p: SectionPicture): string[] => texts(p).map((t) => t.text);
  /** At y 2 looking north, from x 1 to x 4. */
  const line = (depth: number | null = null, side: 1 | -1 = 1): Section => cutting({ x: 1, y: 2 }, { x: 4, y: 2 }, side, depth);

  it("label the floor and the ceiling", () => {
    expect(values(picture(roomDoc(), line()))).toEqual(["±0.00", "+2.50"]);
  });

  it("and each deck top the section sees: one the plane passes through, one beyond it", () => {
    const doc = ok(roomDoc(), deck("a", "platform", 2, 2), deck("b", "loft", 3, 3));
    expect(values(picture(doc, line()))).toEqual(["±0.00", "+0.45", "+2.15", "+2.50"]);
  });

  it("not a deck off the line, past an end of it", () => {
    expect(values(picture(ok(roomDoc(), deck("a", "platform", 5, 3)), line()))).toEqual(["±0.00", "+2.50"]);
  });

  it("not a deck behind the line, on the side it doesn't look at", () => {
    const doc = ok(roomDoc(), deck("a", "platform", 2, 1));
    expect(values(picture(doc, line()))).toEqual(["±0.00", "+2.50"]);
    expect(values(picture(doc, line(null, -1)))).toEqual(["±0.00", "+0.45", "+2.50"]);
  });

  it("not a deck past the depth; a deck within it, or that it crosses, still counts", () => {
    const doc = ok(roomDoc(), deck("a", "platform", 2, 3.2));
    expect(values(picture(doc, line(0.5)))).toEqual(["±0.00", "+2.50"]);
    expect(values(picture(doc, line(0.8)))).toEqual(["±0.00", "+0.45", "+2.50"]);
  });

  it("Zero sees only what the plane passes through", () => {
    const doc = ok(roomDoc(), deck("a", "platform", 2, 2), deck("b", "loft", 3, 3));
    expect(values(picture(doc, line(0)))).toEqual(["±0.00", "+0.45", "+2.50"]);
  });

  it("Zero through a slab's hole sees no deck top; a depth still sees the slab around it", () => {
    const doc = ok(roomDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 }, w: 2, d: 2 }, { type: "addDeckHole", opId: "h", deck: "l/k0", at: { x: 3, y: 2 }, w: 1, d: 1 });
    const inHole = cutting({ x: 2.8, y: 2 }, { x: 3.2, y: 2 });
    expect(values(picture(doc, { ...inHole, depth: 0 }))).toEqual(["±0.00", "+2.50"]);
    expect(values(picture(doc, { ...inHole, depth: 1 }))).toEqual(["±0.00", "+2.15", "+2.50"]);
  });

  it("two decks at one height make one label", () => {
    const doc = ok(roomDoc(), deck("a", "platform", 2, 3), deck("b", "platform", 3, 3));
    expect(values(picture(doc, line()))).toEqual(["±0.00", "+0.45", "+2.50"]);
  });

  it("values too close for their text stack, while their lines stay at the real height", () => {
    const doc = ok(roomDoc(), deck("a", "platform", 2, 3, 0.5), deck("b", "platform", 3, 3, 0.55));
    const zoom = 70;
    const p = picture(doc, line(), "s0", CANVAS_STYLE, zoom);
    expect(heightLines(p).map((l) => l.a.y)).toEqual([0, 0.5, 0.55, 2.5]);
    const [, low, high] = texts(p);
    expect(low?.at.y).toBe(0.5);
    expect((high?.at.y ?? 0) - (low?.at.y ?? 0)).toBeGreaterThanOrEqual(INK.heightSize / zoom);
  });

  it("sit past the line's right-hand end, whichever way it looks", () => {
    for (const s of [line(), line(null, -1)]) {
      const p = picture(roomDoc(), s);
      expect(heightLines(p).every((l) => Math.min(l.a.x, l.b.x) > 3)).toBe(true);
      expect(heightLines(p)).toHaveLength(2);
    }
  });
});

describe("the ends of the line", () => {
  it("clip the picture: a wall past an end draws no further", () => {
    const s = cutting({ x: 1, y: 4 }, { x: 3, y: 4 });
    const p = picture(roomDoc(), s);
    expect(dark(p, 0.05, 1)).toBe(true);
    expect(dark(p, 1.95, 1)).toBe(true);
    const shapes = polygons(p, INK.cut);
    expect(shapes.length).toBeGreaterThan(0);
    expect(Math.min(...shapes.flatMap(xsOf))).toBe(0);
    expect(Math.max(...shapes.flatMap(xsOf))).toBeCloseTo(2, 9);
  });

  it("clip an opening and its pane that cross an end", () => {
    const p = picture(openingsRoom(), cutting({ x: 3, y: 4 }, { x: 4, y: 4 }));
    const panes = polygons(p, INK.pane);
    expect(panes).toHaveLength(1);
    expect(Math.min(...panes.flatMap(xsOf))).toBeCloseTo(0.5, 9);
    expect(Math.max(...panes.flatMap(xsOf))).toBeCloseTo(1, 9);
    expect(Math.max(...p.primitives.flatMap((q) => (q.kind === "segment" && q.color === INK.paneLine ? [q.a.x, q.b.x] : [])))).toBeCloseTo(1, 9);
    expect(dark(p, 0.95, 1.5)).toBe(false);
    expect(dark(p, 0.25, 1.5)).toBe(true);
  });

  it("an end exactly on a window's jamb leaves no pane", () => {
    expect(polygons(picture(openingsRoom(), cutting({ x: 3, y: 4 }, { x: 3.5, y: 4 })), INK.pane)).toHaveLength(0);
  });

  it("clip furniture that crosses an end", () => {
    const doc = ok(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 3, y: 2 } });
    const whole = polygons(picture(doc, cutting({ x: 1, y: 1.8 }, { x: 5, y: 1.8 })), INK.furniture);
    const cut = polygons(picture(doc, cutting({ x: 3, y: 1.8 }, { x: 5, y: 1.8 })), INK.furniture);
    expect(whole).toHaveLength(1);
    expect(cut).toHaveLength(1);
    expect(Math.min(...whole.flatMap(xsOf))).toBeGreaterThan(0);
    expect(Math.min(...cut.flatMap(xsOf))).toBe(0);
  });
});

describe("float noise", () => {
  // The next double above 3.9: a line snapped by arithmetic can land here, inside the wall by 4e-16.
  const NOISY = 3.9000000000000004;

  it("a cut exactly on a wall's face and through a joint gives no sliver", () => {
    expect(NOISY).toBeGreaterThan(3.9);
    for (const y of [3.9, NOISY]) {
      const p = picture(roomDoc(), cutting({ x: -0.5, y }, { x: 6.5, y }));
      expect(dark(p, 3.5, 1)).toBe(false); // the north wall's face: the plane doesn't pass through it
      expect(dark(p, 0.5, 1)).toBe(true); // the west wall it crosses, x −0.1 to 0.1
      expect(dark(p, 6.5, 1)).toBe(true);
      expect(dark(p, 0.65, 1)).toBe(false);
    }
  });

  it("a plane on a wall's face cuts no window in it", () => {
    for (const side of [1, -1] as const) expect(polygons(picture(openingsRoom(), cutting({ x: -0.5, y: 3.9 }, { x: 6.5, y: 3.9 }, side)), INK.pane)).toHaveLength(0);
  });

  it("the same line a millimetre into the wall cuts it", () => {
    const p = picture(roomDoc(), cutting({ x: -0.5, y: 3.901 }, { x: 6.5, y: 3.901 }));
    expect(dark(p, 3.5, 1)).toBe(true);
  });

  it("a line touching a ring at one vertex leaves no sliver", () => {
    const got = lineInside(sectionFrame(cutting({ x: -1, y: 4 }, { x: 1, y: 4 })), [[{ x: -0.1, y: 4.1 }, { x: 0, y: 4 }, { x: 0.1, y: 4.1 }]]);
    expect(got).toEqual([]);
  });

  it("a plane on the line where two walls meet cuts them both: no slit between them", () => {
    const doc = ok(wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 }), { type: "addWall", opId: "w2", from: { at: { x: 3, y: 0 } }, to: { at: { x: 6, y: 0 } } });
    const p = picture(doc, cutting({ x: 3, y: -1 }, { x: 3, y: 1 }));
    expect(dark(p, 1, 1)).toBe(true);
    expect(dark(p, 0.85, 1)).toBe(false);
    expect(polygons(p, INK.cut)).toHaveLength(1);
  });
});

describe("clipRing", () => {
  it("keeps the part on one side of a half plane, with the new corners on it", () => {
    const square: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(clipRing(square, (p) => 0.25 - p.x)).toEqual([{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 1 }, { x: 0, y: 1 }]);
    expect(clipRing(square, (p) => p.x + 1)).toEqual(square);
    expect(clipRing(square, (p) => -1 - p.x)).toEqual([]);
  });
});

describe("the picture's title and bounds", () => {
  it("the title is A–A and the layout, apart from the primitives", () => {
    const doc = ok(roomDoc(), { type: "addState", opId: "n", name: "Night" });
    const p = picture(doc, { ...cutting({ x: 1, y: 2 }, { x: 4, y: 2 }), id: "B" }, "n/s0");
    expect(p.title.text).toBe("B–B · Night");
    expect(p.primitives.some((q) => q.kind === "text" && q.text === p.title.text)).toBe(false);
  });

  it("the title sits above the ceiling's band", () => {
    const zoom = 70;
    const p = picture(roomDoc(), cutting({ x: 1, y: 2 }, { x: 4, y: 2 }), "s0", CANVAS_STYLE, zoom);
    expect(p.title.at.y - p.title.size / 2 / zoom).toBeGreaterThan(2.6);
  });

  it("sizes in drawing units keep their size on paper: the gaps scale with the zoom, the type doesn't", () => {
    const s = cutting({ x: 1, y: 2 }, { x: 4, y: 2 });
    const [wide, narrow] = [picture(roomDoc(), s, "s0", PRESENTATION_STYLE, 10), picture(roomDoc(), s, "s0", PRESENTATION_STYLE, 20)];
    expect(texts(wide)[0]?.size).toBe(texts(narrow)[0]?.size);
    const offset = (p: SectionPicture): number => (heightLines(p)[0]?.a.x ?? 0) - 3;
    expect(offset(wide)).toBeCloseTo(2 * offset(narrow), 9);
  });

  it("colours, widths and font come from the style", () => {
    const s = cutting({ x: 2.4, y: 3 }, { x: 2.4, y: 5 });
    const paper = picture(openingsRoom(), s, "s0", PRESENTATION_STYLE, 20);
    const { section } = PRESENTATION_STYLE;
    expect(polygons(paper, section.cut).length).toBeGreaterThan(0);
    expect(texts(paper).every((t) => t.font === PRESENTATION_STYLE.font && t.size === section.heightSize)).toBe(true);
    expect(texts(paper).length).toBeGreaterThan(0);
    expect(paper.title.font).toBe(PRESENTATION_STYLE.font);
    expect(paper.title.size).toBe(section.titleSize);
    const canvas = picture(openingsRoom(), s, "s0", LOOK_STYLE, 70);
    expect(texts(canvas).every((t) => t.size === LOOK_STYLE.section.heightSize)).toBe(true);
  });

  it("the bounds hold the picture, on screen and on paper at 1:100, whatever the layout", () => {
    const doc = ok(roomDoc(), { type: "setCeiling", height: 3.05 }, { type: "addDeck", opId: "l", preset: "loft", at: { x: 2, y: 3 }, w: 1, d: 1 });
    const s = cutting({ x: 1, y: 2 }, { x: 4, y: 2 });
    const b = sectionBounds(doc, s);
    expect(b.min.x).toBeLessThanOrEqual(0);
    expect(b.min.y).toBeLessThan(-0.1);
    expect(b.max.y).toBeGreaterThan(ceilingHeight(doc) + 0.1);
    for (const [style, zoom] of [[CANVAS_STYLE, 70], [LOOK_STYLE, 70], [PRESENTATION_STYLE, 10]] as const) {
      const p = sectionPicture(doc, s, "s0", style, zoom);
      for (const q of p.primitives) {
        if (q.kind === "polygon") for (const r of q.points) expect(r.x <= b.max.x && r.y <= b.max.y && r.x >= b.min.x && r.y >= b.min.y).toBe(true);
        if (q.kind === "text") expect(q.at.x + textWidth(q.font, q.text, q.size) / zoom).toBeLessThanOrEqual(b.max.x);
      }
      expect(texts(p).length).toBe(3);
      expect(p.title.at.y).toBeGreaterThan(ceilingHeight(doc) + 0.1); // above the ceiling's band: apart, and not in the bounds, as a sheet leaves it out
    }
  });

  it("the bounds follow the ceiling and the line's length, nothing else in the drawing", () => {
    const s = cutting({ x: 1, y: 2 }, { x: 4, y: 2 });
    const base = sectionBounds(roomDoc(), s);
    expect(sectionBounds(ok(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 3, y: 2 } }), s)).toEqual(base);
    expect(sectionBounds(ok(roomDoc(), { type: "setCeiling", height: 3 }), s).max.y).toBeCloseTo(base.max.y + 0.5, 9);
    expect(sectionBounds(roomDoc(), cutting({ x: 1, y: 2 }, { x: 5, y: 2 })).max.x).toBeCloseTo(base.max.x + 1, 9);
    expect(sectionBounds(roomDoc(), cutting({ x: 4, y: 2 }, { x: 1, y: 2 }, -1))).toEqual(base);
  });
});

// Surroundings draw only in 3D (AC-11): sections don't read the row. The other section tests' documents have none, so
// they can't see a section that does; this one has walls, a door, a window, a loft and a piece in the cut.
describe("a section with surroundings set", () => {
  const furnished = (...cmds: Command[]): Document =>
    ok(openingsRoom(), { type: "setCeiling", height: 3 }, { type: "addDeck", opId: "l", preset: "loft", at: { x: 2.4, y: 1.5 }, w: 2, d: 1.5 }, ...cmds);
  const piece: Command = { type: "placeObject", linked: false, deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 2.4, y: 3 } };
  const through = cutting({ x: 2.4, y: -0.5 }, { x: 2.4, y: 4.5 });
  const drawn = (doc: Document) => ({
    bounds: sectionBounds(doc, through),
    pictures: ([[CANVAS_STYLE, 70], [LOOK_STYLE, 70], [PRESENTATION_STYLE, 10]] as const).map(([style, zoom]) => sectionPicture(doc, through, "s0", style, zoom)),
  });

  it("a section is equal with and without the row", () => {
    const without = drawn(furnished(piece));
    expect(without.pictures[0]?.primitives.length).toBeGreaterThan(10);
    for (const { value } of SURROUNDINGS_VALUES) expect(drawn(furnished(piece, { type: "setProjectField", key: "surroundings", value })), value).toEqual(without);
  });

  it("this comparison sees the drawing: the piece in the cut changes it", () => {
    expect(drawn(furnished()).pictures).not.toEqual(drawn(furnished(piece)).pictures);
  });
});
