import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import type { Point } from "@fm/protocol";
import { inConvex, signedArea } from "../src/geometry";
import type { Deck, DeckHole } from "../src/model";
import { deckFrame, slabView } from "../src/queries/decks";
import { rng } from "./helpers";

// The slab against a brute-force oracle (stairwell.15): random decks (off the grid, turned) with random holes that
// don't overlap (notches against a side, holes touching each other), built through slabView as the rules see them.
// Sampled in the deck's frame: a point is in a cell exactly when it is in the rectangle and strictly in no hole; the
// cells' area is the rectangle's less the holes'; every edge has slab 0.1 mm inside and none 0.1 mm outside (holes may be 1 mm apart).

type Rect = { x0: number; y0: number; x1: number; y1: number };
const mm = (v: number): number => Math.round(v * 1000) / 1000;
const CASES = 500;

function randomCase(next: () => number): { deck: Deck; holes: DeckHole[]; rects: Rect[] } {
  const w = mm(0.6 + next() * 3.4);
  const d = mm(0.6 + next() * 3.4);
  const deck: Deck = { id: "k/k0", name: "Deck", at: { x: mm(next() * 8 - 4), y: mm(next() * 8 - 4) }, w, d, rotation: Math.floor(next() * 360), top: 2.15, solid: false, finish: null, ...sameGuards("railing") };
  const rects: Rect[] = [];
  for (let tries = 0; tries < 12 && rects.length < 4; tries++) {
    const hw = mm(0.3 + next() * (w - 0.3) * 0.6);
    const hd = mm(0.3 + next() * (d - 0.3) * 0.6);
    let x0 = mm(-w / 2 + next() * (w - hw));
    let y0 = mm(-d / 2 + next() * (d - hd));
    const snap = next();
    if (snap < 0.25) x0 = -w / 2; // a notch on the west side
    else if (snap < 0.4) y0 = d / 2 - hd; // a notch on the north side
    else if (snap < 0.6 && rects.length > 0) x0 = rects[rects.length - 1]?.x1 ?? x0; // touching the last hole
    const r = { x0, y0, x1: x0 + hw, y1: y0 + hd };
    if (r.x1 > w / 2 + 1e-9 || r.y1 > d / 2 + 1e-9) continue;
    // Sides within 1 mm count as one line (fixes AC-14): slab-turned.test.ts has those, and this oracle reads rectangles as drawn.
    const xs = [-w / 2, w / 2, ...rects.flatMap((o) => [o.x0, o.x1])];
    const ys = [-d / 2, d / 2, ...rects.flatMap((o) => [o.y0, o.y1])];
    const nearMiss = (v: number, seen: readonly number[]): boolean => seen.some((l) => Math.abs(l - v) > 1e-9 && Math.abs(l - v) < 0.0015);
    if (nearMiss(r.x0, xs) || nearMiss(r.x1, xs) || nearMiss(r.y0, ys) || nearMiss(r.y1, ys)) continue;
    if (rects.some((o) => r.x0 < o.x1 - 1e-9 && r.x1 > o.x0 + 1e-9 && r.y0 < o.y1 - 1e-9 && r.y1 > o.y0 + 1e-9)) continue;
    rects.push(r);
  }
  const frame = deckFrame(deck);
  const holes = rects.map((r, i) => ({ id: `h${i}/h0`, deck: deck.id, at: frame.toPlan({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }), w: r.x1 - r.x0, d: r.y1 - r.y0, guard: { kind: "railing" as const, height: 1 } }));
  return { deck, holes, rects };
}

describe("the slab against sampling", () => {
  it(`${CASES} random decks with holes: cells, area and edges agree with the oracle`, () => {
    const next = rng(4242);
    let notches = 0;
    let touching = 0;
    for (let n = 0; n < CASES; n++) {
      const { deck, holes, rects } = randomCase(next);
      const view = slabView(deck, holes);
      const frame = deckFrame(deck);
      const inRect = (q: Point): boolean => Math.abs(q.x) <= deck.w / 2 && Math.abs(q.y) <= deck.d / 2;
      const inHole = (q: Point): boolean => rects.some((r) => q.x > r.x0 && q.x < r.x1 && q.y > r.y0 && q.y < r.y1);
      const onSlab = (q: Point): boolean => inRect(q) && !inHole(q);
      const inCell = (p: Point): boolean => view.cells.some((c) => inConvex(p, c, 1e-9));
      const label = JSON.stringify({ deck, rects });

      // Cells: convex counter-clockwise rectangles, their area the rectangle's less the holes'.
      for (const c of view.cells) expect(signedArea(c), label).toBeGreaterThan(0);
      const area = view.cells.reduce((s, c) => s + signedArea(c), 0);
      expect(area, label).toBeCloseTo(deck.w * deck.d - rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0), 9);

      // Points: in a cell exactly when on the slab, away from any boundary line.
      const lines = { xs: [-deck.w / 2, deck.w / 2, ...rects.flatMap((r) => [r.x0, r.x1])], ys: [-deck.d / 2, deck.d / 2, ...rects.flatMap((r) => [r.y0, r.y1])] };
      for (let k = 0; k < 60; k++) {
        const q = { x: (next() - 0.5) * (deck.w + 0.4), y: (next() - 0.5) * (deck.d + 0.4) };
        if (lines.xs.some((x) => Math.abs(q.x - x) < 1e-6) || lines.ys.some((y) => Math.abs(q.y - y) < 1e-6)) continue;
        expect(inCell(frame.toPlan(q)), `${label} at ${JSON.stringify(q)}`).toBe(onSlab(q));
      }

      // Edges: slab 0.1 mm inside the middle, none 0.1 mm outside.
      for (const e of view.edges) {
        const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
        const at = (k: number): Point => frame.toDeck({ x: mid.x + e.normal.x * k, y: mid.y + e.normal.y * k });
        expect(onSlab(at(-0.0001)), `${label} inside ${JSON.stringify(e)}`).toBe(true);
        expect(onSlab(at(0.0001)), `${label} outside ${JSON.stringify(e)}`).toBe(false);
      }
      if (rects.some((r) => Math.abs(r.x0 + deck.w / 2) < 1e-9 || Math.abs(r.y1 - deck.d / 2) < 1e-9)) notches++;
      if (rects.some((r, i) => rects.some((o, j) => i !== j && Math.abs(r.x1 - o.x0) < 1e-9))) touching++;
    }
    // The generator reaches the cases that matter.
    expect(notches).toBeGreaterThan(50);
    expect(touching).toBeGreaterThan(20);
  });
});
