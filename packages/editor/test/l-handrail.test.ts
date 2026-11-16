import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, type Command, type Document } from "@fm/domain";
import type { Field } from "../src/view/view-model-types";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// An L keeps one handrail value (AC-13, guards.33): Handrail in either flight's Properties sets both flights, as one
// edit that one undo restores. The 8 × 6 room's loft is at x 0.1–2.1, y 1.5–4.5, top 2.15; the L's upper flight has its
// back on the loft's edge at (2.1, 3), its lower flight turning off the landing.

const UPPER = "ps/s0/o0";
const LOWER = "ps/s1/o0";
const room = (): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: "l/k0", at: { x: 2.1, y: 3 }, shape: "l-right" } satisfies Command,
);
const select = (s: FakeShell, placement: string): void => s.ui({ type: "selectEntity", ref: { table: "placements", id: placement } });
const field = (s: FakeShell): Field | undefined => {
  const p = s.view().properties;
  return "fields" in p ? p.fields.find((f) => f.id === "handrailRight") : undefined;
};
const both = (s: FakeShell): unknown[] => [s.doc().objects[UPPER]?.handrails?.right, s.doc().objects[LOWER]?.handrails?.right]; // a side is shared by the L (edges.06)

describe("Handrail in an L flight's Properties", () => {
  it.each(["ps/s1/p0", "ps/s0/p0"])("picked on %s, sets both flights, and one undo restores both", (placement) => {
    const s = FakeShell.withDocument(room());
    select(s, placement);
    s.ui({ type: "setField", fieldId: "handrailRight", value: "glass" });
    expect(both(s)).toEqual(["glass", "glass"]);
    select(s, placement === "ps/s1/p0" ? "ps/s0/p0" : "ps/s1/p0");
    expect(field(s)?.value).toBe("glass"); // the other flight's Properties shows it too
    s.ui({ type: "undo" });
    expect(both(s)).toEqual(["railing", "railing"]);
    s.ui({ type: "redo" });
    expect(both(s)).toEqual(["glass", "glass"]);
  });
});
