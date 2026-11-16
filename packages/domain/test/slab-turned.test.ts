import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { pointInPolygon, signedArea } from "../src/geometry";
import { deckView } from "../src/queries/decks";
import { rectDoc } from "./helpers";

// A hole side within 1 mm of a deck side is flush (fixes AC-14). Holes are stored in plan coordinates to the millimetre, so on
// a turned deck, or an odd-millimetre one, a side meant to be flush lands a fraction of a millimetre off it. These run through
// the commands' rounding, because that's where the near-miss comes from.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const room = (): Document => rectDoc(0, 0, 12, 10);
const loft = (w = 2.4, d = 1.4): Command => ({ type: "addDeck", opId: "k", preset: "loft", at: { x: 5, y: 5 }, w, d });
const NOTCHES: readonly { name: string; at: { x: number; y: number }; w: number; d: number }[] = [
  { name: "east side", at: { x: 5.9, y: 5 }, w: 0.6, d: 0.6 },
  { name: "north side", at: { x: 5, y: 5.4 }, w: 0.6, d: 0.6 },
  { name: "corner", at: { x: 5.55, y: 5.35 }, w: 1.3, d: 0.7 },
];

const turned = (notch: (typeof NOTCHES)[number], rotation: number): Document =>
  run(room(), loft(), { type: "addDeckHole", opId: "h", deck: "k/k0", ...notch }, { type: "setDeck", deckId: "k/k0", rotation });

const deckOf = (doc: Document) => {
  const d = deckView(doc, "k/k0");
  if (!d) throw new Error("no deck");
  return d;
};
const side = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(b.x - a.x, b.y - a.y);

describe.each(NOTCHES)("a flush notch on the $name, turned", (notch) => {
  const turns = Array.from({ length: 360 }, (_, i) => i);

  it("leaves no cell thinner than 1 mm at any of 360 turns", () => {
    for (const rotation of turns) {
      for (const cell of deckOf(turned(notch, rotation)).cells) {
        const thin = Math.min(...cell.map((p, i) => side(p, cell[(i + 1) % cell.length] ?? p)));
        expect(thin, `${rotation}°`).toBeGreaterThan(0.001);
      }
    }
  });

  it("the traced fills cover exactly the slab's area, and no point of the hole, at every turn", () => {
    for (const rotation of turns) {
      const d = deckOf(turned(notch, rotation));
      const area = d.fills.reduce((sum, f) => sum + Math.abs(signedArea(f.ring)) - f.holes.reduce((a, h) => a + Math.abs(signedArea(h)), 0), 0);
      const slab = d.cells.reduce((sum, c) => sum + Math.abs(signedArea(c)), 0);
      expect(area, `${rotation}°`).toBeCloseTo(slab, 6);
      const hole = d.holes[0]?.ring ?? [];
      const middle = { x: hole.reduce((s, p) => s + p.x, 0) / 4, y: hole.reduce((s, p) => s + p.y, 0) / 4 };
      const covered = d.fills.some((f) => pointInPolygon(middle, f.ring) && !f.holes.some((h) => pointInPolygon(middle, h)));
      expect(covered, `${rotation}°`).toBe(false);
    }
  });
});

describe("a slab's traced fills", () => {
  it("an interior hole stays a hole ring, wound against the outer one", () => {
    const doc = run(room(), loft(), { type: "addDeckHole", opId: "h", deck: "k/k0", at: { x: 5, y: 5 }, w: 0.6, d: 0.6 });
    const [fill, ...more] = deckOf(doc).fills;
    expect(more).toEqual([]);
    expect(fill?.holes).toHaveLength(1);
    expect(signedArea(fill?.ring ?? [])).toBeGreaterThan(0);
    expect(signedArea(fill?.holes[0] ?? [])).toBeLessThan(0);
  });

  it("a hole right across the deck splits it into two fills", () => {
    const doc = run(room(), loft(), { type: "addDeckHole", opId: "h", deck: "k/k0", at: { x: 5, y: 5 }, w: 0.6, d: 1.4 });
    expect(deckOf(doc).fills).toHaveLength(2);
  });

  it("two holes touching at a corner keep the slab on each side of them", () => {
    const doc = run(
      room(),
      loft(),
      { type: "addDeckHole", opId: "a", deck: "k/k0", at: { x: 4.7, y: 4.8 }, w: 0.6, d: 0.4 },
      { type: "addDeckHole", opId: "b", deck: "k/k0", at: { x: 5.3, y: 5.2 }, w: 0.6, d: 0.4 },
    );
    const d = deckOf(doc);
    const area = d.fills.reduce((sum, f) => sum + Math.abs(signedArea(f.ring)) - f.holes.reduce((a, h) => a + Math.abs(signedArea(h)), 0), 0);
    expect(area).toBeCloseTo(3.36 - 0.48, 6);
    for (const ring of d.fills.flatMap((f) => [f.ring, ...f.holes])) expect(ring.length).toBeGreaterThanOrEqual(4);
  });

  it("an odd-millimetre deck with a hole half a millimetre past its side has no sliver either", () => {
    const doc = run(room(), loft(2.001, 2.001), { type: "addDeckHole", opId: "h", deck: "k/k0", at: { x: 5.844, y: 5.844 }, w: 0.314, d: 0.314 });
    const d = deckOf(doc);
    const thin = Math.min(...d.cells.flatMap((c) => c.map((p, i) => side(p, c[(i + 1) % c.length] ?? p))));
    expect(thin).toBeGreaterThan(0.001);
    expect(d.fills.flatMap((f) => f.holes)).toEqual([]); // it's a notch, not a hole in the ring
  });
});

describe("a stair on a notch's open side", () => {
  it("a ladder is refused on the open side of a turned deck's notch, wherever along it", () => {
    const notch = NOTCHES[0];
    if (!notch) throw new Error("no notch");
    const doc = turned(notch, 30);
    // The deck's east side in plan, at the notch: 1.2 m along the deck's width, y across it (rotated 30 degrees about its centre).
    const angle = (30 * Math.PI) / 180;
    const planAt = (x: number, y: number) => ({ x: 5 + x * Math.cos(angle) - y * Math.sin(angle), y: 5 + x * Math.sin(angle) + y * Math.cos(angle) });
    for (const across of [-0.2, 0, 0.2]) {
      const r = execute(doc, { type: "placeStair", opId: "lad", state: "s0", kind: "shipsLadder", deck: "k/k0", at: planAt(1.2, across), shape: "straight", surface: null });
      expect(r.ok, `${across}`).toBe(false);
    }
  });

  it("can't hang off a turned deck's open side, as on an unturned one", () => {
    const notch = NOTCHES[0];
    if (!notch) throw new Error("no notch");
    const doc = turned(notch, 30);
    const edges = deckOf(doc).edges;
    // The notch's open side lies on the deck's east side between its two corners: no edge runs across it.
    const opening = deckOf(doc).holes[0]?.ring ?? [];
    const across = edges.filter((e) => {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      return opening.some((p, i) => {
        const q = opening[(i + 1) % opening.length] ?? p;
        return side(p, mid) + side(mid, q) - side(p, q) < 1e-3;
      }) && side(e.a, e.b) > 1.2;
    });
    expect(across).toEqual([]);
  });
});
