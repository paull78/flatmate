import { describe, expect, it } from "vitest";
import type { Field } from "../src/view/view-model-types";
import { cabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A deck's Guards in Properties (edges AC-07, AC-11): one row per side by its plan name, each a kind (Railing, Glass or
// None) and a height, each edit one setDeck and one undo; a height outside 0.30–1.10 is refused with the range.

const LOFT = "loft/k0";
const opened = (doc = cabinDoc()): FakeShell => {
  const s = FakeShell.withDocument(doc);
  s.ui({ type: "selectEntity", ref: { table: "decks", id: LOFT } });
  return s;
};
const fields = (s: FakeShell): Field[] => {
  const p = s.view().properties;
  return "fields" in p ? p.fields : [];
};
const byId = (s: FakeShell, id: string): Field | undefined => fields(s).find((f) => f.id === id);
const OPTIONS = [{ value: "railing", label: "Railing" }, { value: "glass", label: "Glass" }, { value: "none", label: "None" }];

describe("the Guards group", () => {
  it("shows four rows named upper, right, lower, left, each a kind and a height", () => {
    const guards = fields(opened()).filter((f) => f.section === "Guards");
    expect(guards.map((f) => [f.id, f.label])).toEqual([
      ["guard.upper", "Upper"], ["guardHeight.upper", "Height"],
      ["guard.right", "Right"], ["guardHeight.right", "Height"],
      ["guard.lower", "Lower"], ["guardHeight.lower", "Height"],
      ["guard.left", "Left"], ["guardHeight.left", "Height"],
    ]);
    expect(byId(opened(), "guard.right")?.options).toEqual(OPTIONS);
    expect(byId(opened(), "guard.right")?.value).toBe("railing");
    expect(byId(opened(), "guardHeight.right")).toMatchObject({ value: "1.00", unit: "m", readOnly: false });
    expect(fields(opened()).some((f) => f.id === "guard")).toBe(false);
  });

  it("after turning the deck 90°, the row named upper edits the side that was right (AC-07)", () => {
    const doc = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guardRight: { kind: "glass" } }, { type: "setDeck", deckId: LOFT, rotation: 90, w: 2.8, d: 2 }); // the same footprint, turned
    const s = opened(doc);
    expect(byId(s, "guard.upper")?.value).toBe("glass");
    s.ui({ type: "setField", fieldId: "guard.upper", value: "none" });
    expect(s.doc().decks[LOFT]?.guardRight.kind).toBe("none");
  });

  it("choosing None on the right row changes only the right side, and one undo restores it (AC-11)", () => {
    const s = opened();
    const before = s.doc().decks[LOFT];
    s.ui({ type: "setField", fieldId: "guard.right", value: "none" });
    expect(s.doc().decks[LOFT]).toEqual({ ...before, guardRight: { kind: "none", height: 1 } });
    s.ui({ type: "undo" });
    expect(s.doc().decks[LOFT]).toEqual(before);
  });

  it("typing 0.30 in the upper height sets only that height, and one undo restores it (AC-11)", () => {
    const s = opened();
    const before = s.doc().decks[LOFT];
    s.ui({ type: "setField", fieldId: "guardHeight.upper", value: "0.30" });
    expect(s.doc().decks[LOFT]).toEqual({ ...before, guardBack: { kind: "railing", height: 0.3 } });
    expect(byId(s, "guardHeight.upper")?.value).toBe("0.30");
    s.ui({ type: "undo" });
    expect(s.doc().decks[LOFT]).toEqual(before);
  });

  it("typing 1.20 is refused with the range, and nothing changes", () => {
    const s = opened();
    const before = s.doc();
    s.ui({ type: "setField", fieldId: "guardHeight.upper", value: "1.20" });
    expect(s.doc()).toBe(before);
    expect(s.view().toast).toBe("Guard height must be 0.30 to 1.10 m");
  });

  it("feet and inches type into a height", () => {
    const s = opened();
    s.ui({ type: "setField", fieldId: "guardHeight.left", value: "2'" });
    expect(s.doc().decks[LOFT]?.guardLeft.height).toBe(0.61);
  });

  it("a None row's height is read-only, and its height is kept", () => {
    const s = opened();
    s.ui({ type: "setField", fieldId: "guardHeight.left", value: "0.5" });
    s.ui({ type: "setField", fieldId: "guard.left", value: "none" });
    expect(byId(s, "guardHeight.left")).toMatchObject({ value: "0.50", readOnly: true });
  });

  it("a value no choice offers is ignored", () => {
    const s = opened();
    const before = s.doc();
    s.ui({ type: "setField", fieldId: "guard.right", value: "wood" });
    expect(s.doc()).toBe(before);
  });
});
