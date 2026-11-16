import { describe, expect, it } from "vitest";
import { OBJECT_KINDS } from "@fm/domain";
import { APPEARANCE, appearanceOf } from "../../src/view3d/parts";
import { partSolids } from "../../src/view3d/parts/solids";
import { prism } from "../../src/view3d/prism";
import { STYLE_3D } from "../../src/view3d/style";
import type { PieceItem } from "../../src/view3d/types";

// One table for every furniture kind's look in 3D (parts.09, AC-07): real parts, or a box in one slot.


const piece = (objectKind: string, ring: PieceItem["ring"]): PieceItem => ({
  item: "piece", placement: "p", object: "o", objectKind, config: "standard", ring, centre: { x: 2, y: 2 }, rotation: 0, w: 1, d: 1, bottom: 0.2, top: 1.1, selected: false,
});
const square = [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 2.5, y: 2.5 }, { x: 1.5, y: 2.5 }];
const circle = Array.from({ length: 32 }, (_, k) => ({ x: 2 + 0.5 * Math.cos((k * Math.PI) / 16), y: 2 + 0.5 * Math.sin((k * Math.PI) / 16) }));

describe("APPEARANCE", () => {
  it("has every live furniture kind and nothing else (AC-07)", () => {
    const live = OBJECT_KINDS.filter((k) => !k.retired && k.stair === null).map((k) => k.id).sort();
    expect([...APPEARANCE.keys()].sort()).toEqual(live);
  });

  it("falls back to a plain box for a kind without one", () => {
    expect(appearanceOf("kitchenBlock")("standard", 1, 1, 0.9)).toEqual([{ shape: "outline", z0: 0, z1: 0.9, slot: "plain" }]);
  });

  it("a box draws today's prism of the piece's ring, in its slot's shades (AC-05)", () => {
    for (const [kind, ring] of [["block", square], ["roundBlock", circle]] as const) {
      const item = piece(kind, ring);
      const got = partSolids("piece/p", item, STYLE_3D).flatMap((p) => p.faces);
      expect(got).toEqual(prism("piece/p", ring, 0.2, 1.1, STYLE_3D.slots.plain));
    }
  });
});
