import { describe, expect, it } from "vitest";
import type { Field } from "../src/view/view-model-types";
import { notchedCabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A hole's Guard in Properties (edges AC-02): one kind and one height for all its sides, after Width and Depth, each one
// setDeckHole and one undo.

const MID = "mid/h0";
const opened = (): FakeShell => {
  const s = FakeShell.withDocument(withCommands(notchedCabinDoc(), { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 0.9, y: 1.3 }, w: 0.6, d: 0.6 }));
  s.ui({ type: "selectEntity", ref: { table: "deckHoles", id: MID } });
  return s;
};
const fields = (s: FakeShell): Field[] => {
  const p = s.view().properties;
  return "fields" in p ? p.fields : [];
};
const byId = (s: FakeShell, id: string) => fields(s).find((f) => f.id === id);

describe("a hole's Guard", () => {
  it("shows Width, Depth, then Guard and its Height", () => {
    const s = opened();
    expect(fields(s).map((f) => [f.id, f.label])).toEqual([["width", "Width"], ["depth", "Depth"], ["guard", "Guard"], ["guardHeight", "Height"]]);
    expect(byId(s, "guard")?.value).toBe("railing");
    expect(byId(s, "guard")?.options?.map((o) => o.value)).toEqual(["railing", "glass", "none"]);
    expect(byId(s, "guardHeight")).toMatchObject({ value: "1.00", unit: "m", readOnly: false });
  });

  it("Glass, then a 0.60 height, each one setDeckHole and one undo", () => {
    const s = opened();
    s.ui({ type: "setField", fieldId: "guard", value: "glass" });
    s.ui({ type: "setField", fieldId: "guardHeight", value: "0.6" });
    expect(s.doc().deckHoles[MID]?.guard).toEqual({ kind: "glass", height: 0.6 });
    s.ui({ type: "undo" });
    expect(s.doc().deckHoles[MID]?.guard).toEqual({ kind: "glass", height: 1 });
    s.ui({ type: "undo" });
    expect(s.doc().deckHoles[MID]?.guard).toEqual({ kind: "railing", height: 1 });
  });

  it("None makes the height read-only; 1.20 is refused with the range", () => {
    const s = opened();
    s.ui({ type: "setField", fieldId: "guardHeight", value: "1.20" });
    expect(s.view().toast).toBe("Guard height must be 0.30 to 1.10 m");
    s.ui({ type: "setField", fieldId: "guard", value: "none" });
    expect(byId(s, "guardHeight")).toMatchObject({ value: "1.00", readOnly: true });
  });
});
