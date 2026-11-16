import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, spiralRails, type Command, type Document, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { newell } from "../../src/view3d/prism";
import { sectionPicture } from "../../src/view3d/section-picture";
import { stairFaces } from "../../src/view3d/stair-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, PieceItem, Point3 } from "../../src/view3d/types";
import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { withCommands } from "../builders";

// A spiral's rail and balustrade in 3D and in a section (AC-12), in the stair's own faces. The 7 × 3 room's loft is at x 0.1–3.6;
// the 1.60 spiral's back edge is on its edge at (3.6, 1.5), turned 90°: x 3.6–5.2, y 0.7–2.3, centre (4.4, 1.5). 10 risers of
// 0.215, 9 treads of 30°, the first (low) at world 60–90°, the last at 180–210°; its landing x 3.6–4.4, y 1.5–2.3, top 2.15.

const LOFT = "loft/k0";
const C: Point = { x: 4.4, y: 1.5 };
const RISER = 0.215;
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 3, "st"), { type: "setCeiling", height: 3.4 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.5 }, w: 3.5, d: 2.8 },
  ...more,
);
const place: Command = { type: "placeObject", opId: "s", state: "s0", object: { kind: "spiralStair" }, at: { x: 3.6, y: 1.5 }, rotation: 90, deck: null, reaches: LOFT };
const pieceOf = (doc: Document, selected: readonly string[] = []): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(selected), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  return item;
};
/** The faces a piece's rails add, at the end of its list. */
const railFaces = (item: PieceItem): Face3d[] => {
  const bare = { ...item };
  delete bare.spiralRails;
  const all = stairFaces("o", item, STYLE_3D.stair, STYLE_3D.glass) ?? [];
  const body = stairFaces("o", bare, STYLE_3D.stair, STYLE_3D.glass) ?? [];
  return all.slice(body.length);
};
const dist = (p: Point): number => Math.hypot(p.x - C.x, p.y - C.y);
/** A world angle in degrees, 0 to 360. */
const angleOf = (p: Point): number => ((Math.atan2(p.y - C.y, p.x - C.x) * 180) / Math.PI + 360) % 360;
/** A balustrade's point: on its circle, within its thickness. */
const onCircle = (p: Point): boolean => Math.abs(dist(p) - 0.78) <= 0.05;
const onRight = (p: Point): boolean => Math.abs(p.y - 2.28) <= 0.021 && p.x >= 3.6 - 1e-6 && p.x <= 4.4 + 1e-6;
const onFront = (p: Point): boolean => Math.abs(p.x - 4.38) <= 0.021 && p.y >= 1.5 - 1e-6 && p.y <= 2.3 + 1e-6;
/** The balustrade's faces: those wholly on its circle and off the landing's rails. */
const balustrade = (faces: readonly Face3d[]): Face3d[] => faces.filter((f) => f.points.every(onCircle) && f.points.some((p) => !onRight(p) && !onFront(p)));
/** How high the rail's line is `a` degrees on from the first tread's low end, at world 90°. */
const lineAt = (a: number): number => RISER + 0.9 + ((2.15 - RISER) * a) / 270;

describe("the landing's rail in 3D", () => {
  it("is on its two open sides, on posts, 0.90 above it", () => {
    const faces = railFaces(pieceOf(room(place))).filter((f) => f.points.every((p) => p.z >= 2.15 - 1e-6));
    const points = faces.flatMap((f) => f.points);
    expect(points.some(onRight)).toBe(true);
    expect(points.some(onFront)).toBe(true);
    expect(Math.max(...points.map((p) => p.z))).toBeCloseTo(3.05, 6);
    expect(Math.min(...points.map((p) => p.z))).toBeCloseTo(2.15, 6); // the posts stand on it
  });

  it("the way off stays open: nothing stands in the last tread's end, or the deck's edge", () => {
    const up = railFaces(pieceOf(room(place))).flatMap((f) => f.points).filter((p) => p.z > 2.15 + 1e-6);
    // Off the last tread: the line y 1.5, x 3.6–4.3, past the column. Onto the deck: the line x 3.6, y 1.5–2.28.
    const offTread = up.filter((p) => p.x > 3.65 && p.x < 4.3 && Math.abs(p.y - 1.5) < 0.03);
    expect(offTread).toEqual([]);
    const ontoDeck = up.filter((p) => p.x < 3.65 && p.y > 1.6 && p.y < 2.24);
    expect(ontoDeck).toEqual([]);
  });

  it("a side against a wall has none", () => {
    const wall: Command = { type: "addWall", opId: "wr", from: { at: { x: 3.6, y: 2.4 } }, to: { at: { x: 5.6, y: 2.4 } } };
    const points = railFaces(pieceOf(room(wall, place))).flatMap((f) => f.points).filter((p) => p.z > 2.15 + 1e-6 && !onCircle(p));
    expect(points.some((p) => onRight(p) && p.x < 4.3)).toBe(false);
    expect(points.some(onFront)).toBe(true);
  });

  it("stops at the ceiling", () => {
    const points = railFaces(pieceOf(room({ type: "setCeiling", height: 2.6 }, place))).flatMap((f) => f.points);
    expect(Math.max(...points.map((p) => p.z))).toBeCloseTo(2.6, 6);
  });
});

describe("the balustrade in 3D", () => {
  const doc = room(place);
  const item = pieceOf(doc);
  const faces = balustrade(railFaces(item));
  const points = faces.flatMap((f) => f.points);

  it("goes round the treads' outer edge, from the first tread's low end to the last's high end", () => {
    expect(faces.length).toBeGreaterThan(0);
    const angles = points.map(angleOf);
    // World 90° to 180° (the landing's quarter) has none of it: it goes the long way round.
    expect(angles.filter((a) => a > 95 && a < 175)).toEqual([]);
    expect(angles.some((a) => a > 180 && a < 200)).toBe(true);
    expect(angles.some((a) => a > 60 && a < 90)).toBe(true);
  });

  it("rises with the treads: its top on the line at every point", () => {
    const tops = railFaces(item).filter((f) => f.points.every((p) => dist(p) > 0.74) && f.points.every((p) => angleOf(p) > 182 || angleOf(p) < 88));
    let seen = 0;
    for (const f of tops) {
      for (const p of f.points) {
        const a = (((90 - angleOf(p)) % 360) + 360) % 360; // degrees clockwise from world 90°, the first tread's low end
        expect(p.z).toBeLessThanOrEqual(lineAt(a) + 0.02);
        if (Math.abs(p.z - lineAt(a)) < 0.01) seen++;
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it("is short straight segments no longer than the treads' own arcs", () => {
    const spans = railFaces(item).filter((f) => f.points.every((p) => dist(p) > 0.74 && dist(p) < 0.82)).map((f) => Math.max(...f.points.map((p) => Math.hypot(p.x - (f.points[0]?.x ?? 0), p.y - (f.points[0]?.y ?? 0)))));
    expect(Math.max(...spans)).toBeLessThan(0.78 * ((7.5 * Math.PI) / 180) + 0.06);
  });

  it("stands on a post on each tread, each reaching down to that tread's top", () => {
    // A post's foot is the lowest point of its faces: find them by height.
    const turned = (p: Point3): number => Math.max(0, ((((91 - angleOf(p)) % 360) + 360) % 360) - 1); // a rail's end runs a little past world 90°
    const onRail = (p: Point3): boolean => Math.abs(p.z - (lineAt(turned(p)) - 0.04)) < 0.03;
    const low = balustrade(railFaces(item)).flatMap((f) => f.points).filter((p) => !onRail(p));
    for (let k = 1; k <= 9; k++) {
      const [from, to] = [(180 + (9 - k) * 30) % 360, (180 + (10 - k) * 30) % 360 || 360];
      const hereAt = low.filter((p) => Math.abs(p.z - k * RISER) < 1e-6);
      expect(hereAt.length, `tread ${k}`).toBeGreaterThan(0);
      for (const p of hereAt) {
        const a = angleOf(p);
        const within = from < to ? a >= from - 3 && a <= to + 3 : a >= from - 3 || a <= to + 3;
        expect(within, `tread ${k}: ${a}`).toBe(true);
      }
    }
    expect(Math.min(...low.map((p) => p.z))).toBeCloseTo(RISER, 6);
  });

  it("a post runs up into the rail and no further", () => {
    for (const p of railFaces(item).flatMap((f) => f.points)) expect(p.z).toBeLessThanOrEqual(3.05 + 1e-6);
  });

  it("stops at the ceiling, bending where it meets it", () => {
    const low = room({ type: "setCeiling", height: 2.5 }, place);
    const all = railFaces(pieceOf(low)).flatMap((f) => f.points);
    expect(Math.max(...all.map((p) => p.z))).toBeCloseTo(2.5, 6);
    const [, bend] = spiralRails(low).values().next().value?.knots ?? [];
    expect(bend?.top).toBeCloseTo(2.5, 6);
    expect(all.some((p) => p.z < 2.5 - 0.05 && onCircle(p) && p.z > lineAt(0) - 0.1)).toBe(true);
  });

  it("isn't over a wall either: a wall beside the treads leaves it", () => {
    const wall: Command = { type: "addWall", opId: "wl", from: { at: { x: 3.6, y: 0.6 } }, to: { at: { x: 5.6, y: 0.6 } } };
    expect(balustrade(railFaces(pieceOf(room(wall, place)))).length).toBe(faces.length);
  });
});

describe("whatever its turn", () => {
  it.each([
    { at: { x: 5, y: 3 }, rotation: 90, back: { x: -1, y: 0 } },
    { at: { x: 4, y: 4 }, rotation: 180, back: { x: 0, y: -1 } },
    { at: { x: 3, y: 3 }, rotation: 270, back: { x: 1, y: 0 } },
    { at: { x: 4, y: 2 }, rotation: 0, back: { x: 0, y: 1 } },
  ])("turned to $rotation, its rails stay in its box and its back side's free", ({ at, rotation, back }) => {
    const doc = withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 9, 7, "c"), { type: "setCeiling", height: 3.4 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 4, y: 3 }, w: 2, d: 2 },
      { type: "placeStair", opId: "ps", state: "s0", kind: "spiralStair", surface: null, deck: "l/k0", at, shape: "straight" },
    );
    const item = pieceOf(doc);
    expect(item.rotation % 360).toBe(rotation);
    const centre = { x: at.x - back.x * 0.8, y: at.y - back.y * 0.8 };
    const right = { x: back.y, y: -back.x };
    const frame = (p: Point) => ({ x: (p.x - centre.x) * right.x + (p.y - centre.y) * right.y, y: (p.x - centre.x) * back.x + (p.y - centre.y) * back.y });
    const points = railFaces(item).flatMap((f) => f.points).map(frame);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.8 + 1e-6);
    }
    // In the landing's quarter, past the column, nothing but its right rail and its front rail.
    const inQuarter = points.filter((p) => p.x > 0.1 && p.y > 0.1);
    expect(inQuarter.length).toBeGreaterThan(0);
    for (const p of inQuarter) expect(p.x > 0.74 - 1e-6 || p.y < 0.04 + 1e-6).toBe(true);
  });
});

describe("its faces", () => {
  it("are wound from outside: tops up, and every face a real one", () => {
    const faces = railFaces(pieceOf(room(place)));
    const zs = (f: Face3d): number[] => f.points.map((p) => p.z);
    const horizontal = faces.filter((f) => Math.abs(newell(f.points).x) < 1e-9 && Math.abs(newell(f.points).y) < 1e-9);
    expect(horizontal.length).toBeGreaterThan(0);
    for (const f of horizontal) expect(newell(f.points).z).toBeGreaterThan(0);
    for (const f of faces) {
      const n: Point3 = newell(f.points);
      expect(Math.hypot(n.x, n.y, n.z), JSON.stringify(zs(f))).toBeGreaterThan(1e-9);
    }
  });

  it("are the stair's owner's, in its colours, selected with it", () => {
    const doc = room(place);
    const item = pieceOf(doc);
    expect(new Set(faces3d(item).map((f) => f.owner)).size).toBe(1);
    const picked = pieceOf(doc, Object.keys(doc.placements));
    const colours = new Set(faces3d(picked).filter((f) => f.points.every((p) => p.z > 2.2)).map((f) => f.color));
    for (const c of colours) expect([STYLE_3D.selected.top, STYLE_3D.selected.lit, STYLE_3D.selected.shaded]).toContain(c);
    expect(colours.size).toBeGreaterThan(0);
  });

  it("the plan and 3D read one list", () => {
    const doc = room(place);
    const item = pieceOf(doc);
    expect(item.spiralRails).toEqual(spiralRails(doc).get(item.object));
  });

  it("a flight has none of them", () => {
    const flight: Command = { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 3.6, y: 1.5 }, shape: "straight" };
    expect(pieceOf(room(flight)).spiralRails).toBeUndefined();
  });
});

describe("in a section", () => {
  type Polygon = Extract<Primitive, { kind: "polygon" }>;
  const INK = CANVAS_STYLE.section;
  const picture = (doc: Document, s: Section): readonly Primitive[] => sectionPicture(doc, s, "s0", CANVAS_STYLE, 70).primitives;
  // A line south of the stair looking north, past it all: x along the line from x 1, so the box is x' 2.6–4.2.
  const facing: Section = { id: "A", a: { x: 1, y: 0.5 }, b: { x: 6.5, y: 0.5 }, side: 1, depth: 2.2 };
  const polygons = (ps: readonly Primitive[]): Polygon[] => ps.filter((p): p is Polygon => p.kind === "polygon");
  /** What lies past the line above the stair's 2.15 top, over its box, under the loft's guard and the room's walls. */
  const overStair = (ps: readonly Primitive[]): Polygon[] => polygons(ps).filter((p) => {
    const top = Math.max(...p.points.map((q) => q.y));
    return p.points.every((q) => q.x >= 2.55 && q.x <= 4.25) && top > 2.2 && top < 3.1; // the loft's own guard reaches 3.15
  });

  it("past the line, they're in the picture by themselves, as white shapes up to the rail's top", () => {
    const rails = overStair(picture(room(place), facing));
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.every((p) => p.color === INK.beyond)).toBe(true);
    expect(Math.max(...rails.flatMap((p) => p.points.map((q) => q.y)))).toBeCloseTo(3.05, 2);
  });

  it("the balustrade rises in the picture, low at the first tread", () => {
    const low = polygons(picture(room(place), facing)).filter((p) => p.color === INK.beyond && p.points.every((q) => q.x >= 2.55 && q.x <= 4.25));
    const heights = low.flatMap((p) => p.points.map((q) => q.y));
    expect(heights.some((y) => Math.abs(y - (RISER + 0.9)) < 0.05)).toBe(true);
  });

  it("not there looking the other way", () => {
    expect(overStair(picture(room(place), { ...facing, side: -1, depth: 0.3 }))).toEqual([]);
  });

  it("a line crossing them draws no cut shape, only what's past it", () => {
    const across: Section = { id: "A", a: { x: 1, y: 1.9 }, b: { x: 6.5, y: 1.9 }, side: 1, depth: null };
    const ps = picture(room(place), across);
    const cutUp = polygons(ps).filter((p) => p.color === INK.cut && p.points.every((q) => q.x >= 2.55 && q.x <= 4.25 && q.y > 2.2 && q.y < 3.2));
    expect(cutUp).toEqual([]);
    expect(overStair(ps).length).toBeGreaterThan(0);
  });
});
