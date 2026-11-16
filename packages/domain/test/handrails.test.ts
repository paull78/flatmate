import { describe, expect, it } from "vitest";
import { emptyDocument, execute, flightHandrails, guardRuns, MIN_PASSAGE, rectangleRoom, validateDocument, type Command, type Document, type Handrail } from "../src";
import { pitchLineOf } from "../src/queries/underside";

// A flight's handrails (AC-11, guards.07): automatic, on each open long side, following the pitch line. The 8 × 6 room has a
// loft at x 0.1–2.1, y 1.5–4.5; the stair's back edge is on its edge at (2.1, 3), so it runs +x: 12 risers of 0.179, its
// foot at x 5.088, y 2.55–3.45. At rotation 90 its right side is y 3.45 and its left y 2.55.

const LOFT = "l/k0";
const RUN = 2.988;
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
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const place = (kind = "stair", shape: "straight" | "l-right" = "straight"): Command => ({ type: "placeStair", opId: "ps", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape });
/** A wall against the right side (y 3.45) from `x0` to `x1`, its face on the side. */
const rightWall = (x0 = 2.1, x1 = 5.6, top?: number): Command[] => [
  { type: "addWall", opId: "wr", from: { at: { x: x0, y: 3.55 } }, to: { at: { x: x1, y: 3.55 } } },
  ...(top === undefined ? [] : [{ type: "setWallTop", wallId: "wr/w0", top } satisfies Command]),
];
const leftWall: Command = { type: "addWall", opId: "wl", from: { at: { x: 2.1, y: 2.45 } }, to: { at: { x: 5.6, y: 2.45 } } };
/** A stair's rails: by default, the placed stair's. */
const railsOf = (doc: Document, object?: string): readonly Handrail[] => flightHandrails(doc).get(object ?? Object.values(doc.placements).find((p) => p.id.startsWith("ps/"))?.object ?? "") ?? [];
const from = (r: Handrail): number => r.knots[0]?.a ?? Number.NaN;
const to = (r: Handrail): number => r.knots.at(-1)?.a ?? Number.NaN;
const pitch = (doc: Document, placement: string) => {
  const line = pitchLineOf(doc, placement);
  if (!line) throw new Error("no pitch line");
  return line;
};

describe("which sides have one", () => {
  it("a straight stair has one on each long side, the whole run long", () => {
    const rails = railsOf(room(place()));
    expect(rails).toHaveLength(2);
    expect(rails.map((r) => Math.sign(r.x)).sort()).toEqual([-1, 1]);
    for (const r of rails) {
      expect(Math.abs(r.x)).toBeLessThan(0.45); // inside the box, so it stays with its stair
      expect(Math.abs(r.x)).toBeGreaterThan(0.41); // and off a side board's line
      expect(from(r)).toBeCloseTo(0, 6);
      expect(to(r)).toBeCloseTo(RUN, 3);
    }
  });

  it("none against a wall", () => {
    const rails = railsOf(room(...rightWall(), place()));
    expect(rails).toHaveLength(1);
    expect(Math.sign(rails[0]?.x ?? 0)).toBe(-1); // the open one
  });

  it("the other side, against a wall on that side", () => {
    const rails = railsOf(room(leftWall, place()));
    expect(rails).toHaveLength(1);
    expect(Math.sign(rails[0]?.x ?? 0)).toBe(1);
  });

  it("none against walls on both sides", () => {
    expect(railsOf(room(...rightWall(), leftWall, place()))).toEqual([]);
  });

  it("a half wall too low to count leaves the rail", () => {
    expect(railsOf(room(...rightWall(2.1, 5.6, 1), place()))).toHaveLength(2);
  });

  it("a wall as tall as the rail only at its low end doesn't count for the whole of its own length", () => {
    // 1.50 tall along the whole side: the rail passes it, at 2.87 at the top.
    expect(railsOf(room(...rightWall(2.1, 5.6, 1.5), place()))).toHaveLength(2);
  });

  it("a wall standing on a deck, starting above the pitch line, doesn't count", () => {
    // A second loft along the right side, with a full wall on it, its face on the side: all of it above the flight's pitch line.
    const second: Command = { type: "addDeck", opId: "b", preset: "loft", at: { x: 3.05, y: 4.225 }, w: 1.9, d: 1.55 };
    const wall: Command = { type: "addWall", opId: "wr", from: { at: { x: 2.2, y: 3.55 } }, to: { at: { x: 3.8, y: 3.55 } }, base: "b/k0" };
    const rails = railsOf(room(second, wall, place()));
    expect(rails).toHaveLength(2);
    for (const r of rails) expect(to(r) - from(r)).toBeCloseTo(RUN, 3);
  });

  it("a half wall as tall as the rail where it stands does count", () => {
    // x 4.8–5.088 is the bottom 0.288 of the run, where the rail's top stays under 1.30.
    const right = railsOf(room(...rightWall(4.8, 5.6, 1.5), place())).find((r) => r.x > 0);
    expect(from(right ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(5.088 - 4.8, 2);
    expect(to(right ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(RUN, 3);
  });

  it("partly against a wall, a rail only on the open stretch", () => {
    const rails = railsOf(room(...rightWall(3.5, 5.6), place()));
    const right = rails.find((r) => r.x > 0);
    expect(from(right ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(5.088 - 3.5, 2);
    expect(to(right ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(RUN, 3);
    const left = rails.find((r) => r.x < 0);
    expect(from(left ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(0, 6);
  });

  it("a wall in the middle of a side leaves a rail either side of it", () => {
    const right = railsOf(room(...rightWall(3, 4), place())).filter((r) => r.x > 0);
    expect(right).toHaveLength(2);
    expect(to(right[0] ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(5.088 - 4, 2);
    expect(from(right[1] ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(5.088 - 3, 2);
  });

  it("a flight on a turned deck, against a wall along its turned side", () => {
    const line: Command = { type: "addDeck", opId: "l", preset: "loft", at: { x: 2.5, y: 3 }, w: 2, d: 3, rotation: 30 };
    const stair: Command = { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.5 + Math.cos(Math.PI / 6), y: 3 + Math.sin(Math.PI / 6) }, shape: "straight" };
    const open = build(...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 }, line, stair);
    expect(railsOf(open)).toHaveLength(2);
    // Its foot (5.954, 4.994), running (−0.866, −0.5); its right side faces (−0.5, 0.866). A wall 0.10 off it, stopping 5 cm short of the top.
    const p = (a: number) => ({ x: 5.954 - 0.866 * a + (-0.5 * 0.55), y: 4.994 - 0.5 * a + 0.866 * 0.55 });
    const walled = build(...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 }, line,
      { type: "addWall", opId: "wr", from: { at: p(-0.1) }, to: { at: p(RUN - 0.05) } }, stair);
    const rails = railsOf(walled);
    const left = rails.find((r) => r.x < 0);
    const right = rails.find((r) => r.x > 0);
    expect(to(left ?? { x: 0, knots: [], kind: "railing" }) - from(left ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(RUN, 3);
    expect(from(right ?? { x: 0, knots: [], kind: "railing" })).toBeGreaterThan(RUN - 0.16); // the wall's end, within the 0.10 half of its cap
    expect(to(right ?? { x: 0, knots: [], kind: "railing" })).toBeCloseTo(RUN, 3);
  });

  it("an L has them on both flights", () => {
    const doc = room(place("stair", "l-right"));
    const flights = [...new Set(Object.values(doc.placements).map((p) => p.object))];
    expect(flights).toHaveLength(2);
    for (const flight of flights) expect(railsOf(doc, flight), flight).toHaveLength(2);
  });

  it.each(["stair", "openStair", "storageStair", "shipsLadder", "alternatingTread"])("a %s has them", (kind) => {
    expect(railsOf(room(place(kind)))).toHaveLength(2);
  });

  it.each(["rungLadder", "spiralStair"])("a %s has none", (kind) => {
    const doc = room(place(kind));
    expect([...flightHandrails(doc).values()].flat()).toEqual([]);
  });

  it("furniture has none", () => {
    const doc = room({ type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 5, y: 3 } });
    expect(flightHandrails(doc).size).toBe(0);
  });

  it("one row per stair, whatever the layouts", () => {
    const doc = room({ type: "addState", opId: "n", name: "Night" }, place());
    expect(Object.values(doc.placements).filter((p) => p.id.startsWith("ps/"))).toHaveLength(2);
    expect(railsOf(doc)).toHaveLength(2);
    expect(flightHandrails(doc).size).toBe(1);
  });
});

describe("how high it runs", () => {
  it("follows the pitch line, 0.90 above it, bending where it levels off", () => {
    const doc = room(place());
    const line = pitch(doc, "ps/s0/p0");
    for (const r of railsOf(doc)) {
      expect(r.knots).toHaveLength(3);
      for (const k of r.knots) expect(k.top).toBeCloseTo(line.at(k.a) + 0.9, 6);
      const [first, bend, last] = r.knots;
      expect(first?.top).toBeLessThan(bend?.top ?? 0);
      expect(bend?.top).toBeCloseTo(last?.top ?? 0, 6); // level past the last nosing
    }
  });

  it("an upper flight's rail follows its own pitch line, from the deck it starts at", () => {
    const doc = room(place("stair", "l-right"));
    for (const p of Object.values(doc.placements)) {
      const line = pitch(doc, p.id);
      const rails = railsOf(doc, p.object);
      for (const k of rails.flatMap((r) => r.knots)) expect(k.top).toBeCloseTo(line.at(k.a) + 0.9, 6);
    }
    const upper = Object.values(doc.placements).find((p) => doc.objects[p.object]?.startsAt);
    expect(railsOf(doc, upper?.object ?? "")[0]?.knots[0]?.top).toBeGreaterThan(1.075 + 0.9);
  });

  it("a partial stretch follows it too, ending where it's open", () => {
    const doc = room(...rightWall(3.5, 5.6), place());
    const line = pitch(doc, "ps/s0/p0");
    const right = railsOf(doc).find((r) => r.x > 0);
    for (const k of right?.knots ?? []) expect(k.top).toBeCloseTo(line.at(k.a) + 0.9, 6);
  });

  it("stops at the ceiling as a guard does, bending where it meets it", () => {
    const doc = room({ type: "setCeiling", height: 2.6 }, place());
    const line = pitch(doc, "ps/s0/p0");
    for (const r of railsOf(doc)) {
      expect(Math.max(...r.knots.map((k) => k.top))).toBeCloseTo(2.6, 6);
      for (const k of r.knots) expect(k.top).toBeCloseTo(Math.min(line.at(k.a) + 0.9, 2.6), 6);
      const meets = r.knots.find((k) => Math.abs(k.top - 2.6) < 1e-6);
      expect(line.at(meets?.a ?? 0) + 0.9).toBeCloseTo(2.6, 6); // the sloped stretch runs up to the ceiling, and no further
    }
  });

  it("a wall up to a lower ceiling counts, the rail reaching only that high", () => {
    expect(railsOf(room({ type: "setCeiling", height: 2.6 }, ...rightWall(), place()))).toHaveLength(1);
  });
});

describe("nothing else changes", () => {
  it("a hole's side along a flight keeps its guard: a handrail doesn't replace it", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 },
      { type: "addDeckHole", opId: "n", deck: LOFT, at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 },
      { type: "placeStair", opId: "ps", state: "s0", kind: "shipsLadder", surface: null, deck: LOFT, at: { x: 1.4, y: 2.55 }, shape: "straight" },
    );
    const along = guardRuns(doc).filter((r) => r.deck === LOFT && Math.abs(r.a.y - 2.25) < 1e-6 && Math.abs(r.b.y - 2.25) < 1e-6);
    expect(along).toHaveLength(1);
    expect(Math.hypot((along[0]?.b.x ?? 0) - (along[0]?.a.x ?? 0), 0)).toBeCloseTo(0.7, 3);
    expect(railsOf(doc)).toHaveLength(2);
  });

  it("nothing is refused: a tall piece stands flush against the open side", () => {
    const doc = room(place(), { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 4, y: 2.55 - 0.6 }, rotation: 180 });
    expect(validateDocument(doc).ok).toBe(true);
    expect(railsOf(doc)).toHaveLength(2);
  });

  it("whatever the fit lets past over a flight clears its rail", () => {
    const doc = room(place());
    const line = pitch(doc, "ps/s0/p0");
    for (const k of railsOf(doc).flatMap((r) => r.knots)) expect(k.top - line.at(k.a)).toBeLessThan(MIN_PASSAGE);
  });

  it("the document stores nothing for them but the stair's setting (guards.28)", () => {
    const doc = room(place());
    expect(JSON.stringify(doc).match(/handrail|knots/gi)).toEqual(["handrail"]);
    expect(validateDocument(doc).ok).toBe(true);
  });
});
