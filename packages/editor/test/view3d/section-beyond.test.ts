import { describe, expect, it } from "vitest";
import { anchorAt, execute, OBJECT_KINDS, pointInPolygon, rectangleRoom, stairRuleOf, unwrap, emptyDocument, motifDefaults, type Command, type Document, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { view3dItems } from "../../src/view3d/items";
import { sectionBeyond } from "../../src/view3d/section-beyond";
import { sectionFrame } from "../../src/view3d/section-cut";
import { sectionPicture, type SectionPicture } from "../../src/view3d/section-picture";
import { roomDoc, wallBetween, withCommands } from "../builders";

// What lies past a section's plane (AC-05, AC-07). Each rule is read back as the picture: at this point, which shape was
// drawn last, known by its extent and fill, as a viewer would see it.

const INK = CANVAS_STYLE.section;
const ok = withCommands;
type Polygon = Extract<Primitive, { kind: "polygon" }>;
const cutting = (a: Point, b: Point, side: 1 | -1 = 1, depth: number | null = null): Section => ({ id: "A", a, b, side, depth });
const picture = (doc: Document, s: Section, layout = "s0"): SectionPicture => sectionPicture(doc, s, layout, CANVAS_STYLE, 70);
const shapes = (p: SectionPicture): Polygon[] => p.primitives.flatMap((q) => (q.kind === "polygon" ? [q] : []));
const beyond = (p: SectionPicture): Polygon[] => shapes(p).filter((q) => q.color === INK.beyond);
const inkOf = (p: SectionPicture, color: string): Polygon[] => shapes(p).filter((q) => q.color === color);
/** The shape drawn last at (x, z). */
const topAt = (p: SectionPicture, x: number, z: number): Polygon | undefined =>
  shapes(p).filter((q) => [q.points, ...q.holes].filter((r) => pointInPolygon({ x, y: z }, r)).length % 2 === 1).at(-1);
const extent = (q: Polygon | undefined): number[] => {
  if (!q) return [];
  const [xs, zs] = [q.points.map((r) => r.x), q.points.map((r) => r.y)];
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
};
const expectExtent = (q: Polygon | undefined, want: readonly number[]): void => {
  const got = extent(q);
  expect(got).toHaveLength(4);
  want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 6));
};

/** A box, centred at (x, y): `w` along x, `d` along y, `h` tall. Sized after placing, so placed clear of the walls and moved. */
const block = (opId: string, x: number, y: number, w: number, d: number, h: number, rotation = 0): Command[] => [
  { type: "placeObject", linked: false, deck: null, opId, state: "s0", object: { kind: "block" }, at: { x: 4.5, y: 2.3 }, rotation: 0 },
  { type: "setObjectSize", objectId: `${opId}/o0`, w, d: { standard: d }, h: { standard: h } },
  { type: "movePlacement", placementId: `${opId}/p0`, at: anchorAt({ x, y }, d, rotation), rotation },
];
/** The same on a deck, which it fits inside from the start. */
const blockOn = (opId: string, deck: string, x: number, y: number, w: number, d: number, h: number): Command[] => [
  { type: "placeObject", linked: false, deck, opId, state: "s0", object: { kind: "block" }, at: anchorAt({ x, y }, 0.6, 0), rotation: 0 },
  { type: "setObjectSize", objectId: `${opId}/o0`, w, d: { standard: d }, h: { standard: h } },
  { type: "movePlacement", placementId: `${opId}/p0`, at: anchorAt({ x, y }, d, 0), rotation: 0 },
];
/** A kind at its own size, by its centre, whose depth it's told. */
const piece = (opId: string, kind: string, x: number, y: number, d: number, rotation = 0, deck: string | null = null, preset?: string): Command =>
  ({ type: "placeObject", linked: false, deck, opId, state: "s0", object: { kind, ...(preset === undefined ? {} : { preset }) }, at: anchorAt({ x, y }, d, rotation), rotation });

/** Across the 6 × 4 room at y 0.5, looking north, x as on the plan. */
const lookingNorth = (depth: number | null = null): Section => cutting({ x: 0, y: 0.5 }, { x: 6, y: 0.5 }, 1, depth);
/** Across it at y 3.5, looking south: the same line flipped, so x mirrors. */
const lookingSouth = (depth: number | null = null): Section => cutting({ x: 0, y: 3.5 }, { x: 6, y: 3.5 }, -1, depth);

describe("what's nearer hides what's farther", () => {
  const small = (id: string): Command[] => block(id, 2, 1.5, 1, 0.5, 1); // near from the south: x 1.5–2.5, 1 m tall
  const big = (id: string): Command[] => block(id, 2.2, 3, 2, 0.5, 2); // far from the south: x 1.2–3.2, 2 m tall

  // Both orders of the commands and both ways the names sort: the doc's order, and the names, mustn't decide.
  for (const [label, cmds] of [
    ["small first, named first", [...small("a"), ...big("b")]],
    ["big first, named second", [...big("b"), ...small("a")]],
    ["small first, named second", [...small("b"), ...big("a")]],
    ["big first, named first", [...big("a"), ...small("b")]],
  ] as const) {
    it(`looking north the smaller piece is nearer: ${label}`, () => {
      const p = picture(ok(roomDoc(), ...cmds), lookingNorth());
      expectExtent(topAt(p, 2, 0.5), [1.5, 2.5, 0, 1]);
      expectExtent(topAt(p, 2, 1.5), [1.2, 3.2, 0, 2]);
      expectExtent(topAt(p, 3, 0.5), [1.2, 3.2, 0, 2]);
    });

    it(`flipped, looking south, the bigger one is, and x mirrors: ${label}`, () => {
      const p = picture(ok(roomDoc(), ...cmds), lookingSouth());
      expectExtent(topAt(p, 4, 0.5), [2.8, 4.8, 0, 2]);
      expectExtent(topAt(p, 3.5 + 0.1, 0.5), [2.8, 4.8, 0, 2]); // the small one lies wholly behind it
      expect(beyond(p).filter((q) => extent(q)[1] === 4.5)).toHaveLength(1); // and still draws
    });
  }

  it("draws white with an outline, four lines to each", () => {
    const p = picture(ok(roomDoc(), ...small("a")), cutting({ x: 1.6, y: 0.5 }, { x: 2.4, y: 0.5 }, 1, 2));
    const q = beyond(p);
    expect(q).toHaveLength(1);
    const lines = p.primitives.filter((r) => r.kind === "segment" && r.color === INK.beyondPart);
    expect(lines).toHaveLength(4);
    expect(lines.every((r) => r.kind === "segment" && "px" in r.width && r.width.px === INK.beyondPartWidth)).toBe(true);
  });

  it("all of it draws under the cut and its labels", () => {
    const p = picture(ok(roomDoc(), ...small("a")), lookingNorth());
    const kinds = p.primitives.map((q) => (q.kind === "polygon" && q.color === INK.beyond ? "beyond" : q.kind === "polygon" && q.color === INK.cut ? "cut" : q.kind === "text" ? "text" : ""));
    expect(kinds.lastIndexOf("beyond")).toBeLessThan(kinds.indexOf("cut"));
    expect(kinds.lastIndexOf("cut")).toBeLessThan(kinds.indexOf("text"));
    expect(kinds.indexOf("beyond")).toBeGreaterThan(-1);
  });
});

describe("a long wall and small pieces", () => {
  // A free wall from (0.5, 1) to (5.5, 3), in the room; seen from y 0: at x 1 it stands at y 1.2 and at x 5 at y 2.8.
  // The left piece is behind it, and its whole depth is nearer than the wall's middle (a wall's mean is y 2). The right
  // piece is in front of it, and its nearest is farther than the wall's nearest. So near, mean and far each get one wrong.
  const doc = (): Document => ok(
    roomDoc(),
    ...block("left", 1, 1.7, 0.4, 0.3, 1),
    ...block("right", 5, 1.7, 0.4, 0.3, 1),
    { type: "addWall", opId: "w", from: { at: { x: 0.5, y: 1 } }, to: { at: { x: 5.5, y: 3 } } },
  );
  const s = cutting({ x: 0, y: 0.2 }, { x: 6, y: 0.2 });

  it("the wall hides the piece behind it", () => {
    const top = topAt(picture(doc(), s), 1, 0.5);
    expect(top?.color).toBe(INK.beyond);
    expect(extent(top)[1]).toBeGreaterThan(5); // the wall, not the piece
  });

  it("the piece in front of the wall hides it", () => {
    expectExtent(topAt(picture(doc(), s), 5, 0.5), [4.8, 5.2, 0, 1]);
  });

  it("both pieces still draw", () => {
    const pieces = beyond(picture(doc(), s)).filter((q) => extent(q)[3] === 1);
    expect(pieces).toHaveLength(2);
  });
});

describe("a deck between them", () => {
  /** A solid platform at y 1.5–2.5, x 2–4, top 0.45, with a piece on it; a piece in front of it and one behind. */
  const doc = (): Document => ok(
    roomDoc(),
    ...block("in-front", 2.5, 1, 0.4, 0.4, 0.3),
    ...block("behind", 3, 3.2, 1.6, 0.4, 2),
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 }, w: 2, d: 1, top: 0.45 },
    ...blockOn("on", "p/k0", 3, 2, 0.5, 0.5, 0.5),
  );

  it("a piece in front of the deck hides it, and the deck hides one behind it", () => {
    const p = picture(doc(), lookingNorth());
    expectExtent(topAt(p, 2.5, 0.1), [2.3, 2.7, 0, 0.3]);
    expectExtent(topAt(p, 3, 0.4), [2, 4, 0, 0.45]);
    expectExtent(topAt(p, 2.5, 0.4), [2, 4, 0, 0.45]); // above the one in front
  });

  it("a piece on the deck hides what's behind the deck, above it", () => {
    const p = picture(doc(), lookingNorth());
    expectExtent(topAt(p, 3, 0.7), [2.75, 3.25, 0.45, 0.95]);
    expectExtent(topAt(p, 3.5, 0.7), [2.2, 3.8, 0, 2]);
  });

  it("flipped, the deck and what's on it lie behind the one that was far", () => {
    const p = picture(doc(), lookingSouth());
    expectExtent(topAt(p, 3, 0.7), [2.2, 3.8, 0, 2]);
    expectExtent(topAt(p, 3, 0.1), [2.2, 3.8, 0, 2]);
    expectExtent(topAt(p, 2.1, 0.1), [2, 4, 0, 0.45]); // past its end, the deck shows
  });

  it("draws in the pieces' line", () => {
    const alone = ok(roomDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 }, w: 2, d: 1, top: 0.45 });
    expect(picture(alone, lookingNorth()).primitives.filter((q) => q.kind === "segment" && q.color === INK.beyondPart && "px" in q.width && q.width.px === INK.beyondPartWidth)).toHaveLength(4);
  });

  it("a slab with a hole: what stands in the hole is in front of the hole's far side, behind its near side", () => {
    const holed = ok(
      roomDoc(),
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 }, w: 3, d: 3 },
      { type: "addDeckHole", opId: "h", deck: "l/k0", at: { x: 3, y: 2 }, w: 1.5, d: 1.5 },
      ...block("post", 3, 2, 0.4, 0.4, 1),
      { type: "setObjectSize", objectId: "post/o0", w: 0.4, d: { standard: 0.4 }, h: { standard: 2.2 } },
    );
    const heightOfSlab = 2.1;
    const fromBefore = picture(holed, cutting({ x: 0, y: 0.2 }, { x: 6, y: 0.2 }));
    expectExtent(topAt(fromBefore, 3, heightOfSlab), [1.5, 4.5, 2.03, 2.15]); // the slab's near side hides the post
    const inHole = picture(holed, cutting({ x: 2.4, y: 1.6 }, { x: 3.6, y: 1.6 }));
    expectExtent(topAt(inHole, 0.6, heightOfSlab), [0.4, 0.8, 0, 2.2]); // the post hides the hole's far side
  });
});

describe("what's cut stays on top of what's beyond", () => {
  it("a wall the plane passes through draws dark over its own part beyond", () => {
    const p = picture(roomDoc(), cutting({ x: 3, y: -1 }, { x: 3, y: 5 }));
    // Looking west from x 3, with the line from y −1 at x 0: the south wall stands at x 0.9–1.1 in the picture.
    expect(topAt(p, 2, 1)?.color).toBe(INK.beyond); // the far wall, past the room
    expect(topAt(p, 1, 1)?.color).toBe(INK.cut); // the south wall, cut, over its own part beyond
    expect(beyond(p).some((q) => (extent(q)[0] ?? 9) <= 0.9 && (extent(q)[1] ?? 0) >= 1.1 && extent(q)[1] !== 6)).toBe(true);
  });
});

describe("panels", () => {
  /** Its doors face −y at rotation 0, toward a view looking north. */
  const doc = (rotation: number): Document => ok(roomDoc(), piece("w", "wardrobe", 3, 2, 0.6, rotation));
  const panels = (p: SectionPicture): Primitive[] => p.primitives.filter((q) => q.kind === "segment" && q.color === INK.beyondPanel);

  it("draw on the side that faces the viewer", () => {
    expect(panels(picture(doc(0), lookingNorth())).length).toBeGreaterThan(0);
    expect(panels(picture(doc(0), lookingSouth())).length).toBe(0);
  });

  it("from the other side once it's turned", () => {
    expect(panels(picture(doc(180), lookingNorth())).length).toBe(0);
    expect(panels(picture(doc(180), lookingSouth())).length).toBeGreaterThan(0);
  });

  it("draw in their own line", () => {
    const lines = panels(picture(doc(0), lookingNorth()));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((q) => q.kind === "segment" && "px" in q.width && q.width.px === INK.beyondPanelWidth)).toBe(true);
  });

  it("not edge on", () => {
    expect(panels(picture(doc(90), lookingNorth())).length).toBe(0);
  });

  it("stop at the line's end, as the body does", () => {
    expect(panels(picture(doc(0), lookingNorth()))).toHaveLength(8); // its two handles, either side of x 3
    const p = picture(doc(0), cutting({ x: 0, y: 0.5 }, { x: 3, y: 0.5 }));
    expect(panels(p)).toHaveLength(4);
    expect(Math.max(...panels(p).flatMap((q) => (q.kind === "segment" ? [q.a.x, q.b.x] : [])))).toBeLessThan(3);
  });

  it("stop at the far line: a door's depth past it isn't there", () => {
    expect(panels(picture(doc(0), lookingNorth(1))).length).toBe(0); // doors at y 1.7, depth 1.2
    expect(panels(picture(doc(0), lookingNorth(1.3))).length).toBeGreaterThan(0);
  });
});

describe("a slab in two stretches", () => {
  /** A loft x 1.5–4.5, y 0.5–3.5, its hole x 2.25–3.75, y 1.25–2.75, and a post in the hole; a band that lies within the hole. */
  const doc = (): Document => ok(
    roomDoc(),
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 }, w: 3, d: 3 },
    { type: "addDeckHole", opId: "h", deck: "l/k0", at: { x: 3, y: 2 }, w: 1.5, d: 1.5 },
    ...block("post", 3, 2, 0.4, 0.4, 1),
    { type: "setObjectSize", objectId: "post/o0", w: 0.4, d: { standard: 0.4 }, h: { standard: 2.2 } },
  );
  const band = cutting({ x: 1, y: 1.6 }, { x: 5, y: 1.6 }, 1, 0.5);
  const SLAB = 2.1;
  const own = (p: SectionPicture): Polygon[] => beyond(p).filter((q) => extent(q)[3] === 2.15);

  it("draws a rectangle each side of the hole, none across it", () => {
    const got = own(picture(doc(), band)).map(extent).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(got).toHaveLength(2);
    expect(got[0]?.[0]).toBeCloseTo(0.5, 6);
    expect(got[0]?.[1]).toBeCloseTo(1.25, 6);
    expect(got[1]?.[0]).toBeCloseTo(2.75, 6);
    expect(got[1]?.[1]).toBeCloseTo(3.5, 6);
  });

  it("what stands in the gap shows", () => {
    expectExtent(topAt(picture(doc(), band), 2, SLAB), [1.8, 2.2, 0, 2.2]);
  });

  it("past the hole, one rectangle right across", () => {
    expect(own(picture(doc(), cutting({ x: 1, y: 1.6 }, { x: 5, y: 1.6 })))).toHaveLength(1);
  });
});

describe("walls", () => {
  it("draw in their own line", () => {
    const lines = picture(roomDoc(), lookingNorth()).primitives.filter((q) => q.kind === "segment" && q.color === INK.beyondWall);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.every((q) => q.kind === "segment" && "px" in q.width && q.width.px === INK.beyondWallWidth)).toBe(true);
  });

  it("a half wall beyond stops at its top, and a taller wall's cap fills the joint above it", () => {
    const shell = ok(roomDoc(), { type: "setCeiling", height: 3.05 }, { type: "addWall", opId: "part", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 4 } } });
    const doc = ok(shell, { type: "setWallTop", wallId: wallBetween(shell, { x: 1.5, y: 0 }, { x: 1.5, y: 4 }), top: 2.03 });
    const p = picture(doc, cutting({ x: 0.6, y: 2 }, { x: 0.6, y: 2 + 1.5 }, -1)); // looking east at the partition, past nothing else
    const seen = beyond(p).map(extent);
    const part = seen.find((e) => (e[3] ?? 0) === 2.03);
    expect(part).toBeDefined();
    const caps = picture(doc, cutting({ x: 0.4, y: 3.5 }, { x: 2.6, y: 3.5 }));
    const tall = beyond(caps).map(extent).filter((e) => (e[2] ?? 0) === 2.03 && (e[3] ?? 0) === 3.05);
    expect(tall.length).toBeGreaterThan(0); // the north wall's share of the joint, above the partition
  });
});

describe("doors and windows beyond", () => {
  /** The 6 × 4 room divided at y 2, with a door at x 2–2.8 and a window at x 3.5–4.5 on the divider, and a tall box behind each. */
  function doc(): Document {
    const room = ok(roomDoc(), ...block("behind-door", 2.4, 3, 0.4, 0.4, 2), ...block("behind-window", 4, 3, 0.4, 0.4, 2), { type: "addWall", opId: "div", from: { at: { x: 0, y: 2 } }, to: { at: { x: 6, y: 2 } } });
    const wall = wallBetween(room, { x: 0, y: 2 }, { x: 6, y: 2 });
    const a = room.joints[room.walls[wall]?.a ?? ""];
    const offset = (x0: number, x1: number): number => (a?.x === 0 ? x0 : 6 - x1);
    return ok(
      room,
      { type: "addOpening", opId: "door", wall, kind: "swing", offset: offset(2, 2.8), width: 0.8 },
      { type: "addOpening", opId: "win", wall, kind: "window", offset: offset(3.5, 4.5), width: 1 },
    );
  }
  const HEAD = 2.1;
  const SILL = 0.9;

  it("are rectangles you can't see through", () => {
    const p = picture(doc(), lookingNorth());
    expect(inkOf(p, INK.door)).toHaveLength(1);
    expect(inkOf(p, INK.glass)).toHaveLength(1);
    expect(topAt(p, 2.4, 1)?.color).toBe(INK.door);
    expectExtent(topAt(p, 2.4, 1), [2, 2.8, 0, HEAD]);
    expect(topAt(p, 4, 1.5)?.color).toBe(INK.glass);
    expectExtent(topAt(p, 4, 1.5), [3.5, 4.5, SILL, HEAD]);
  });

  it("the wall stays around them, and it's the same from the other side", () => {
    const p = picture(doc(), lookingNorth());
    expect(topAt(p, 2.4, HEAD + 0.1)?.color).toBe(INK.beyond);
    expect(topAt(p, 4, SILL - 0.1)?.color).toBe(INK.beyond);
    const back = picture(doc(), lookingSouth());
    expect(inkOf(back, INK.door)).toHaveLength(1);
    expectExtent(inkOf(back, INK.door)[0], [3.2, 4, 0, HEAD]);
  });

  it("have outlines", () => {
    const p = picture(doc(), lookingNorth());
    const lines = p.primitives.filter((q) => q.kind === "segment" && q.color === INK.beyondWall && "px" in q.width && q.width.px === INK.beyondPartWidth);
    expect(lines).toHaveLength(8);
  });

  it("a door on a wall seen edge on doesn't draw", () => {
    const room = roomDoc();
    const west = wallBetween(room, { x: 0, y: 0 }, { x: 0, y: 4 });
    const withDoor = ok(room, { type: "addOpening", opId: "d", wall: west, kind: "swing", offset: 1, width: 0.8 });
    expect(inkOf(picture(withDoor, lookingNorth()), INK.door)).toHaveLength(0);
  });

  it("Zero on the wall's centre line draws none: the plane's own gap shows", () => {
    const zero = picture(doc(), cutting({ x: 0, y: 2 }, { x: 6, y: 2 }, 1, 0));
    expect(inkOf(zero, INK.door)).toHaveLength(0);
    expect(inkOf(zero, INK.glass)).toHaveLength(0);
    expect(inkOf(zero, INK.cut).length).toBeGreaterThan(0);
  });

  it("stop at the line's end and at the far line", () => {
    const short = picture(doc(), cutting({ x: 0, y: 0.5 }, { x: 2.4, y: 0.5 }));
    expect(inkOf(short, INK.door)).toHaveLength(1);
    expectExtent(inkOf(short, INK.door)[0], [2, 2.4, 0, HEAD]);
    const before = picture(doc(), lookingNorth(1));
    expect(inkOf(before, INK.door)).toHaveLength(0);
  });

  it("a door on a wall it crosses at an angle follows the depth", () => {
    const skew = ok(roomDoc(), { type: "addWall", opId: "w", from: { at: { x: 1, y: 1 } }, to: { at: { x: 5, y: 3 } } });
    const wall = wallBetween(skew, { x: 1, y: 1 }, { x: 5, y: 3 });
    const a = skew.joints[skew.walls[wall]?.a ?? ""];
    const withDoor = ok(skew, { type: "addOpening", opId: "d", wall, kind: "swing", offset: a?.x === 1 ? 1.5 : Math.hypot(4, 2) - 2.5, width: 1 });
    const whole = extent(inkOf(picture(withDoor, cutting({ x: 0, y: 0.5 }, { x: 6, y: 0.5 })), INK.door)[0]);
    const clipped = extent(inkOf(picture(withDoor, cutting({ x: 0, y: 0.5 }, { x: 6, y: 0.5 }, 1, 1.6)), INK.door)[0]);
    expect(whole).toHaveLength(4);
    expect(clipped).toHaveLength(4);
    expect(clipped[1] ?? 0).toBeLessThan(whole[1] ?? 0);
    expect(clipped[0]).toBeCloseTo(whole[0] ?? 0, 6);
  });
});

describe("a depth", () => {
  /** A 1 × 1 box turned 45°: from y 1 its nearest corner is 0.293 deep and its widest 1 deep, x 3 ± 0.707. */
  const diamond = (): Document => ok(roomDoc(), ...block("d", 3, 2, 1, 1, 1, 45));
  const line = (depth: number | null): Section => cutting({ x: 0, y: 1 }, { x: 6, y: 1 }, 1, depth);
  const NEAREST = 1 - Math.SQRT1_2;
  const own = (p: SectionPicture): Polygon[] => beyond(p).filter((q) => extent(q)[3] === 1);

  it("clips a piece at the far line", () => {
    const halfWidth = 0.6 - NEAREST;
    const got = own(picture(diamond(), line(0.6)));
    expect(got).toHaveLength(1);
    expectExtent(got[0], [3 - halfWidth, 3 + halfWidth, 0, 1]);
  });

  it("past it nothing draws", () => {
    expect(own(picture(diamond(), line(NEAREST - 0.05)))).toHaveLength(0);
    expect(own(picture(diamond(), line(NEAREST + 0.05)))).toHaveLength(1);
  });

  it("a wall past it isn't drawn: the north wall, 3.4 deep", () => {
    const wide = (p: SectionPicture): Polygon[] => beyond(p).filter((q) => (extent(q)[1] ?? 0) - (extent(q)[0] ?? 0) > 1);
    expect(wide(picture(roomDoc(), lookingNorth(1)))).toHaveLength(0);
    expect(wide(picture(roomDoc(), lookingNorth(3.5)))).toHaveLength(1);
  });

  it("Zero draws only the cut", () => {
    const cuts = ok(diamond(), ...block("on-line", 1, 1, 0.5, 0.5, 1));
    const zero = picture(cuts, line(0));
    expect(beyond(zero)).toHaveLength(0);
    expect(inkOf(zero, INK.door)).toHaveLength(0);
    expect(zero.primitives.filter((q) => q.kind === "segment" && (q.color === INK.beyondPart || q.color === INK.beyondWall || q.color === INK.beyondPanel))).toHaveLength(0);
    expect(inkOf(zero, INK.furniture)).toHaveLength(1); // the box the plane passes through
    expect(inkOf(zero, INK.cut).length).toBeGreaterThan(0);
  });

  it("whole depth draws all", () => {
    const doc = ok(roomDoc(), ...block("near", 3, 1.5, 0.5, 0.5, 1), ...block("far", 1, 3.5, 0.5, 0.5, 1));
    expect(own(picture(doc, line(null)))).toHaveLength(2);
    expect(own(picture(doc, line(1)))).toHaveLength(1);
    expect(beyond(picture(doc, line(null))).length).toBeGreaterThan(beyond(picture(doc, line(1))).length);
  });

  it("clips at the line's ends too, and nothing behind the plane draws", () => {
    const p = own(picture(diamond(), cutting({ x: 0, y: 1 }, { x: 3, y: 1 })));
    expect(p).toHaveLength(1);
    expectExtent(p[0], [3 - Math.SQRT1_2, 3, 0, 1]);
    const start = own(picture(diamond(), cutting({ x: 3, y: 1 }, { x: 6, y: 1 })));
    expectExtent(start[0], [0, Math.SQRT1_2, 0, 1]);
    expect(own(picture(diamond(), cutting({ x: 0, y: 3 }, { x: 6, y: 3 })))).toHaveLength(0); // it looks north, from past it
  });

  it("a piece the plane passes through draws only its part past the plane", () => {
    const through = own(picture(diamond(), cutting({ x: 0, y: 2.5 }, { x: 6, y: 2.5 })));
    const half = 2 + Math.SQRT1_2 - 2.5;
    expect(through).toHaveLength(1);
    expectExtent(through[0], [3 - half, 3 + half, 0, 1]);
  });
});

/** Every kind with a stair rule. */
const STAIRS = OBJECT_KINDS.flatMap((k) => (stairRuleOf(k.id) ? [k] : []));

/** Its depth on the plan at rotation 0. */
const depthOf = (kind: string): number => {
  const k = OBJECT_KINDS.find((o) => o.id === kind);
  const c = k && Object.values(k.configs)[0];
  return c?.d ?? 1;
};

describe("stairs", () => {
  // Flight along y, climbing away from a viewer at y 0.2 and seen from its side from x 0.2 (looking east).
  const stairDoc = (kind: string): Document => ok(roomDoc(), piece("s", kind, 3, 2, depthOf(kind)));
  const along = cutting({ x: 1.5, y: 0.2 }, { x: 4.5, y: 0.2 });
  const across = cutting({ x: 0.2, y: 0.2 }, { x: 0.2, y: 3.8 }, -1);
  /** All but the room's walls, which alone go from the floor to the ceiling. */
  const stairOf = (p: SectionPicture): Polygon[] => beyond(p).filter((q) => Math.abs((extent(q)[3] ?? 0) - 2.5) > 1e-6);

  it("there are nine kinds", () => {
    expect(STAIRS.map((k) => k.id)).toEqual(["stair", "openStair", "storageStair", "shipsLadder", "alternatingTread", "rungLadder", "spiralStair", "winderStair", "storageSteps"]);
  });

  // The faces that aren't edge on from each way, read off renders of all seven: one fewer means a face went missing. A
  // flight's two handrails add 14 and 8 (each stands free here: two rail pieces and two posts). A spiral's rails add 186
  // each way: three landing sides, as it stands free here, and the balustrade's bars and posts.
  const COUNTS: Record<string, { along: number; across: number }> = {
    stair: { along: 22 + 14, across: 22 + 8 },
    openStair: { along: 30 + 14, across: 4 + 8 },
    storageStair: { along: 18 + 14, across: 50 + 8 },
    shipsLadder: { along: 24 + 14, across: 20 + 8 },
    alternatingTread: { along: 30 + 14, across: 24 + 8 },
    rungLadder: { along: 26, across: 22 },
    spiralStair: { along: 101 + 186, across: 101 + 186 },
    winderStair: { along: 37, across: 31 }, // three winder blocks (their slanted sides show both ways), 8 straight, rails from the square's back
    storageSteps: { along: 2 + 2 + 2 + 2, across: 4 }, // 2 steps: risers, backs, drawer fronts and their pulls (steps.30); 2 sides each; no rails (steps.16)
  };

  for (const kind of STAIRS.map((k) => k.id)) {
    it(`${kind} draws along the flight and across it, with the counts its faces give`, () => {
      const doc = stairDoc(kind);
      expect({ along: stairOf(picture(doc, along)).length, across: stairOf(picture(doc, across)).length }).toEqual(COUNTS[kind]);
    });

    it(`${kind} goes from the floor up to its height`, () => {
      const zs = stairOf(picture(stairDoc(kind), along)).flatMap((q) => q.points.map((r) => r.y));
      const h = OBJECT_KINDS.find((o) => o.id === kind)?.configs[0]?.h ?? 0;
      expect(Math.min(...zs)).toBeLessThanOrEqual(0.3);
      expect(Math.max(...zs)).toBeGreaterThan(h - 0.25); // 1.90 for the 2.15 kinds; the top step of 0.45 Storage steps is at 0.30
    });

    it(`${kind} clipped at the plane stays outlined: no cut's fill, no grey`, () => {
      const doc = stairDoc(kind);
      const cut = picture(doc, cutting({ x: 1.5, y: 2 }, { x: 4.5, y: 2 }));
      expect(inkOf(cut, INK.furniture)).toHaveLength(0);
      expect(stairOf(cut).length).toBeGreaterThan(0);
      expect(stairOf(cut).length).toBeLessThan(stairOf(picture(doc, along)).length);
      expect(cut.primitives.some((q) => q.kind === "segment" && q.color === INK.beyondPart)).toBe(true);
    });
  }

  it("draws its own faces far first: from the foot of a solid stair the lowest riser is on top", () => {
    const p = picture(stairDoc("stair"), along);
    const top = extent(topAt(p, 1.5, 0.05));
    expect(top).toHaveLength(4);
    expect(top[3] ?? 9).toBeLessThan(0.3); // not the tall back face
  });

  it("is one unit in the order: a piece nearer than all of it hides it, and one past it is hidden", () => {
    const doc = ok(stairDoc("stair"), ...block("near", 3, 0.3, 0.2, 0.1, 0.1), ...block("far", 3, 3.82, 2, 0.1, 2.4));
    const p = picture(doc, along);
    expectExtent(topAt(p, 1.5, 0.05), [1.4, 1.6, 0, 0.1]);
    expect(extent(topAt(p, 1.5, 1))[1]).toBeLessThan(2); // the stair over the far piece
    expectExtent(topAt(p, 0.5, 1), [0.5, 2.5, 0, 2.4]); // the far piece beside it
  });

  it("a sloping edge clipped at the line's end keeps its height there", () => {
    const halfway = picture(stairDoc("openStair"), cutting({ x: 0.2, y: 2 }, { x: 0.2, y: 3.8 }, -1));
    const atEnd = stairOf(halfway).flatMap((q) => q.points.filter((r) => Math.abs(r.x - 1.8) < 1e-6));
    expect(atEnd.length).toBeGreaterThanOrEqual(2);
    for (const r of atEnd) {
      expect(r.y).toBeGreaterThan(0.2); // the flight is about halfway up here, neither at its foot
      expect(r.y).toBeLessThan(1.9); // nor at its head
    }
  });

  it("past the far line a stair draws only the part within", () => {
    const doc = stairDoc("stair");
    const within = stairOf(picture(doc, cutting({ x: 1.5, y: 0.2 }, { x: 4.5, y: 0.2 }, 1, 1.5)));
    const whole = stairOf(picture(doc, along));
    expect(within.length).toBeGreaterThan(0);
    expect(within.length).toBeLessThan(whole.length);
    expect(stairOf(picture(doc, cutting({ x: 1.5, y: 0.2 }, { x: 4.5, y: 0.2 }, 1, 0.2)))).toHaveLength(0);
  });

  it("stops at the line's end", () => {
    const p = picture(stairDoc("stair"), cutting({ x: 3, y: 0.2 }, { x: 4.5, y: 0.2 }));
    const xs = stairOf(p).flatMap((q) => q.points.map((r) => r.x));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(0.45, 6);
  });

  it("each kind's cut has its height's worth of faces in Zero: none", () => {
    for (const kind of STAIRS.map((k) => k.id)) {
      expect(beyond(picture(stairDoc(kind), cutting({ x: 1.5, y: 2 }, { x: 4.5, y: 2 }, 1, 0)))).toHaveLength(0);
    }
  });
});

/** mulberry32, as packages/domain/test/helpers.ts `rng`: a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const [a, b] = [out[i], out[j]];
    if (a !== undefined && b !== undefined) [out[i], out[j]] = [b, a];
  }
  return out;
}

/**
 * The seeded studio's shape (`packages/server/scripts/seed-studio.ts`, which an editor test can't import): a 7 × 2.5 shell
 * under a 3.05 ceiling, a 2.03 partition, a door, two windows, a loft and a hollow platform, furnished in Day and Night.
 */
function studio(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "studio")) doc = unwrap(execute(doc, cmd)).doc;
  doc = ok(doc, { type: "setCeiling", height: 3.05 }, { type: "addWall", opId: "part", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 2.5 } } });
  const partition = wallBetween(doc, { x: 1.5, y: 0 }, { x: 1.5, y: 2.5 });
  const opening = (opId: string, kind: "swing" | "window", from: Point, to: Point, at: Point, width: number): Command => {
    const wall = wallBetween(doc, from, to);
    const a = doc.joints[doc.walls[wall]?.a ?? ""];
    return { type: "addOpening", opId, wall, kind, offset: Math.hypot(at.x - (a?.x ?? 0), at.y - (a?.y ?? 0)) - width / 2, width };
  };
  return ok(
    doc,
    { type: "setWallTop", wallId: partition, top: 2.03 },
    opening("door", "swing", { x: 1.5, y: 0 }, { x: 1.5, y: 2.5 }, { x: 1.5, y: 1.2 }, 0.8),
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 1.25 }, w: 2.4, d: 2.3, top: 2.15 },
    { type: "setDeckFinish", deckId: "loft/k0", finish: { ...motifDefaults("widePlanks"), colour: "#a99c8a" } },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3.6, y: 1.85 }, w: 2, d: 1.1, top: 0.45, solid: false },
    piece("mat", "mattress", 1.1, 1.25, 2, 90, "loft/k0"),
    piece("sh", "showerTray", 0.5, 2, 0.8),
    piece("wm", "washingMachine", 0.4, 0.4, 0.6, 180),
    piece("shelf", "shelf", 2, 0.3, 0.4, 180),
    piece("fr", "fridge", 1.9, 2.075, 0.65),
    piece("sofa", "sofa", 3.85, 1.95, 0.9, 0, "plat/k0", "2 seats"),
    piece("sink", "sinkUnit", 5.2, 0.4, 0.6, 180),
    piece("hob", "hobUnit", 5.9, 0.4, 0.6, 180),
    piece("ctr", "counter", 6.5, 0.4, 0.6, 180),
    piece("wcab", "wallCabinet", 6.5, 0.275, 0.35, 180),
    { type: "copyState", opId: "n", from: "s0", name: "Night" },
    piece("tab", "extendingTable", 5.75, 2, 1.2, 90),
    piece("ch1", "chair", 5.13, 2, 0.45, 90),
    piece("ch2", "chair", 6.37, 2, 0.45, 270),
  );
}

describe("the order, over a furnished studio's cuts", () => {
  const CUTS: Section[] = [
    cutting({ x: -0.2, y: 1.2 }, { x: 7.2, y: 1.2 }),
    cutting({ x: -0.2, y: 1.2 }, { x: 7.2, y: 1.2 }, -1),
    cutting({ x: 5.75, y: -0.2 }, { x: 5.75, y: 2.7 }),
    cutting({ x: 5.75, y: -0.2 }, { x: 5.75, y: 2.7 }, 1, 2),
    cutting({ x: 3, y: -0.2 }, { x: 3, y: 2.7 }, -1),
    cutting({ x: 0.3, y: 0.2 }, { x: 6.7, y: 2.3 }),
    cutting({ x: 6.7, y: 0.2 }, { x: 0.3, y: 2.3 }, -1, 1.5),
  ];
  const layouts = ["s0", "n/s0"];

  it("the order is the same whatever the input order", () => {
    const doc = studio();
    const random = rng(20261104);
    let compared = 0;
    for (const s of CUTS) {
      for (const layout of layouts) {
        const items = view3dItems(doc, layout, null, new Set(), false);
        const frame = sectionFrame(s);
        const first = sectionBeyond(frame, s.depth, items, CANVAS_STYLE);
        expect(first.length).toBeGreaterThan(0);
        for (let round = 0; round < 8; round++) {
          expect(sectionBeyond(frame, s.depth, shuffled(items, random), CANVAS_STYLE)).toEqual(first);
          compared++;
        }
      }
    }
    expect(compared).toBe(CUTS.length * layouts.length * 8);
  });

  it("Day and Night differ", () => {
    const [day, night] = layouts.map((l) => beyond(picture(studio(), CUTS[0] ?? cutting({ x: 0, y: 0 }, { x: 1, y: 0 }), l)).length);
    expect(day).not.toBe(night);
  });
});
