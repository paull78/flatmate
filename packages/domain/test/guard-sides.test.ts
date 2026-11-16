import { describe, expect, it } from "vitest";
import { emptyDocument, execute, guardRuns, missingGuards, rectangleRoom, type Command, type Document, type GuardRun } from "../src";

// Each open stretch takes the guard of the side it lies on, at that guard's height, and a wall closes a stretch only if
// it is as tall as that stretch's guard (edges.01, .02; AC-01, AC-03).

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
/** An 8 × 6 room, 3.05 ceiling, a free 2 × 2 loft at (4, 3), top 2.15: every side open (x 3–5, y 2–4). */
const room = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 4, y: 3 }, w: 2, d: 2, top: 2.15 },
  ...more,
);
/** A floor wall whose face touches the loft's right side (x 5), standing from the floor to `top` metres. */
const kneeWall = (top: number): Command[] => [
  { type: "addWall", opId: "w", from: { at: { x: 5.1, y: 1.5 } }, to: { at: { x: 5.1, y: 4.5 } } },
  { type: "setWallTop", wallId: "w/w0", top },
];
const runs = (doc: Document): readonly GuardRun[] => guardRuns(doc).filter((r) => r.deck === LOFT);
const sideRuns = (doc: Document, side: string): GuardRun[] => runs(doc).filter((r) => r.side === side);
const len = (r: GuardRun): number => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);

describe("a guard per side (AC-01)", () => {
  it("every run says its side, and a free loft has one on each", () => {
    const doc = room();
    expect(runs(doc).map((r) => r.side).sort()).toEqual(["back", "front", "left", "right"]);
    expect(runs(doc).every((r) => r.hole === null)).toBe(true);
  });

  it("front Railing and right None: a rail along the front, none along the right", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guardFront: { kind: "railing" }, guardRight: { kind: "none" } });
    expect(sideRuns(doc, "right")).toEqual([]);
    expect(sideRuns(doc, "front").map(len)).toEqual([2]);
    expect(sideRuns(doc, "front")[0]?.kind).toBe("railing");
  });

  it("each side draws its own kind", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guardLeft: { kind: "glass" } });
    expect(sideRuns(doc, "left")[0]?.kind).toBe("glass");
    expect(sideRuns(doc, "back")[0]?.kind).toBe("railing");
  });

  it("a turned loft's runs keep their sides' guards", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guardRight: { kind: "glass" } }, { type: "setDeck", deckId: LOFT, rotation: 90 });
    const right = sideRuns(doc, "right");
    expect(right.map((r) => r.kind)).toEqual(["glass"]);
    // turned 90°, the stored right side is the upper one on the plan: y = 4
    expect(right[0]?.a.y).toBeCloseTo(4, 6);
    expect(right[0]?.b.y).toBeCloseTo(4, 6);
  });
});

describe("a guard's height (AC-03)", () => {
  it("a 0.30 side's run tops at the deck's top + 0.30; the others at + 1.00 or the ceiling", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guardBack: { height: 0.3 } });
    expect(sideRuns(doc, "back")[0]?.bottom).toBe(2.15);
    expect(sideRuns(doc, "back")[0]?.top).toBeCloseTo(2.45, 9);
    expect(sideRuns(doc, "front")[0]?.top).toBeCloseTo(3.05, 6); // 2.15 + 1.00 is above the ceiling
  });

  it("a 0.40 wall closes a 0.30 side, and leaves a 1.00 side open", () => {
    const low = room(...kneeWall(2.55), { type: "setDeck", deckId: LOFT, guardRight: { height: 0.3 } });
    expect(sideRuns(low, "right")).toEqual([]);
    const tall = room(...kneeWall(2.55));
    expect(sideRuns(tall, "right").map(len)).toEqual([2]);
  });

  it("a side's run stops at a low ceiling", () => {
    const doc = room({ type: "setCeiling", height: 2.5 }, { type: "setDeck", deckId: LOFT, guardFront: { height: 0.8 } });
    expect(sideRuns(doc, "front")[0]?.top).toBeCloseTo(2.5, 6);
  });
});

describe("a warning per unguarded side or hole (edges.04, AC-06)", () => {
  const hole: Command = { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 4, y: 3 }, w: 0.8, d: 0.8 };
  const holeNone: Command = { type: "setDeckHole", holeId: "h/h0", guard: { kind: "none" } };

  it("the right side and the hole set to None: two warnings, each at its own stretch's middle", () => {
    const doc = room(hole, holeNone, { type: "setDeck", deckId: LOFT, guardRight: { kind: "none" } });
    const found = missingGuards(doc);
    expect(found.map((m) => [m.side, m.hole, m.plan])).toEqual([["right", null, "right"], [null, "h/h0", null]]);
    expect(found[0]?.at).toEqual({ x: 5, y: 3 });
    // the hole's longest open stretch: its first side in boundary order, 0.80 long
    const holeMark = found[1]?.at;
    expect(holeMark && Math.abs(Math.abs(holeMark.x - 4) + Math.abs(holeMark.y - 3) - 0.4)).toBeLessThan(1e-9);
  });

  it("setting the right side to a 0.30 Railing removes its warning and leaves the hole's", () => {
    const doc = room(hole, holeNone, { type: "setDeck", deckId: LOFT, guardRight: { kind: "railing", height: 0.3 } });
    expect(missingGuards(doc).map((m) => m.hole)).toEqual(["h/h0"]);
  });

  it("a deck set to None on all four warns four times, once per side, named by where each faces now", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guard: "none" });
    expect(missingGuards(doc).map((m) => m.plan).sort()).toEqual(["left", "lower", "right", "upper"]);
  });

  it("a None side wholly against a wall as tall doesn't warn", () => {
    const doc = room(...kneeWall(3.05), { type: "setDeck", deckId: LOFT, guardRight: { kind: "none" } });
    expect(missingGuards(doc)).toEqual([]);
  });

  it("a 0.45 platform's None sides don't warn, and a low guard never does", () => {
    const platform = build(...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "addDeck", opId: "p", preset: "platform", at: { x: 4, y: 3 }, w: 2, d: 2 });
    expect(missingGuards(platform)).toEqual([]);
    expect(missingGuards(room({ type: "setDeck", deckId: LOFT, guardRight: { height: 0.3 } }))).toEqual([]);
  });
});
