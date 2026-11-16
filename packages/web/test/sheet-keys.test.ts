import { describe, expect, it } from "vitest";
import { dropIndex, menuKey, sheetKey } from "../src/panels/sheet-keys";

// The list's keyboard and its drop (sheetset.13): pure, as web tests have no DOM (layout-states.38). Focus itself is in e2e/sheets.spec.ts.

const press = (key: string, mods: { altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}, index = 1, count = 3) =>
  sheetKey({ key, altKey: false, metaKey: false, ctrlKey: false, ...mods }, index, count);

describe("a row's keys", () => {
  it("arrows move focus", () => {
    expect(press("ArrowUp")).toEqual({ type: "focus", index: 0 });
    expect(press("ArrowDown")).toEqual({ type: "focus", index: 2 });
  });

  it("Alt + arrows move the sheet", () => {
    expect(press("ArrowUp", { altKey: true })).toEqual({ type: "move", index: 0 });
    expect(press("ArrowDown", { altKey: true })).toEqual({ type: "move", index: 2 });
  });

  it("stop at the ends", () => {
    expect(press("ArrowUp", {}, 0)).toBeNull();
    expect(press("ArrowDown", {}, 2)).toBeNull();
    expect(press("ArrowUp", { altKey: true }, 0)).toBeNull();
    expect(press("ArrowDown", { altKey: true }, 2)).toBeNull();
  });

  it("Delete and Backspace delete", () => {
    expect(press("Delete")).toEqual({ type: "delete" });
    expect(press("Backspace")).toEqual({ type: "delete" });
  });

  it("Enter and Space select", () => {
    expect(press("Enter")).toEqual({ type: "select" });
    expect(press(" ")).toEqual({ type: "select" });
  });

  it("leaves everything else, and any ⌘ or Ctrl chord, alone", () => {
    expect(press("z")).toBeNull();
    expect(press("Escape")).toBeNull();
    expect(press("Delete", { metaKey: true })).toBeNull();
    expect(press("ArrowUp", { ctrlKey: true })).toBeNull();
  });
});

describe("the Add sheet menu's keys", () => {
  it("arrows go round, Escape closes", () => {
    expect(menuKey("ArrowDown", 0, 4)).toEqual({ type: "focus", index: 1 });
    expect(menuKey("ArrowDown", 3, 4)).toEqual({ type: "focus", index: 0 });
    expect(menuKey("ArrowUp", 0, 4)).toEqual({ type: "focus", index: 3 });
    expect(menuKey("Escape", 2, 4)).toEqual({ type: "close" });
    expect(menuKey("Enter", 2, 4)).toBeNull();
  });
});

describe("a drop", () => {
  const list = ["a", "b", "c", "d"];
  it("is the sheet's place once moved", () => {
    expect(dropIndex(list, "d", "a", false)).toBe(0);
    expect(dropIndex(list, "d", "a", true)).toBe(1);
    expect(dropIndex(list, "a", "c", false)).toBe(1);
    expect(dropIndex(list, "a", "c", true)).toBe(2);
    expect(dropIndex(list, "a", "d", true)).toBe(3);
  });

  it("onto the line it already sits on is the same place", () => {
    expect(dropIndex(list, "b", "c", false)).toBe(1);
    expect(dropIndex(list, "b", "a", true)).toBe(1);
  });
});
