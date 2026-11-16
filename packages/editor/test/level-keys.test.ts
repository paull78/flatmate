import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { viewedLevel } from "../src/state";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Page Up and Page Down step one level up or down and do nothing past the ends (levels.10); never inside a typed
// value field; Escape never changes the level (levels.09).

const deck = (opId: string, x: number, y: number, top: number): Command => ({ type: "addDeck", opId, preset: "platform", at: { x, y }, w: 1, d: 1, top });
const loftDoc = (): Document => withCommands(roomDoc(), { type: "addDeck", opId: "m", preset: "loft", at: { x: 1.2, y: 2.5 } });
const height = (shell: FakeShell): number | undefined => viewedLevel(shell.state)?.height;

describe("level keys", () => {
  it("Page Up from the floor views the loft; again stays; Page Down returns to the floor", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    expect(shell.state.viewedDeck).toBe("m/k0");
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    shell.key("PageDown");
    expect(height(shell)).toBe(0);
    expect(shell.state.viewedDeck).toBeNull();
    shell.key("PageDown");
    expect(height(shell)).toBe(0);
  });

  it("steps through every level in height order, skipping a deck 1 mm under the floor's cut", () => {
    // The 1.20 deck's ID sorts after the loft's, so ID order is not height order; 0.45 and 1.199 belong to the floor.
    const doc = withCommands(loftDoc(), deck("z", 3, 2.5, 1.2), deck("b", 4.5, 2.5, 1.199), deck("c", 4.5, 1, 0.45));
    const shell = FakeShell.withDocument(doc);
    const seen: (number | undefined)[] = [];
    for (const key of ["PageUp", "PageUp", "PageUp", "PageDown", "PageDown", "PageDown"]) {
      shell.key(key);
      seen.push(height(shell));
    }
    expect(seen).toEqual([1.2, 2.15, 2.15, 1.2, 0, 0]);
  });

  it("Page Up inside a typed value field does nothing", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.key("w");
    shell.click({ x: 3, y: 1 });
    shell.type("2");
    shell.key("PageUp");
    expect(height(shell)).toBe(0);
    expect(shell.view().commandBar.value).toBe("2");
    expect(shell.state.tool.name).toBe("wall");
  });

  it("Escape keeps the level", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.key("PageUp");
    shell.key("o");
    shell.key("Escape");
    shell.key("Escape");
    expect(shell.state.tool.name).toBe("select");
    expect(height(shell)).toBe(2.15);
  });
});
