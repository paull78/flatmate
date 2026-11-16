import { describe, expect, it } from "vitest";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { STYLE_3D } from "../../src/view3d/style";
import { notchedCabinDoc } from "../builders";

// A deck's slab in 3D (stairwell.09; AC-12): the top face has the hole cut out and each of the hole's sides inside the
// deck is a vertical face, wound from outside (facing into the hole); the notch's open sides and the stretch of the
// loft's sides it opens have none.

const r = (v: number): number => Math.round(v * 1000) / 1000 + 0;

describe("the loft with its notch in 3D (AC-12)", () => {
  const deck = view3dItems(notchedCabinDoc(), "s0", null, new Set(), false).find((i) => i.item === "deck");
  if (!deck) throw new Error("no deck item");
  const faces = faces3d(deck);
  const top = faces.find((f) => f.color === STYLE_3D.deck.top);
  const sides = faces.filter((f) => f !== top);

  it("the top face's outline follows the notch at 2.15, one traced ring with no hole in it (fixes.06)", () => {
    expect(top?.holes).toEqual([]);
    expect(top?.points).toHaveLength(6);
    expect(top?.points.every((p) => p.z === 2.15)).toBe(true);
  });

  it("six side faces from 2.03 to 2.15: the slab's boundary; two of them line the notch, facing into it", () => {
    expect(sides).toHaveLength(6);
    for (const f of sides) expect(new Set(f.points.map((p) => p.z))).toEqual(new Set([2.03, 2.15]));
    const plan = (f: (typeof sides)[number]): string => [...new Set(f.points.map((p) => `${r(p.x)},${r(p.y)}`))].sort().join(" ");
    expect(sides.map(plan)).toContain("1.4,2.25 1.4,2.9");
    expect(sides.map(plan)).toContain("1.4,2.25 2.1,2.25");
    expect(sides.map(plan)).not.toContain("2.1,0.1 2.1,2.9");
  });
});
