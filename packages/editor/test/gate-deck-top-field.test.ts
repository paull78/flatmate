import { sameGuards } from "@fm/domain";
import { describe, expect, it } from "vitest";
import { withCommands, cabinDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The final gate's AC-04 gap: the Top field in a deck's Properties keeps its guard. Raising a platform past 0.76 m keeps
// its None, so it warns; lowering the loft keeps its Railing; one undo restores the top. The cabin's loft is at 2.15.

const LOFT = "loft/k0";
const PLATFORM = "p/k0";
const opened = (deck: string): FakeShell => {
  const s = FakeShell.withDocument(withCommands(cabinDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1 }));
  s.ui({ type: "selectEntity", ref: { table: "decks", id: deck } });
  return s;
};
const guardField = (s: FakeShell): unknown => {
  const p = s.view().properties;
  return "fields" in p ? p.fields.find((f) => f.id === "guard.upper")?.value : undefined;
};

describe("the Top field keeps the guard (AC-04)", () => {
  it("raising a platform keeps its None and warns, lowering a loft keeps its Railing, and one undo restores the top", () => {
    const platform = opened(PLATFORM);
    expect(platform.doc().decks[PLATFORM]).toMatchObject({ top: 0.45, ...sameGuards("none") });
    platform.ui({ type: "setField", fieldId: "top", value: "0.9" });
    expect(platform.doc().decks[PLATFORM]).toMatchObject({ top: 0.9, ...sameGuards("none") });
    expect(guardField(platform)).toBe("none");
    expect(platform.view().warnings.rows.map((r) => r.text)).toEqual(["No guard on Platform's lower side", "No guard on Platform's right side", "No guard on Platform's upper side", "No guard on Platform's left side"]);
    platform.ui({ type: "undo" });
    expect(platform.doc().decks[PLATFORM]).toMatchObject({ top: 0.45, ...sameGuards("none") });
    expect(platform.view().warnings.rows).toEqual([]);

    const loft = opened(LOFT);
    loft.ui({ type: "setField", fieldId: "top", value: "0.5" });
    expect(loft.doc().decks[LOFT]).toMatchObject({ top: 0.5, ...sameGuards("railing") });
    expect(guardField(loft)).toBe("railing");
  });
});
