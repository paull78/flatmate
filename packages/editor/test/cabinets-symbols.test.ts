import { describe, expect, it } from "vitest";
import { kindOf } from "@fm/domain";
import { furnitureSymbol } from "../src/view/furniture";
import { PALETTE } from "../src/view/palette";
import { searchPalette } from "../src/view/palette-search";
import type { Primitive } from "../src/view/scene-types";

// The glass cabinets on the plan and in the palette (the user's request after hangings): books seen from above behind
// the doors' line, a joint between two doors; after the shelf in Storage; found by quick add.

const KINDS = ["glassCabinet", "halfGlassCabinet"] as const;
const segs = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));

describe("the glass cabinets' symbols and cards", () => {
  it.each(KINDS)("%s: inside its footprint at each preset, the doors' line across, a joint between two doors", (id) => {
    for (const p of kindOf(id)?.presets ?? []) {
      const d = p.d.standard ?? 0;
      const symbol = furnitureSymbol(id, "standard", p.w, d);
      for (const s of segs(symbol)) for (const q of [s.a, s.b]) expect(q.x >= -p.w / 2 - 1e-9 && q.x <= p.w / 2 + 1e-9 && q.y >= -d - 1e-9 && q.y <= 1e-9, `${id} ${p.id}`).toBe(true);
      const across = segs(symbol).filter((s) => Math.abs(s.a.y - s.b.y) < 1e-9 && Math.abs(s.a.y + 0.9 * d) < 1e-9 && Math.abs(Math.abs(s.b.x - s.a.x) - p.w) < 1e-9);
      expect(across, `${id} ${p.id}`).toHaveLength(1);
      const joints = segs(symbol).filter((s) => s.a.x === 0 && s.b.x === 0 && Math.min(s.a.y, s.b.y) === -d);
      expect(joints, `${id} ${p.id}`).toHaveLength(p.w < 0.6 ? 0 : 1);
    }
  });

  it("follow the shelf in Storage, and quick add finds them", () => {
    const storage = PALETTE.find((g) => g.group === "Storage")?.cards.map((c) => c.kind) ?? [];
    expect(storage.slice(storage.indexOf("shelf"), storage.indexOf("shelf") + 3)).toEqual(["shelf", "glassCabinet", "halfGlassCabinet"]);
    const top = (q: string): string | undefined => searchPalette(q)[0]?.kind;
    expect(top("glass cabinet")).toBe("glassCabinet");
    expect(top("vitrine")).toBe("glassCabinet");
    expect(top("half-glass")).toBe("halfGlassCabinet");
    expect(top("bookcase with doors")).toBe("halfGlassCabinet");
  });
});
