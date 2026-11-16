import { describe, expect, it } from "vitest";
import { kindOf } from "../src/kinds";

// Glass-door cabinets (the user's request after hangings): a Glass cabinet and a Half-glass cabinet, tall bookcases with
// doors, 40 or 80 wide, 30 deep, 2.02 tall, a front use zone for their doors.

describe("the glass cabinets", () => {
  it.each(["glassCabinet", "halfGlassCabinet"])("%s: 80 × 30 × 2.02 by default, a 40 and an 80 preset, a front zone", (id) => {
    const k = kindOf(id);
    expect(k?.configs[0]).toMatchObject({ w: 0.8, d: 0.3, h: 2.02 });
    expect(k?.presets.map((p) => [p.id, p.w, p.d.standard, p.h?.standard])).toEqual([["40", 0.4, 0.3, 2.02], ["80", 0.8, 0.3, 2.02]]);
    expect(k?.configs[0]?.zone).toBe(0.4);
  });

  it("are named for people", () => {
    expect([kindOf("glassCabinet")?.label, kindOf("halfGlassCabinet")?.label]).toEqual(["Glass cabinet", "Half-glass cabinet"]);
  });
});
