import { describe, expect, it } from "vitest";
import type { Field } from "@fm/editor";
import { shownFields, swatchStyle } from "../../src/panels/FinishRow";

// A finish's summary row in the shell (inherit step 04, AC-07): a closed row's fields are left out; the swatch shows the
// colour under its motif's faint joints, a hatch for None.

const row = (id: string, open: boolean): Field => ({ id, label: "Floor", section: "Room", value: "Planks · Oak", unit: null, readOnly: true, finish: { colour: "#c8a27a", motif: "planks", open } });
const under = (id: string, group: string): Field => ({ id, label: id, section: "Room", value: "", unit: null, readOnly: false, inFinish: group });
const plain = (id: string): Field => ({ id, label: id, section: "Room", value: "", unit: null, readOnly: false });

describe("the finish summary row (step 04)", () => {
  it("leaves out a closed row's fields and keeps an open row's", () => {
    const fields = [plain("name"), row("row:floor", false), under("floor", "row:floor"), under("colour", "row:floor"), row("row:walls", true), under("walls", "row:walls")];
    expect(shownFields(fields).map((f) => f.id)).toEqual(["name", "row:floor", "row:walls", "walls"]);
  });

  it("draws the colour under the motif's joints; None is a hatch", () => {
    const planks = String(swatchStyle("planks", "#c8a27a").background);
    expect(planks).toContain("#c8a27a");
    expect(planks).toContain("0deg"); // planks' rows
    expect(String(swatchStyle("plain", "#a8b59a").background)).toBe("linear-gradient(#a8b59a, #a8b59a)");
    expect(String(swatchStyle(null, null).background)).toContain("135deg");
  });
});
