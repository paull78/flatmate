import { describe, expect, it } from "vitest";
import { orderedStates } from "../src/queries/states";
import { rectDoc } from "./helpers";

// One layout order for every surface (cleanup step 11): the switcher, the PDF sheet, get_drawing and look.

describe("orderedStates", () => {
  it("sorts by order, then by id, whatever the table's key order", () => {
    const doc = rectDoc(0, 0, 4, 3);
    const states = {
      z: { id: "z", name: "Night", order: 1 },
      b: { id: "b", name: "Copy", order: 1 },
      s0: { id: "s0", name: "Layout", order: 0 },
      a: { id: "a", name: "Late", order: 5 },
    };
    expect(orderedStates({ ...doc, states }).map((s) => s.id)).toEqual(["s0", "b", "z", "a"]);
  });
});
