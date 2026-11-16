import { describe, expect, it } from "vitest";
import { deckViews, emptyDocument, execute, guardRuns, rectangleRoom, spiralRails, stairChecks, stairOnEdge, validateDocument, type Command, type Document, type Placement } from "../src";
import { rng } from "./helpers";

// A spiral near the end of a deck's edge: its way off is its landing's back side, so that side has to stay on the edge. The loft is
// at x 0.5–4.5, y 2.5–6.5; on its east edge a 1.60 spiral turns to 90°, and its landing's back side runs up the edge from `at` by
// 0.80. So on that edge `at` is good from y 2.5 to y 5.7. In the treads' frame the back side is y 0.8, and its rail would be at 0.78.

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
  ...rectangleRoom({ x: 0, y: 0 }, 11, 9, "c"), { type: "setCeiling", height: 3.4 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 2.5, y: 4.5 }, w: 4, d: 4 },
  ...more,
);
const spiralAt = (x: number, y: number, kind = "spiralStair"): Command => ({ type: "placeStair", opId: "sp", state: "s0", kind, surface: null, deck: LOFT, at: { x, y }, shape: "straight" });
const placementOf = (doc: Document): Placement => {
  const p = Object.values(doc.placements).find((q) => q.state === "s0");
  if (!p) throw new Error("no placement");
  return p;
};
const reach = (doc: Document): boolean | undefined => stairChecks(doc, placementOf(doc).object).find((c) => c.id === "reach")?.ok;
const backRails = (doc: Document) => [...spiralRails(doc).values()].flatMap((s) => s.landing).filter((r) => r.a.y > 0.7 && r.b.y > 0.7);
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const eastRuns = (doc: Document): number[][] => guardRuns(doc).filter((r) => Math.abs(r.a.x - 4.5) < 1e-6 && Math.abs(r.b.x - 4.5) < 1e-6).map((r) => [r3(r.a.y), r3(r.b.y)]);

describe("a spiral caught near an edge's end", () => {
  it.each([
    { name: "past the corner", y: 6.5 },
    { name: "with 0.10 of the back on the edge", y: 6.4 },
    { name: "with 0.50 of it", y: 6 },
  ])("$name, it moves along the edge until its landing's back is whole on it", ({ y }) => {
    const doc = room(spiralAt(4.5, y));
    const p = placementOf(doc);
    expect(p.at).toEqual({ x: 4.5, y: 5.7 });
    expect(p.rotation).toBe(90);
    expect(validateDocument(doc).ok).toBe(true);
    expect(reach(doc)).toBe(true);
    expect(backRails(doc)).toEqual([]);
    expect(eastRuns(doc)).toEqual([[2.5, 5.7]]);
  });

  it("at the end the back's left half overhangs it stays where it's asked, with the landing's whole width open", () => {
    const doc = room(spiralAt(4.5, 2.6));
    expect(placementOf(doc).at).toEqual({ x: 4.5, y: 2.6 });
    expect(reach(doc)).toBe(true);
    expect(backRails(doc)).toEqual([]);
    expect(eastRuns(doc)).toEqual([[2.5, 2.6], [3.4, 6.5]]);
  });

  it("a point the whole landing fits from stays where it's asked", () => {
    for (const y of [3, 4.5, 5.7]) expect(placementOf(room(spiralAt(4.5, y))).at).toEqual({ x: 4.5, y });
  });

  it("the exact corner goes to the edge the tie picks, and its landing's back is on that one too", () => {
    const doc = room(spiralAt(4.5, 2.5));
    const p = placementOf(doc);
    expect(p.rotation).toBe(0);
    expect(p.at).toEqual({ x: 3.7, y: 2.5 });
    expect(reach(doc)).toBe(true);
    expect(backRails(doc)).toEqual([]);
  });

  it("an edge just as long as the stair is wide still takes it, in its middle", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 11, 9, "c"), { type: "setCeiling", height: 3.4 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 2.5, y: 4.5 }, w: 4, d: 1.6 }, // y 3.7–5.3
    );
    const parts = stairOnEdge(doc, { state: "s0", kind: "spiralStair", deck: LOFT, at: { x: 4.5, y: 5.3 }, shape: "straight", surface: null });
    if (!parts.ok) throw new Error(parts.error);
    expect(parts.value.flights[0]?.at).toEqual({ x: 4.5, y: 4.5 });
  });

  it("on a hole's side, where the stair hangs into the hole, the landing stays on that side too", () => {
    const hole: Command = { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 2.5, y: 4.5 }, w: 2, d: 2 }; // x 1.5–3.5, y 3.5–5.5
    const doc = room(hole, spiralAt(3.4, 5.5));
    const p = placementOf(doc);
    expect(p.rotation).toBe(0);
    expect(p.at).toEqual({ x: 2.7, y: 5.5 });
    expect(reach(doc)).toBe(true);
    expect(backRails(doc)).toEqual([]);
  });

  it("a flight is left where it's asked: it has no landing, and only its back's middle has to be on the edge", () => {
    const doc = room(spiralAt(4.5, 6.2, "stair"));
    expect(placementOf(doc).at).toEqual({ x: 4.5, y: 6.2 });
    expect(reach(doc)).toBe(true);
  });
});

describe("a spiral whose landing leaves the edge doesn't reach its deck", () => {
  const move = (y: number): Command => ({ type: "movePlacements", moves: [{ placementId: "sp/s0/p0", at: { x: 4.5, y }, rotation: 90 }] });

  it.each([
    { name: "the back's end on the deck's corner", y: 5.7, ok: true },
    { name: "1 cm past it", y: 5.71, ok: false },
    { name: "0.50 of the back on the edge", y: 6, ok: false },
    { name: "`at` on the corner", y: 6.5, ok: false },
  ])("moved along the edge, $name: reach is $ok", ({ y, ok }) => {
    expect(reach(room(spiralAt(4.5, 5.7), move(y)))).toBe(ok);
  });

  it("the deck shrunk from under the landing warns, and grown back it doesn't", () => {
    const shrink: Command = { type: "setDeck", deckId: LOFT, at: { x: 2.5, y: 4.1 }, d: 3.2 }; // y 2.5–5.7
    const grow: Command = { type: "setDeck", deckId: LOFT, at: { x: 2.5, y: 4.5 }, d: 4 };
    expect(reach(room(spiralAt(4.5, 5.7), shrink))).toBe(false);
    expect(reach(room(spiralAt(4.5, 5.7), shrink, grow))).toBe(true);
  });

  it("a flight moved the same way still reaches: the rule is the landing's", () => {
    expect(reach(room(spiralAt(4.5, 5.7, "stair"), move(6.4)))).toBe(true);
  });

  it("a smaller spiral's landing is its own width", () => {
    const smaller: Command = { type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair", size: { w: 1.4, d: 1.4 } }, at: { x: 4.5, y: 5.8 }, rotation: 90, deck: null, reaches: LOFT };
    const placed = room(smaller);
    expect(reach(placed)).toBe(true); // its landing's back runs up to y 6.5
    const moved = execute(placed, { type: "movePlacements", moves: [{ placementId: placementOf(placed).id, at: { x: 4.5, y: 5.9 }, rotation: 90 }] });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(reach(moved.value.doc)).toBe(false);
  });
});

describe("wherever a spiral catches, on a turned deck too", () => {
  it("its landing's back is on the edge: reach holds, no rail on the back, and the guard's gap is the landing's width", () => {
    const r = rng(20261105);
    let placed = 0;
    for (let trial = 0; trial < 200; trial++) {
      const rotation = Math.floor(r() * 360);
      const [w, d] = [1.7 + Math.round(r() * 1500) / 1000, 1.7 + Math.round(r() * 1500) / 1000];
      const base = build(
        ...rectangleRoom({ x: 0, y: 0 }, 16, 16, "c"), { type: "setCeiling", height: 3.4 },
        { type: "addDeck", opId: "l", preset: "loft", at: { x: 8 + r(), y: 8 + r() }, w, d, rotation },
      );
      const deck = deckViews(base)[0];
      const edge = deck?.edges[Math.floor(r() * (deck?.edges.length ?? 0))];
      if (!deck || !edge) throw new Error("no edge");
      const t = r();
      const at = { x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t };
      const result = execute(base, { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at, shape: "straight" });
      if (!result.ok) throw new Error(`trial ${trial}: ${result.error.message}`);
      const doc = result.value.doc;
      placed++;
      expect({ trial, reach: reach(doc) }).toEqual({ trial, reach: true });
      expect({ trial, back: backRails(doc) }).toEqual({ trial, back: [] });
      const span = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(b.x - a.x, b.y - a.y);
      const perimeter = deck.edges.reduce((sum, e) => sum + span(e.a, e.b), 0);
      const guarded = guardRuns(doc).reduce((sum, g) => sum + span(g.a, g.b), 0);
      // The gap is the landing's width, or up to MIN_RUN (0.02) more where it leaves a stub too short to be a run.
      expect(perimeter - guarded, `trial ${trial}`).toBeGreaterThan(0.797);
      expect(perimeter - guarded, `trial ${trial}`).toBeLessThan(0.823);
    }
    expect(placed).toBe(200);
  });
});
