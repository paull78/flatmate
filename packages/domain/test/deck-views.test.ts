import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import type { Point } from "@fm/protocol";
import { carriedBy, deckUnder, deckView, deckViews, insideDeck } from "../src/queries/decks";
import { deckRange, solids } from "../src/queries/vertical";
import { distanceToSegment, pointInPolygon } from "../src/geometry";
import { place, rng, tinyHouse, withDeck } from "./helpers";

// deckViews is the one place a deck row becomes a ring and a range (decks.16); deckUnder, insideDeck and carriedBy
// read them.

const closeTo = (ring: readonly Point[]): unknown => ring.map((p) => ({ x: expect.closeTo(p.x, 9), y: expect.closeTo(p.y, 9) }));
const house = tinyHouse();

describe("deckViews", () => {
  it("ring and range for a solid and a hollow deck, unrotated and turned 90° and 30°", () => {
    let doc = withDeck(house, { id: "solid", at: [1, 2], w: 2, d: 1, top: 0.45, solid: true });
    doc = withDeck(doc, { id: "hollow", at: [1, 2], w: 2, d: 1, rotation: 90, top: 2.15, solid: false, finish: null, ...sameGuards("railing") });
    doc = withDeck(doc, { id: "turned", at: [0, 0], w: 2, d: 1, rotation: 30, top: 1, solid: false, finish: null, ...sameGuards("railing") });
    expect(deckViews(doc).map((v) => v.id)).toEqual(["hollow", "solid", "turned"]); // sorted by ID
    const solid = deckView(doc, "solid");
    expect(solid?.ring).toEqual(closeTo([{ x: 0, y: 1.5 }, { x: 2, y: 1.5 }, { x: 2, y: 2.5 }, { x: 0, y: 2.5 }]));
    expect(solid?.range).toEqual({ bottom: 0, top: 0.45 });
    expect(solid?.name).toBe("solid");
    const hollow = deckView(doc, "hollow");
    // counter-clockwise from the corner at (−w/2, −d/2) before turning
    expect(hollow?.ring).toEqual(closeTo([{ x: 1.5, y: 1 }, { x: 1.5, y: 3 }, { x: 0.5, y: 3 }, { x: 0.5, y: 1 }]));
    expect(hollow?.range.bottom).toBeCloseTo(2.03, 9);
    expect(hollow?.range.top).toBe(2.15);
    const c = Math.cos(Math.PI / 6);
    const s = 0.5;
    const turned = (x: number, y: number): Point => ({ x: x * c - y * s, y: x * s + y * c });
    expect(deckView(doc, "turned")?.ring).toEqual(closeTo([turned(-1, -0.5), turned(1, -0.5), turned(1, 0.5), turned(-1, 0.5)]));
  });

  it("is memoised by document; deckView answers null for an unknown deck", () => {
    const doc = withDeck(house, { id: "k", at: [4, 1] });
    expect(deckViews(doc)).toBe(deckViews(doc));
    expect(deckViews({ ...doc })).not.toBe(deckViews(doc));
    expect(deckView(doc, "nope")).toBeNull();
    expect(deckView(doc, "constructor")).toBeNull();
  });

  it("deckRange: [0, top] when solid, [top − 0.12, top] when hollow", () => {
    expect(deckRange({ top: 0.45, solid: true })).toEqual({ bottom: 0, top: 0.45 });
    const r = deckRange({ top: 0.45, solid: false });
    expect(r.bottom).toBeCloseTo(0.33, 9);
    expect(r.top).toBe(0.45);
  });

  it("solids lists decks after walls and before placements, with no state", () => {
    const doc = place(withDeck(house, { id: "k", at: [4.5, 1.25], top: 2.15, solid: false }), { object: "c", kind: "chair", at: [6, 1] });
    const tables = solids(doc).map((s) => s.key.table);
    expect(tables).toEqual([...tables.filter((t) => t === "walls"), "decks", "placements"]);
    const deck = solids(doc).find((s) => s.key.table === "decks");
    expect(deck).toMatchObject({ key: { table: "decks", id: "k" }, state: null, box: { minX: 3.5, maxX: 5.5 } });
    expect(deck?.range.bottom).toBeCloseTo(2.03, 9);
    expect(deck?.ring).toEqual(deckView(doc, "k")?.ring);
  });
});

describe("deckUnder", () => {
  // Two decks sharing the edge x = 4: A x 3–4, B x 4–5.
  const both = (a: { top: number; id?: string }, b: { top: number; id?: string }): ReturnType<typeof withDeck> =>
    withDeck(withDeck(house, { id: a.id ?? "a", at: [3.5, 1.25], w: 1, d: 1, top: a.top }), { id: b.id ?? "b", at: [4.5, 1.25], w: 1, d: 1, top: b.top });

  it("finds the deck holding a point, within the tolerance, and null over the floor", () => {
    const doc = both({ top: 0.45 }, { top: 0.3 });
    expect(deckUnder(doc, { x: 3.2, y: 1.25 })?.id).toBe("a");
    expect(deckUnder(doc, { x: 4.8, y: 1.25 })?.id).toBe("b");
    expect(deckUnder(doc, { x: 3.2, y: 1.75 + 0.0005 })?.id).toBe("a");
    expect(deckUnder(doc, { x: 3.2, y: 1.75 + 0.002 })).toBeNull();
    expect(deckUnder(doc, { x: 6, y: 1.25 })).toBeNull();
  });

  it("ties on a shared edge: the higher top wins, then the lower ID", () => {
    const edge = { x: 4, y: 1.25 };
    expect(deckUnder(both({ top: 0.45 }, { top: 0.6 }), edge)?.id).toBe("b");
    expect(deckUnder(both({ top: 0.6 }, { top: 0.45 }), edge)?.id).toBe("a");
    expect(deckUnder(both({ top: 0.45, id: "z" }, { top: 0.45, id: "m" }), edge)?.id).toBe("m");
    expect(deckUnder(both({ top: 0.45, id: "m" }, { top: 0.45, id: "z" }), edge)?.id).toBe("m");
  });
});

describe("insideDeck", () => {
  const doc = withDeck(house, { id: "k", at: [4.5, 1.25], w: 2, d: 1.4 }); // x 3.5–5.5, y 0.55–1.95
  const view = deckView(doc, "k");
  const square = (x0: number, x1: number): Point[] => [{ x: x0, y: 1 }, { x: x1, y: 1 }, { x: x1, y: 1.5 }, { x: x0, y: 1.5 }];

  it("allows a ring up to the tolerance outside an edge and refuses one 2 mm out", () => {
    if (!view) throw new Error("no deck");
    expect(insideDeck(view, [square(4, 5)])).toBe(true);
    expect(insideDeck(view, [square(4.5, 5.5)])).toBe(true); // flush
    expect(insideDeck(view, [square(4.5, 5.5005)])).toBe(true);
    expect(insideDeck(view, [square(3.4995, 4)])).toBe(true);
    expect(insideDeck(view, [square(4.5, 5.502)])).toBe(false);
    expect(insideDeck(view, [square(3.498, 4)])).toBe(false);
  });

  it("holds for a turned deck", () => {
    const turned = deckView(withDeck(house, { id: "k", at: [4.5, 1.25], w: 2, d: 1.4, rotation: 90 }), "k"); // x 3.8–5.2, y 0.25–2.25
    if (!turned) throw new Error("no deck");
    expect(insideDeck(turned, [square(4, 5)])).toBe(true);
    expect(insideDeck(turned, [square(3.6, 5)])).toBe(false);
  });
});

describe("insideDeck against pointInPolygon (random)", () => {
  it("agrees for points more than 2 mm from every edge, for decks turned by any whole degree", () => {
    const next = rng(18);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const at: [number, number] = [next() * 6, next() * 3];
      const doc = withDeck(house, { id: "k", at, w: 0.3 + next() * 3, d: 0.3 + next() * 3, rotation: Math.floor(next() * 360) });
      const view = deckView(doc, "k");
      if (!view) throw new Error("no deck");
      for (let j = 0; j < 20; j++) {
        const p = { x: at[0] + (next() - 0.5) * 5, y: at[1] + (next() - 0.5) * 5 };
        const near = view.ring.some((a, k) => distanceToSegment(p, a, view.ring[(k + 1) % 4] ?? a) <= 0.002);
        if (near) continue;
        checked++;
        expect(insideDeck(view, [[p]]), JSON.stringify({ i, j })).toBe(pointInPolygon(p, view.ring));
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe("carriedBy", () => {
  it("lists the placements standing on a deck, by layout order, then by ID", () => {
    let doc = withDeck(house, { id: "k", at: [4.5, 1.25], w: 2, d: 1.4 });
    doc = { ...doc, states: { night: { id: "night", name: "Night", order: 1 }, day: { id: "day", name: "Day", order: 0 } } };
    doc = place(doc, { object: "b", kind: "chair", at: [4, 1.5], state: "night", deck: "k" });
    doc = place(doc, { object: "a", kind: "chair", at: [4, 1.5], state: "night", deck: "k" });
    doc = place(doc, { object: "c", kind: "chair", at: [5, 1.5], state: "day", deck: "k" });
    doc = place(doc, { object: "d", kind: "chair", at: [6, 1.5], state: "day" });
    expect(carriedBy(doc, "k").map((p) => p.id)).toEqual(["c/day", "a/night", "b/night"]);
    expect(carriedBy(doc, "other")).toEqual([]);
  });
});
