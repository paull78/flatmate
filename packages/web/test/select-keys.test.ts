import { describe, expect, it } from "vitest";
import { dropsKey } from "../src/panels/select-keys";

// The one key rule every native dropdown shares (snags.06, AC-01): on a focused select with its list closed, a key the
// browser would turn into a pick (type-ahead, or an arrow outside macOS) is dropped, so the plan gets the next key.

const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("dropsKey", () => {
  it("drops letters, digits and symbols on a closed list", () => {
    for (const k of ["o", "O", "w", "3", "-", "é"]) expect(dropsKey(key(k), false), k).toBe(true);
  });

  it("drops the keys that pick on a closed select with no popup outside macOS", () => {
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) expect(dropsKey(key(k), false), k).toBe(true);
  });

  it("leaves Space, modified keys and other named keys alone", () => {
    for (const k of [" ", "Enter", "Tab", "Escape", "Shift", "F4", "Backspace"]) expect(dropsKey(key(k), false), JSON.stringify(k)).toBe(false);
    expect(dropsKey(key("z", { metaKey: true }), false), "Cmd+Z").toBe(false);
    expect(dropsKey(key("o", { ctrlKey: true }), false), "Ctrl+O").toBe(false);
    expect(dropsKey(key("ArrowDown", { altKey: true }), false), "Alt+ArrowDown opens the list").toBe(false);
  });

  it("leaves every key to an open list", () => {
    for (const k of ["o", "3", "ArrowDown", "End", "PageUp"]) expect(dropsKey(key(k), true), k).toBe(false);
  });
});
