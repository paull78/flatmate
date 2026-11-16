import { describe, expect, it } from "vitest";
import { emptyDocument, execute, guardRuns, rectangleRoom, spiralLanding, spiralRails, validateDocument, type Command, type Document, type LandingRail, type SpiralRails } from "../src";

// A spiral's rail and balustrade (AC-12, edge-catch.06): automatic, in the treads' frame (centred, x across, +y toward the
// back edge). The 8 × 6 room has a loft at x 0.1–2.1, y 1.5–4.5; the spiral's back edge is on its edge at (2.1, 3), turned 90°:
// box x 2.1–3.7, y 2.2–3.8, centre (2.9, 3); 10 risers of 0.215, 9 treads of 30° from 360° down to 90°. In the world its frame's
// (x, y) is (2.9 − y, 3 + x), so its landing is x 2.1–2.9, y 3–3.8: its right side y 3.8, its front side x 2.9, its back side on
// the deck's edge x 2.1, and the last tread meets it along y 3.

const LOFT = "l/k0";
const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const room = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.4 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const place: Command = { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "straight" };
const railsOf = (doc: Document): SpiralRails => {
  const [only, ...rest] = [...spiralRails(doc).values()];
  if (!only || rest.length > 0) throw new Error("not one spiral");
  return only;
};
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** A landing rail as "x0,y0 x1,y1", its two ends sorted. */
const line = (r: LandingRail): string => [r.a, r.b].map((p) => `${r3(p.x)},${r3(p.y)}`).sort().join(" ");
const lines = (rails: SpiralRails): string[] => rails.landing.map(line).sort();
const INSET = 0.02;
const R = 0.8;
/** The rail on the landing's front side, and on its right side, whole: flush with the landing's edge, inside it. */
const FRONT = `${r3(INSET)},${r3(INSET)} ${r3(R - INSET)},${r3(INSET)}`;
const RIGHT = `${r3(R - INSET)},${r3(INSET)} ${r3(R - INSET)},${r3(R - INSET)}`;
const BACK = `${r3(INSET)},${r3(R - INSET)} ${r3(R - INSET)},${r3(R - INSET)}`;

type P = { x: number; y: number };
const side = (p: P, q: P, r: P): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const crosses = (a: P, b: P, c: P, d: P): boolean => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;

describe("the landing's rail", () => {
  it("is on its two open sides: the right one and the front one, over the drop", () => {
    expect(lines(railsOf(room(place)))).toEqual([FRONT, RIGHT].sort());
  });

  it("stands on the landing, 0.90 high, the same figure a flight's handrail has", () => {
    for (const r of railsOf(room(place)).landing) {
      expect(r.bottom).toBeCloseTo(2.15, 6);
      expect(r.top).toBeCloseTo(3.05, 6);
    }
  });

  it("uses the landing's own shape: a smaller spiral's rails follow it", () => {
    const small = room({ type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair", size: { w: 1.4, d: 1.4 } }, at: { x: 2.1, y: 3 }, rotation: 90, deck: null, reaches: LOFT });
    const corner = spiralLanding(1.4, 1.4)[2];
    const xs = railsOf(small).landing.flatMap((r) => [r.a.x, r.b.x]);
    expect(Math.max(...xs)).toBeCloseTo((corner?.x ?? 0) - INSET, 6);
  });
});

describe("the way off stays open", () => {
  it("no rail where the last tread meets the landing, nor where the landing meets the deck", () => {
    const { landing } = railsOf(room(place));
    const offTread = landing.filter((r) => Math.abs(r.a.x) < 1e-6 && Math.abs(r.b.x) < 1e-6);
    expect(offTread).toEqual([]);
    expect(lines(railsOf(room(place)))).not.toContain(BACK);
  });

  it("a person can walk it: off the last tread sideways, across the landing, forward onto the deck", () => {
    const doc = room(place);
    // In the treads' frame: on the last tread, on the landing, past its back side. In the world: x 2.9 − y, y 3 + x.
    const steps = [{ x: -0.3, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.4, y: 1.1 }];
    const world = (p: P): P => ({ x: 2.9 - p.y, y: 3 + p.x });
    for (const [a, b] of [[steps[0], steps[1]], [steps[1], steps[2]]] as const) {
      if (!a || !b) throw new Error("no step");
      for (const r of railsOf(doc).landing) expect(crosses(a, b, r.a, r.b), `over ${line(r)}`).toBe(false);
      for (const g of guardRuns(doc)) expect(crosses(world(a), world(b), g.a, g.b), "over the deck's guard").toBe(false);
    }
  });

  it("the deck's gap is the landing's back side and no wider", () => {
    const runs = guardRuns(room(place)).filter((r) => Math.abs(r.a.x - 2.1) < 1e-6 && Math.abs(r.b.x - 2.1) < 1e-6);
    const ends = runs.flatMap((r) => [r.a.y, r.b.y]).map(r3).sort((p, q) => p - q);
    expect(ends).toEqual([1.5, 3, 3.8, 4.5]);
  });

  it("on a deck set to None the back side stays free of a rail too", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guard: "none" }, place);
    expect(lines(railsOf(doc))).toEqual([FRONT, RIGHT].sort());
  });
});

describe("a spiral on each side of a deck, turned to each rotation", () => {
  // The loft is in the middle of the room, x 3–5, y 2–4; each edge's middle takes a spiral, its back on the edge and its box outside.
  const cases = [
    { name: "east", at: { x: 5, y: 3 }, rotation: 90 },
    { name: "north", at: { x: 4, y: 4 }, rotation: 180 },
    { name: "west", at: { x: 3, y: 3 }, rotation: 270 },
    { name: "south", at: { x: 4, y: 2 }, rotation: 0 },
  ];
  const middle: Command = { type: "addDeck", opId: "l", preset: "loft", at: { x: 4, y: 3 }, w: 2, d: 2 };
  const at = (where: P): Document => build(...rectangleRoom({ x: 0, y: 0 }, 9, 7, "c"), { type: "setCeiling", height: 3.4 }, middle,
    { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at: where, shape: "straight" });

  it.each(cases)("$name: rotation $rotation, rails on the landing's right and front sides, whatever the turn", ({ at: where, rotation }) => {
    const doc = at(where);
    expect(Object.values(doc.placements).map((p) => p.rotation % 360)).toEqual([rotation]);
    expect(validateDocument(doc).ok).toBe(true);
    expect(lines(railsOf(doc))).toEqual([FRONT, RIGHT].sort());
  });

  it("the frame's rails land in the world where the deck's gap says the landing is", () => {
    for (const { at: where, rotation } of cases) {
      const doc = at(where);
      const r = (rotation * Math.PI) / 180;
      const along = { x: -Math.sin(r), y: Math.cos(r) }; // toward the back edge
      const right = { x: Math.cos(r), y: Math.sin(r) };
      // The gap in the deck's guard, on the edge through `where`, runs from there along the spiral's right.
      const onEdge = guardRuns(doc).filter((g) => Math.abs((g.a.x - where.x) * along.x + (g.a.y - where.y) * along.y) < 1e-6 && Math.abs((g.b.x - where.x) * along.x + (g.b.y - where.y) * along.y) < 1e-6);
      const taken = onEdge.flatMap((g) => [g.a, g.b]).map((p) => r3((p.x - where.x) * right.x + (p.y - where.y) * right.y)).sort((p, q) => p - q);
      expect(taken).toEqual([-1, 0, 0.8, 1]);
    }
  });
});

describe("beside a wall", () => {
  const wallAt = (from: number, to: number, top?: number): Command[] => [
    // Its face on the box's right side, y 3.8.
    { type: "addWall", opId: "wr", from: { at: { x: from, y: 3.9 } }, to: { at: { x: to, y: 3.9 } } },
    ...(top === undefined ? [] : [{ type: "setWallTop", wallId: "wr/w0", top } satisfies Command]),
  ];

  it("a landing side against a wall has no rail", () => {
    expect(lines(railsOf(room(...wallAt(2.1, 4), place)))).toEqual([FRONT]);
  });

  it("partly against a wall, a rail only on the open stretch", () => {
    // The wall stops at x 2.5, 0.40 in from the back: the landing's right side, x 2.1–2.9, is open from there to its front side.
    const rails = railsOf(room(...wallAt(2.1, 2.5), place));
    expect(lines(rails)).toEqual([FRONT, `${r3(R - INSET)},${r3(INSET)} ${r3(R - INSET)},${r3(0.4 - INSET)}`].sort());
  });

  it("a wall too low to count leaves the rail", () => {
    expect(lines(railsOf(room(...wallAt(2.1, 4, 2.5), place)))).toEqual([FRONT, RIGHT].sort());
  });

  it("a wall that's only on the treads' side changes nothing on the landing, and leaves the balustrade", () => {
    const left: Command = { type: "addWall", opId: "wl", from: { at: { x: 2.1, y: 2.1 } }, to: { at: { x: 4, y: 2.1 } } };
    const rails = railsOf(room(left, place));
    expect(lines(rails)).toEqual([FRONT, RIGHT].sort());
    expect(rails.knots.length).toBeGreaterThan(0);
  });

  it("a spiral on a turned deck, against a wall along its turned side", () => {
    const deck: Command = { type: "addDeck", opId: "l", preset: "loft", at: { x: 2.5, y: 3 }, w: 2, d: 3, rotation: 30 };
    const edge = { x: 2.5 + Math.cos(Math.PI / 6), y: 3 + Math.sin(Math.PI / 6) };
    const stair: Command = { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at: edge, shape: "straight" };
    const open = build(...rectangleRoom({ x: 0, y: 0 }, 9, 7, "c"), { type: "setCeiling", height: 3.4 }, deck, stair);
    expect(lines(railsOf(open))).toEqual([FRONT, RIGHT].sort());
    // The stair's right is (cos 120°, sin 120°), since it turns with the deck's edge: a wall 0.10 off that side, along the back direction.
    const rotation = (Object.values(open.placements)[0]?.rotation ?? 0) * (Math.PI / 180);
    const [right, along] = [{ x: Math.cos(rotation), y: Math.sin(rotation) }, { x: -Math.sin(rotation), y: Math.cos(rotation) }];
    const p = (back: number) => ({ x: edge.x + right.x * 0.9 + along.x * back, y: edge.y + right.y * 0.9 + along.y * back });
    const walled = build(...rectangleRoom({ x: 0, y: 0 }, 9, 7, "c"), { type: "setCeiling", height: 3.4 }, deck,
      { type: "addWall", opId: "wr", from: { at: p(-1.7) }, to: { at: p(-0.1) } }, stair);
    // It stops 0.10 short of the back edge, where the deck is, so the rail has that stretch left.
    expect(lines(railsOf(walled))).toEqual([FRONT, `${r3(R - INSET)},${r3(0.7 + INSET)} ${r3(R - INSET)},${r3(R - INSET)}`].sort());
  });
});

describe("in a hole, and where a deck doesn't reach", () => {
  const cabin = (...more: Command[]): Document => build(
    ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 },
    ...more,
  );
  const inHole: Command = { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at: { x: 1.05, y: 1.9 }, shape: "straight" };

  it("a spiral in a hole has the same two rails, its back on the hole's side", () => {
    const doc = cabin({ type: "addDeckHole", opId: "big", deck: LOFT, at: { x: 1.05, y: 1.05 }, w: 1.7, d: 1.7 }, inHole);
    expect(validateDocument(doc).ok).toBe(true);
    expect(lines(railsOf(doc))).toEqual([FRONT, RIGHT].sort());
  });

  it("a landing side flush against the same deck's slab has none: the hole's own guard is there", () => {
    // The hole ends at the spiral's right side, x 1.85: its east side runs along the landing, its guard on that edge.
    const doc = cabin({ type: "addDeckHole", opId: "big", deck: LOFT, at: { x: 1.025, y: 1.05 }, w: 1.65, d: 1.7 }, inHole);
    expect(lines(railsOf(doc))).toEqual([FRONT]);
    const east = guardRuns(doc).filter((g) => Math.abs(g.a.x - 1.85) < 1e-6 && Math.abs(g.b.x - 1.85) < 1e-6);
    expect(east).toHaveLength(1);
  });

  it("standing free, its back side has a rail too: no deck there, only a drop", () => {
    const doc = room({ type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair" }, at: { x: 5, y: 3 }, rotation: 0, deck: null });
    expect(lines(railsOf(doc))).toEqual([BACK, FRONT, RIGHT].sort());
  });

  it("a deck reaching only part of the back side leaves a rail on the rest", () => {
    // The loft stops at y 3.4, halfway along the landing's back side (y 3–3.8), and the stair still reaches it.
    const short = build(...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.4 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 2.45 }, w: 2, d: 1.9 },
      { type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair" }, at: { x: 2.1, y: 3 }, rotation: 90, deck: null, reaches: LOFT });
    const back = railsOf(short).landing.filter((r) => Math.abs(r.a.y - (R - INSET)) < 1e-6 && Math.abs(r.b.y - (R - INSET)) < 1e-6);
    expect(back).toHaveLength(1);
    const xs = [back[0]?.a.x ?? 0, back[0]?.b.x ?? 0].sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(0.4 + INSET, 6);
    expect(xs[1]).toBeCloseTo(R - INSET, 6);
  });
});

describe("the balustrade", () => {
  const withRiser = (riser: number): Document => {
    const object = Object.values(room(place).placements)[0]?.object ?? "";
    return room(place, { type: "setStair", objectId: object, riser });
  };

  it("runs the treads' outer edge, just inside it, from the first tread's low end to the last's high end", () => {
    const { radius, start, knots } = railsOf(room(place));
    expect(radius).toBeCloseTo(R - INSET, 6);
    expect(start).toBeCloseTo(360, 6); // tread 0's `to`, where you step on
    expect(knots[0]?.a).toBe(0);
    expect(knots.at(-1)?.a).toBeCloseTo(270, 6); // and 270° on, at 90°, the last tread's end
  });

  it("rises with the treads, 0.90 above them: at each tread's low end, that tread's top", () => {
    const { knots } = railsOf(room(place));
    expect(knots).toHaveLength(2);
    expect(knots[0]?.top).toBeCloseTo(0.215 + 0.9, 6);
    expect(knots[1]?.top).toBeCloseTo(2.15 + 0.9, 6); // it arrives at the landing rail's height
  });

  it("follows however many treads there are", () => {
    // 12 risers of 0.179: 11 treads turning 330°, so the first starts at 420° and lies under the landing.
    const doc = withRiser(0.18);
    const { start, knots } = railsOf(doc);
    expect(start).toBeCloseTo(420, 6);
    expect(knots.at(-1)?.a).toBeCloseTo(330, 6);
    expect(knots[0]?.top).toBeCloseTo(2.15 / 12 + 0.9, 6);
  });

  it("stops at the ceiling, bending where it meets it, as the landing's rail stops there", () => {
    const doc = room({ type: "setCeiling", height: 2.5 }, place);
    const rails = railsOf(doc);
    for (const r of rails.landing) expect(r.top).toBeCloseTo(2.5, 6);
    expect(rails.knots).toHaveLength(3);
    const [low, bend, end] = rails.knots;
    expect(low?.top).toBeCloseTo(0.215 + 0.9, 6);
    expect(bend?.top).toBeCloseTo(2.5, 6);
    expect(end?.top).toBeCloseTo(2.5, 6);
    expect(bend?.a).toBeCloseTo(((2.5 - 1.115) / (3.05 - 1.115)) * 270, 6); // where the rising line reaches 2.50
  });

  it("from a platform, it counts from where the steps begin", () => {
    const doc = room(
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 5, y: 3 }, w: 2.4, d: 2.4 },
      { type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair" }, at: { x: 5, y: 3.8 }, rotation: 0, deck: "p/k0" },
    );
    const rails = railsOf(doc);
    expect(rails.knots[0]?.top).toBeGreaterThan(0.45 + 0.9);
    expect(rails.landing[0]?.bottom).toBeCloseTo(0.45 + 2.15, 6);
  });
});

describe("nothing else changes", () => {
  it.each(["stair", "openStair", "storageStair", "shipsLadder", "alternatingTread", "rungLadder"])("a %s has none of these", (kind) => {
    const doc = room({ type: "placeStair", opId: "sp", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "straight" });
    expect(spiralRails(doc).size).toBe(0);
  });

  it("one row per spiral, whatever the layouts", () => {
    const doc = room({ type: "addState", opId: "n", name: "Night" }, place);
    expect(Object.values(doc.placements).filter((p) => p.id.startsWith("sp/"))).toHaveLength(2);
    expect(spiralRails(doc).size).toBe(1);
  });

  it("the document stores nothing for them, and nothing is refused", () => {
    const doc = room(place, { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3.2, y: 4.45 }, rotation: 0 });
    expect(validateDocument(doc).ok).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("balustrade");
    expect(JSON.stringify(doc)).not.toContain("spiralRail");
  });
});
