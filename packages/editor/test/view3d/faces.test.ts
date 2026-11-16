import { describe, expect, it } from "vitest";
import { faces3d, itemKey } from "../../src/view3d/faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { DeckItem, FloorItem } from "../../src/view3d/types";
import { turnAngles, visible } from "./visible";

// An item's faces (heights.06, decks.07): a deck is a box from its range, in the floor-like deck shades.

const TURNS: readonly number[] = [0, 1, 2, 3];
/** A loft turned 30°, its ring clockwise, so the prism must reorder it. */
const ring = [
  { x: 1, y: 1 },
  { x: 1 - 0.7, y: 1 + 0.7 * Math.sqrt(3) },
  { x: 1 - 0.7 + Math.sqrt(3), y: 1 + 0.7 * Math.sqrt(3) + 1 },
  { x: 1 + Math.sqrt(3), y: 2 },
];
/** Its slab's edges come counter-clockwise from the domain (stairwell.15), whatever the ring's winding. */
const edges = [...ring].reverse().map((a, i, ccwRing) => ({ a, b: ccwRing[(i + 1) % ccwRing.length] ?? a }));
const loft: DeckItem = { item: "deck", deck: "l/k0", fills: [{ ring, holes: [] }], edges, bottom: 2.03, top: 2.15, selected: false, finish: null };
const edgeKey = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  [a, b].map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join(" ");

describe("faces3d: decks", () => {
  it("a deck becomes a closed prism: a top at its top and the sides facing the camera from bottom to top; over four turns all four sides show", () => {
    const sidesSeen = new Set<string>();
    for (const turn of TURNS) {
      const faces = visible(faces3d(loft), turnAngles(turn));
      expect(faces.length).toBeGreaterThan(0);
      expect(faces.every((f) => f.owner === "deck/l/k0" && f.holes.length === 0)).toBe(true);
      const top = faces.at(-1);
      expect(top?.color).toBe(STYLE_3D.deck.top);
      expect(top?.points.map((p) => p.z)).toEqual([2.15, 2.15, 2.15, 2.15]);
      const sides = faces.slice(0, -1);
      expect(sides).toHaveLength(2); // a box seen from a corner
      for (const s of sides) {
        expect(s.points.map((p) => p.z).sort()).toEqual([2.03, 2.03, 2.15, 2.15]);
        expect([STYLE_3D.deck.lit, STYLE_3D.deck.shaded]).toContain(s.color);
        // Closed: each side's upper edge is an edge of the top, so no gap opens between them.
        const upper = s.points.filter((p) => p.z === 2.15);
        const topEdges = new Set((top?.points ?? []).map((p, i, r) => edgeKey(p, r[(i + 1) % r.length] ?? p)));
        expect(topEdges.has(edgeKey(upper[0] ?? { x: 0, y: 0 }, upper[1] ?? { x: 0, y: 0 }))).toBe(true);
        sidesSeen.add(edgeKey(upper[0] ?? { x: 0, y: 0 }, upper[1] ?? { x: 0, y: 0 }));
      }
    }
    expect(sidesSeen.size).toBe(4);
  });

  it("a selected deck uses the selection blue; its key is its table and id", () => {
    const faces = visible(faces3d({ ...loft, selected: true }), turnAngles(0));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f) => [STYLE_3D.selected.top, STYLE_3D.selected.lit, STYLE_3D.selected.shaded].includes(f.color))).toBe(true);
    expect(itemKey(loft)).toBe("deck/l/k0");
  });
});

describe("faces3d: floors (finishes.12)", () => {
  const ring = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }];
  const plain: FloorItem = { item: "floor", room: "f1", ring, holes: [], color: null, lines: [], shapes: [] };
  const lines = [{ a: { x: 0, y: 0.2 }, b: { x: 3, y: 0.2 }, color: "#a08060" }, { a: { x: 1.2, y: 0 }, b: { x: 1.2, y: 0.2 }, color: "#907050" }];
  const finished: FloorItem = { ...plain, color: "#d8bc94", lines };

  const LIFT = STYLE_3D.patternLift;

  it("the floor face's colour is the finish colour at z 0; its lines sit 1 mm up (shown.04); planks have no shape faces", () => {
    expect(LIFT).toBe(0.001);
    const faces = faces3d(finished);
    expect(faces).toHaveLength(1);
    const [face] = faces;
    expect(face?.color).toBe("#d8bc94");
    expect(face?.points.every((p) => p.z === 0)).toBe(true);
    expect(face?.lines).toEqual(lines.map((l) => ({ a: { ...l.a, z: LIFT }, b: { ...l.b, z: LIFT }, color: l.color })));
  });

  it("a cement-tile floor gives the floor face at z 0, then one face per shape in its colour, 1 mm up", () => {
    const shapes = [
      { ring: [{ x: 0.5, y: 0.2 }, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.6 }, { x: 0.3, y: 0.4 }], holes: [], color: "#b0a080" },
      { ring: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 0.1 }], holes: [], color: "#706050" },
    ];
    const faces = faces3d({ ...finished, shapes });
    expect(faces).toHaveLength(3);
    expect(faces[0]?.points.every((p) => p.z === 0)).toBe(true);
    expect(faces[0]?.outline).toBeUndefined(); // the floor keeps its outline
    expect(faces.slice(1).map((f) => f.color)).toEqual(["#b0a080", "#706050"]);
    for (const f of faces.slice(1)) {
      expect(f.points.every((p) => p.z === LIFT)).toBe(true);
      expect(f.owner).toBe(faces[0]?.owner);
      expect(f.outline).toBe(false); // drawn without an outline, as on the plan (shown.12)
    }
    expect(faces[1]?.points.map((p) => ({ x: p.x, y: p.y }))).toEqual(shapes[0]?.ring);
  });

  it("an unfinished floor keeps the plain floor colour and carries no lines", () => {
    const [face] = faces3d(plain);
    expect(face?.color).toBe(STYLE_3D.floor);
    expect(face?.lines ?? []).toEqual([]);
  });
});

describe("faces3d: a finished deck (deck-floors.02, AC-09)", () => {
  const lines = [{ a: { x: 0.2, y: 0.5 }, b: { x: 1.8, y: 0.5 }, color: "#8a7a66" }];
  const shapes = [{ ring: [{ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.7 }, { x: 0.5, y: 0.9 }, { x: 0.3, y: 0.7 }], holes: [], color: "#998877" }];
  const finished: DeckItem = { ...loft, finish: { color: "#a99c8a", lines, shapes } };
  const LIFT = STYLE_3D.patternLift;
  const flat = (f: { points: readonly { z: number }[] }) => f.points.every((p) => p.z === f.points[0]?.z);

  it("its top takes the finish's colour, with the lines 1 mm above it; its shapes are faces 1 mm up without outlines; its sides keep the deck's shades", () => {
    const faces = faces3d(finished);
    const tops = faces.filter((f) => flat(f) && f.points[0]?.z === 2.15);
    expect(tops).toHaveLength(1);
    expect(tops[0]?.color).toBe("#a99c8a");
    expect(tops[0]?.lines).toEqual([{ a: { x: 0.2, y: 0.5, z: 2.15 + LIFT }, b: { x: 1.8, y: 0.5, z: 2.15 + LIFT }, color: "#8a7a66" }]);
    const raised = faces.filter((f) => flat(f) && f.points[0]?.z === 2.15 + LIFT);
    expect(raised.map((f) => [f.color, f.outline])).toEqual([["#998877", false]]);
    const sides = faces.filter((f) => !flat(f));
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.every((f) => f.color === STYLE_3D.deck.lit || f.color === STYLE_3D.deck.shaded)).toBe(true);
  });

  it("selected, it draws in the selection shades only, as today", () => {
    const faces = faces3d({ ...finished, selected: true });
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f) => [STYLE_3D.selected.top, STYLE_3D.selected.lit, STYLE_3D.selected.shaded].includes(f.color))).toBe(true);
    expect(faces.some((f) => (f.lines ?? []).length > 0)).toBe(false);
  });

  it("unfinished, as today", () => {
    expect(faces3d(loft).find((f) => flat(f) && f.points[0]?.z === 2.15)?.color).toBe(STYLE_3D.deck.top);
  });
});
