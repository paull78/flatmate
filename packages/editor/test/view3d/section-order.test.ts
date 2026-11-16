import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { farToNear, type Solid } from "../../src/view3d/section-order";

// The order of what lies past a section's plane (AC-07), far to near, on rings in the picture's frame: x along the line
// and y the depth away from it.

const box = (x0: number, x1: number, y0: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** A bar from (x0, y0) to (x1, y1), 0.1 thick in y. */
const slant = (x0: number, y0: number, x1: number, y1: number): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x1, y: y1 + 0.1 }, { x: x0, y: y0 + 0.1 }];
const solid = (key: string, ring: Point[], bottom = 0, top = 1): Solid => {
  const xs = ring.map((p) => p.x);
  return { key, rings: [ring], spans: [[Math.min(...xs), Math.max(...xs)]], bottom, top };
};
const keys = (solids: readonly Solid[]): string[] => farToNear(solids).order.map((s) => s.key);
const permutations = <T,>(list: readonly T[]): T[][] => (list.length < 2 ? [[...list]] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));

describe("far to near", () => {
  it("draws the farther first, whichever comes first in the input and whichever way the names sort", () => {
    const near = (key: string): Solid => solid(key, box(0, 2, 1, 2));
    const far = (key: string): Solid => solid(key, box(0, 2, 3, 4));
    expect(keys([near("a"), far("b")])).toEqual(["b", "a"]);
    expect(keys([far("b"), near("a")])).toEqual(["b", "a"]);
    expect(keys([near("b"), far("a")])).toEqual(["a", "b"]);
    expect(keys([far("a"), near("b")])).toEqual(["a", "b"]);
  });

  it("a long slanted bar behind a small piece at one end and in front of another at the other: no single depth key gets both", () => {
    // Bar: y 1 at x 0, y 5 at x 8. Its nearest is 1, its middle 3, its farthest 5.1.
    const bar = solid("bar", slant(0, 1, 8, 5));
    const behindIt = solid("behind", box(1, 2, 2, 2.5)); // the bar is at y 1.75 there, so it hides this; this one's whole depth is under the bar's middle
    const before = solid("before", box(6, 7, 3.5, 3.8)); // the bar is at y 4.25 there, so this hides it; this one's nearest is past the bar's nearest
    for (const input of permutations([bar, behindIt, before])) {
      const got = keys(input);
      expect(got).toHaveLength(3);
      expect(got.indexOf("behind")).toBeLessThan(got.indexOf("bar"));
      expect(got.indexOf("bar")).toBeLessThan(got.indexOf("before"));
    }
  });

  it("a ray through a hole reaches the far side of it: what stands in the hole is nearer", () => {
    const slab: Solid = { key: "a", rings: [box(0, 4, 0, 4), box(1, 3, 0, 2)], spans: [[0, 4]], bottom: 0, top: 1 };
    expect(keys([slab, solid("b", box(1.5, 2.5, 1, 1.5))])).toEqual(["a", "b"]);
    // Where the ray meets the slab first, the slab is nearer.
    const closed: Solid = { key: "b", rings: [box(0, 4, 0, 4), box(1, 3, 1, 2)], spans: [[0, 4]], bottom: 0, top: 1 };
    expect(keys([closed, solid("a", box(1.5, 2.5, 1.2, 1.5))])).toEqual(["a", "b"]);
  });
});

describe("what isn't compared", () => {
  // In each, `a` is nearer yet stays first: its name sorts first and nothing orders the pair.
  const near = box(0, 2, 1, 2);
  const far = box(0, 2, 3, 4);

  it("no overlap along the line", () => {
    expect(keys([solid("a", box(0, 1, 1, 2)), solid("b", box(2, 3, 3, 4))])).toEqual(["a", "b"]);
  });

  it("touching along the line, to within float noise", () => {
    expect(keys([solid("a", box(0, 1 + 1e-7, 1, 2)), solid("b", box(1, 2, 3, 4))])).toEqual(["a", "b"]);
  });

  it("no overlap in height", () => {
    expect(keys([solid("a", near, 0, 1), solid("b", far, 2, 3)])).toEqual(["a", "b"]);
  });

  it("touching in height: a piece standing on a deck", () => {
    expect(keys([solid("a", near, 0.45, 1), solid("b", far, 0, 0.45)])).toEqual(["a", "b"]);
  });

  it("the same depth at the middle of the overlap, to within float noise", () => {
    expect(keys([solid("a", box(0, 2, 1, 2)), solid("b", box(1, 3, 1, 4))])).toEqual(["a", "b"]);
    expect(keys([solid("a", box(0, 2, 1 - 1e-10, 2)), solid("b", box(1, 3, 1, 4))])).toEqual(["a", "b"]);
  });

  it("the gap between two stretches of one solid", () => {
    const tips: Solid = { key: "b", rings: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 }, { x: 0, y: 3 }]], spans: [[0, 1], [3, 4]], bottom: 0, top: 1 };
    expect(keys([solid("a", box(1.5, 2.5, 1, 2)), tips])).toEqual(["a", "b"]);
  });
});

describe("a solid in two stretches", () => {
  const tips = (key: string): Solid => ({ key, rings: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 }, { x: 0, y: 3 }]], spans: [[0, 1], [3, 4]], bottom: 0, top: 1 });

  it("is compared on the stretch that overlaps", () => {
    expect(keys([solid("b", box(3.2, 3.8, 5, 6)), tips("a")])).toEqual(["b", "a"]); // farther, and named later
    expect(keys([solid("a", box(3.2, 3.8, -1, -0.5)), tips("b")])).toEqual(["b", "a"]); // nearer, and named first
  });

  it("the one wider than the gap is compared on a stretch, not in the gap", () => {
    expect(keys([solid("b", box(0.5, 3.5, 5, 6)), tips("a")])).toEqual(["b", "a"]);
  });
});

describe("a cycle", () => {
  // Three bars that cross on the plan, so each hides the next at the middle of their overlap.
  const a = solid("a", slant(0, 4, 4, 6)); // at x 3: 5.5; at x 2: 5
  const b = solid("b", slant(2, 6, 6, 6)); // at x 3 and x 4: 6
  const c = solid("c", slant(0, 1, 6, 10)); // at x 2: 4; at x 4: 7

  it("the fixture is one: each pair's order runs round", () => {
    expect(keys([a, b])).toEqual(["b", "a"]);
    expect(keys([b, c])).toEqual(["c", "b"]);
    expect(keys([c, a])).toEqual(["a", "c"]);
  });

  it("is broken, not dropped: all three still draw", () => {
    const got = farToNear([a, b, c]);
    expect(got.order).toHaveLength(3);
    expect(new Set(got.order)).toEqual(new Set([a, b, c]));
    expect(got.broken).toBe(1);
  });

  it("is broken the same way whatever the input order", () => {
    const orders = permutations([a, b, c]).map(keys);
    expect(orders).toHaveLength(6);
    expect(new Set(orders.map((o) => o.join())).size).toBe(1);
  });

  it("what lies wholly past it still draws first, and what lies wholly before it still draws last", () => {
    const farthest = solid("z", box(0, 6, 20, 21));
    for (const name of ["0", "y"]) { // named before the cycle and after it: a name mustn't pull it out of turn
      const nearest = solid(name, box(0, 6, -5, -4));
      const got = farToNear([nearest, a, b, c, farthest]);
      expect(got.order[0]?.key).toBe("z");
      expect(got.order.at(-1)?.key).toBe(name);
      expect(got.order).toHaveLength(5);
      expect(new Set(got.order).size).toBe(5);
      expect(got.broken).toBe(1);
    }
  });

  it("none, none broken", () => {
    expect(farToNear([solid("a", box(0, 2, 1, 2)), solid("b", box(0, 2, 3, 4))]).broken).toBe(0);
  });
});
