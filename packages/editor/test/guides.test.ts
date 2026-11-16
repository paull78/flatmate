import { describe, expect, it } from "vitest";
import { levelOf } from "@fm/domain";
import { alignDelta, alignmentGuides, boxAt, type AxisBox } from "../src/snapping/guides";
import { NO_MODS } from "../src/types";
import { roomDoc, withCommands } from "./builders";

// Alignment guides (direct.13, direct.17; AC-13). A is a wardrobe, 1.2 × 0.6 anchored at (1.53, 3): x 0.93–2.13,
// y 2.4–3.0, its x lines 0.93, 1.53 and 2.13. B is a chair, 0.45 × 0.45 anchored at (2.925, 1.5): x 2.7–3.15,
// y 1.05–1.5. The tolerance is 10 px at zoom 80 (0.125 m) and the grid step 0.2 m.
const A: AxisBox = { minX: 0.93, maxX: 2.13, minY: 2.4, maxY: 3, edges: true };
const B: AxisBox = { minX: 2.7, maxX: 3.15, minY: 1.05, maxY: 1.5, edges: true };
const FLOOR = levelOf(roomDoc(), null); // every piece counts at the floor level
const opts = (mods = {}) => ({ tolerance: 0.125, step: 0.2, mods: { ...NO_MODS, ...mods } });

describe("boxAt", () => {
  it("is the footprint's axis-aligned box: half-sizes swapped at 90°, edges only at right angles", () => {
    expect(boxAt({ x: 2, y: 1 }, 1.2, 0.6, 0)).toEqual({ minX: 1.4, maxX: 2.6, minY: 0.7, maxY: 1.3, edges: true });
    expect(boxAt({ x: 2, y: 1 }, 1.2, 0.6, 270)).toEqual({ minX: 1.7, maxX: 2.3, minY: 0.4, maxY: 1.6, edges: true });
    const odd = boxAt({ x: 2.95, y: 1.275 }, 0.45, 0.45, 30);
    expect(odd.edges).toBe(false);
    expect(odd.maxX - 2.95).toBeCloseTo(0.3074, 4); // (0.45 cos 30° + 0.45 sin 30°) / 2
  });
});

describe("alignDelta (direct.17)", () => {
  it("a left edge within tolerance wins over the grid", () => {
    // B's left edge lands at 0.98, 0.05 from A's 0.93; the grid alone would give −1.8.
    expect(alignDelta(B, { x: -1.72, y: 0 }, [A], opts()).x).toBeCloseTo(-1.77, 9);
  });

  it("nothing within tolerance falls back to the step", () => {
    expect(alignDelta(B, { x: 1, y: 0 }, [A], opts())).toEqual({ x: 1, y: 0 });
  });

  it("an odd-angle box offers its centre only", () => {
    const odd: AxisBox = { minX: 2.95 - 0.3074, maxX: 2.95 + 0.3074, minY: 1.275 - 0.3074, maxY: 1.275 + 0.3074, edges: false };
    // Its left side reaches A's left edge either way; only the centre counts.
    expect(alignDelta(odd, { x: -1.29, y: 0 }, [A], opts()).x).toBeCloseTo(-1.2, 9); // centre 1.66, 0.13 from 1.53
    expect(alignDelta(odd, { x: -1.3, y: 0 }, [A], opts()).x).toBeCloseTo(-1.42, 9); // centre 1.65, 0.12 from 1.53
  });

  it("an odd-angle target offers its centre only", () => {
    const oddA: AxisBox = { ...A, edges: false };
    expect(alignDelta(B, { x: -1.76, y: 0 }, [A], opts()).x).toBeCloseTo(-1.77, 9); // the left edge 0.94 → 0.93
    expect(alignDelta(B, { x: -1.76, y: 0 }, [oddA], opts()).x).toBeCloseTo(-1.8, 9); // B's lines 0.94, 1.165, 1.39: none near 1.53
    expect(alignDelta(B, { x: -1.35, y: 0 }, [oddA], opts()).x).toBeCloseTo(-1.395, 9); // centre 1.575 → 1.53
  });

  it("the nearest line wins, whichever box it is on", () => {
    const C: AxisBox = { minX: 0.5, maxX: 0.96, minY: 0, maxY: 0.4, edges: true }; // its right edge 0.96 is 0.02 from 0.98
    expect(alignDelta(B, { x: -1.72, y: 0 }, [A, C], opts()).x).toBeCloseTo(-1.74, 9);
  });

  it("Ctrl returns the raw delta", () => {
    expect(alignDelta(B, { x: -1.72, y: 0.013 }, [A], opts({ ctrl: true }))).toEqual({ x: -1.72, y: 0.013 });
  });

  it("Shift snaps only along the locked axis", () => {
    const C: AxisBox = { minX: 4.5, maxX: 5, minY: 1.1, maxY: 1.6, edges: true }; // its top 1.6 is 0.05 from B's moved top
    const free = alignDelta(B, { x: -1.72, y: 0.15 }, [A, C], opts());
    expect(free.y).toBeCloseTo(0.1, 9); // without Shift B's top snaps to C's
    const d = alignDelta(B, { x: -1.72, y: 0.15 }, [A, C], opts({ shift: true }));
    expect(d.y).toBe(0);
    expect(d.x).toBeCloseTo(-1.77, 9);
  });
});

describe("alignmentGuides (AC-13)", () => {
  const withChairAt = (x: number) => withCommands(
    roomDoc(),
    { type: "placeObject", deck: null, opId: "wr", state: "s0", object: { kind: "wardrobe" }, at: { x: 1.53, y: 3 } },
    { type: "placeObject", deck: null, opId: "ch", state: "s0", object: { kind: "chair" }, at: { x, y: 1.5 } },
  );

  it("lands within 2 mm", () => {
    const guides = alignmentGuides(withChairAt(1.155), ["ch/p0"], "s0", FLOOR); // the chair's left edge at 0.93
    expect(guides).toHaveLength(1);
    const [g] = guides;
    const ends = g ? [g.a, g.b].sort((p, q) => p.y - q.y) : [];
    expect(ends[0]?.x).toBeCloseTo(0.93, 6);
    expect(ends[0]?.y).toBeCloseTo(1.05, 6);
    expect(ends[1]?.x).toBeCloseTo(0.93, 6);
    expect(ends[1]?.y).toBeCloseTo(3, 6);
    const [near] = alignmentGuides(withChairAt(1.156), ["ch/p0"], "s0", FLOOR); // the left edge at 0.931, 1 mm off
    expect(near?.a.x).toBeCloseTo(0.931, 6);
    expect(alignmentGuides(withChairAt(1.16), ["ch/p0"], "s0", FLOOR)).toEqual([]); // the left edge at 0.935
  });

  it("a horizontal guide spans the moved box and every box on its line", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", deck: null, opId: "wr", state: "s0", object: { kind: "wardrobe" }, at: { x: 1.53, y: 3 } },
      { type: "placeObject", deck: null, opId: "ch", state: "s0", object: { kind: "chair" }, at: { x: 2.925, y: 2.4 } }, // top 2.4, A's bottom
      { type: "placeObject", deck: null, opId: "c2", state: "s0", object: { kind: "chair" }, at: { x: 4.5, y: 2.85 } }, // x 4.275–4.725, bottom 2.4
    );
    const guides = alignmentGuides(doc, ["ch/p0"], "s0", FLOOR);
    expect(guides).toHaveLength(1);
    const [g] = guides;
    const ends = g ? [g.a, g.b].sort((p, q) => p.x - q.x) : [];
    expect(ends[0]?.x).toBeCloseTo(0.93, 6);
    expect(ends[0]?.y).toBeCloseTo(2.4, 6);
    expect(ends[1]?.x).toBeCloseTo(4.725, 6);
    expect(ends[1]?.y).toBeCloseTo(2.4, 6);
  });

  it("only pieces of the given layout count", () => {
    expect(alignmentGuides(withChairAt(1.155), ["ch/p0"], "other", FLOOR)).toEqual([]);
  });
});
