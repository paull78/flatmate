import { describe, expect, it } from "vitest";
import { toMm } from "../src/format";
import { CEILING_ID, type Deck, type Document, sameGuards } from "../src/model";
import { levels, type Level } from "../src/queries/levels";
import { rng, tinyHouse } from "./helpers";

// Random decks under random ceilings: `levels` against a brute-force reference that filters, groups and sorts, and the
// same answer whatever order the decks were added in.

const mm = toMm; // the domain's one millimetre rounding (cleanup.13); the grouping and sorting stay independent

function reference(decks: readonly Deck[], ceiling: number): Level[] {
  const floorCut = mm(Math.min(1.2, ceiling / 2));
  const cutOf = (base: number): number => mm(base / 1000 + Math.min(1.2, (ceiling - base / 1000) / 2)) / 1000;
  const high = decks.filter((d) => mm(d.top) >= floorCut);
  const heights = [...new Set(high.map((d) => mm(d.top)))].sort((a, b) => a - b);
  const upper = heights.map((h): Level => {
    const group = high.filter((d) => mm(d.top) === h).sort((a, b) => (a.id < b.id ? -1 : 1));
    const name = group.map((d) => (d.name.trim() === "" ? "Deck" : d.name)).join(", ");
    return { height: h / 1000, deckIds: group.map((d) => d.id), cut: cutOf(h), name };
  });
  return [{ height: 0, deckIds: [], cut: floorCut / 1000, name: "Floor" }, ...upper];
}

function withDecks(base: Document, decks: readonly Deck[], ceiling: number): Document {
  const doc: Document = { ...base, decks: {}, ceilings: { [CEILING_ID]: { id: CEILING_ID, height: ceiling } } };
  for (const d of decks) doc.decks[d.id] = d;
  return doc;
}

describe("levels fuzz", () => {
  it("equals the brute-force reference and is stable under deck order", () => {
    const rand = rng(20261020);
    const pick = <T,>(xs: readonly T[]): T => {
      const x = xs[Math.floor(rand() * xs.length)];
      if (x === undefined) throw new Error("empty pool");
      return x;
    };
    const house = tinyHouse();
    let upperSeen = 0;
    let sharedSeen = 0;
    for (let run = 0; run < 400; run++) {
      const ceiling = mm(2 + rand() * 1.5) / 1000;
      const pool = [0.45, 1.2, 1.199, 2.15, 2.3, mm(0.15 + rand() * 2.85) / 1000];
      const n = 1 + Math.floor(rand() * 6);
      const decks: Deck[] = [];
      for (let i = 0; i < n; i++) {
        const top = rand() < 0.6 ? pick(pool) + (rand() < 0.3 ? (rand() - 0.5) * 0.0008 : 0) : 0.15 + rand() * 2.85;
        const name = pick(["Loft", "Bunk", "", "Platform"]);
        decks.push({ id: `D${Math.floor(rand() * 90) + 10}_${i}`, name, at: { x: i, y: 1 }, w: 0.8, d: 0.8, rotation: 0, top, solid: rand() < 0.5, finish: null, ...sameGuards("none") });
      }
      const expected = reference(decks, ceiling);
      expect(levels(withDecks(house, decks, ceiling))).toEqual(expected);
      expect(levels(withDecks(house, [...decks].reverse(), ceiling))).toEqual(expected);
      upperSeen += expected.length > 1 ? 1 : 0;
      sharedSeen += expected.some((l) => l.deckIds.length > 1) ? 1 : 0;
    }
    expect(upperSeen).toBeGreaterThan(100); // the inputs reach upper levels…
    expect(sharedSeen).toBeGreaterThan(30); // …and levels shared by several decks
  });
});
