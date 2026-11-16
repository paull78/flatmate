import { describe, expect, it } from "vitest";
import { PALETTE_KINDS } from "../src/view/palette";
import { searchPalette } from "../src/view/palette-search";

// The Wheel well in the palette (trailer.08, .11): in the Basic group under every surroundings, with its three
// presets' cards, and found by quick add under its other names.

describe("the Wheel well in the palette", () => {
  it("the Basic group has its card beside the radiator and the wood stove", () => {
    const basic = PALETTE_KINDS.find((g) => g.group === "Basic")?.cards ?? [];
    const kinds = basic.map((c) => c.kind);
    expect(kinds.indexOf("wheelWell")).toBe(kinds.indexOf("radiator") + 1);
    const card = basic.find((c) => c.kind === "wheelWell");
    expect([card?.name, card?.w, card?.d]).toEqual(["Wheel well", 1.8, 0.4]);
  });

  it("quick add finds it by its name and by wheel arch, offering its presets", () => {
    expect(searchPalette("wheel well")[0]?.kind).toBe("wheelWell");
    expect(searchPalette("wheel arch")[0]?.kind).toBe("wheelWell");
    expect(searchPalette("tandem").some((r) => r.kind === "wheelWell")).toBe(true);
  });
});
