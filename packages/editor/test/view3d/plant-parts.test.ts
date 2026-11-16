import { describe, expect, it } from "vitest";
import { kindOf } from "@fm/domain";
import { appearanceOf } from "../../src/view3d/parts";
import type { Part } from "../../src/view3d/parts/types";

// The plants in 3D (hangings step 07, AC-09, hangings.06): a pot in two steps, narrower at the bottom, under a crown of
// stacked layers shaped per kind; the widest layer is the piece's drawn ring, so the box stays filled. The every-kind
// rules (inside the ring, no overlap, fill, the face cap) are parts-properties.test.ts's.

const PLANTS = ["plant", "palm", "fern", "rosette"] as const;
const size = (kind: string) => {
  const c = kindOf(kind)?.configs[0];
  return { w: c?.w ?? 0, d: c?.d ?? 0, h: c?.h ?? 0 };
};
const partsOf = (kind: string): readonly Part[] => {
  const { w, d, h } = size(kind);
  return appearanceOf(kind)("standard", w, d, h);
};
/** Each part's height range and half width (the outline: the whole half width). */
const layers = (kind: string) => partsOf(kind).map((p) => {
  const half = size(kind).w / 2;
  if (p.shape === "outline" || p.shape === "ring") return { z0: p.z0, z1: p.z1, r: half, slot: p.slot, outline: true };
  return { z0: p.at.z0, z1: p.at.z1, r: (p.at.x1 - p.at.x0) / 2, slot: p.slot, outline: false };
}).sort((a, b) => a.z0 - b.z0);

describe("the plants in 3D (step 07, AC-09)", () => {
  it.each(PLANTS)("%s: at least six parts, stacked, the widest its drawn ring", (kind) => {
    const ls = layers(kind);
    expect(ls.length).toBeGreaterThanOrEqual(6);
    expect(ls.filter((l) => l.outline)).toHaveLength(1);
    ls.slice(1).forEach((l, i) => expect(l.z0).toBeCloseTo(ls[i]?.z1 ?? 0, 9)); // one on another, no gaps
  });

  it.each(PLANTS)("%s: a ceramic pot in two steps, the lower narrower", (kind) => {
    const [low, high] = layers(kind);
    expect([low?.slot, high?.slot]).toEqual(["ceramic", "ceramic"]);
    expect(low?.r ?? 1).toBeLessThan(high?.r ?? 0);
  });

  it("a palm: a thin wood trunk under a wide crown", () => {
    const ls = layers("palm");
    const trunk = ls.find((l) => l.slot === "wood");
    expect(trunk && trunk.r).toBeLessThan(0.1 * size("palm").w);
    expect(trunk && trunk.z1 - trunk.z0).toBeGreaterThan(0.3 * size("palm").h);
    const widest = ls.find((l) => l.outline);
    expect(widest && trunk && widest.z0).toBeGreaterThanOrEqual(trunk?.z1 ?? Infinity);
  });

  it("a fern: its widest layer is below the crown's middle", () => {
    const ls = layers("fern");
    const crown = ls.filter((l) => l.slot === "fabric");
    const mid = ((crown[0]?.z0 ?? 0) + (crown.at(-1)?.z1 ?? 0)) / 2;
    const widest = ls.find((l) => l.outline);
    expect(widest && (widest.z0 + widest.z1) / 2).toBeLessThan(mid);
  });

  it("a plant's widest layer is in its crown's middle third, narrower above and below", () => {
    const crown = layers("plant").filter((l) => l.slot === "fabric");
    const i = crown.findIndex((l) => l.outline);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(crown.length - 1);
  });

  it("a rosette: a low, flat crown wider than it is tall", () => {
    const crown = layers("rosette").filter((l) => l.slot === "fabric");
    expect((crown.at(-1)?.z1 ?? 0) - (crown[0]?.z0 ?? 0)).toBeLessThan(size("rosette").w);
  });
});
