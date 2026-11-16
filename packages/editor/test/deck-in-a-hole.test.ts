import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { notchedCabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A platform or an L's landing may stand in another deck's hole (stairwell.17). At the floor it has to be reachable by a
// click, and the Hole tool has to cut in what's under the press (fixes AC-11). The hole is 1.2 m square about (1, 1.3), and
// the platform stands in its middle, 0.8 m square.

const withPlatform = (): Document => withCommands(
  notchedCabinDoc(),
  { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 1, y: 1.3 }, w: 1.2, d: 1.2 } satisfies Command,
  { type: "addDeck", opId: "pl", preset: "platform", at: { x: 1, y: 1.3 }, w: 0.8, d: 0.8 } satisfies Command,
);

describe("a deck standing in a hole", () => {
  it("a click on it selects it, not the hole around it", () => {
    const shell = FakeShell.withDocument(withPlatform());
    shell.click({ x: 1, y: 1.3 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: "pl/k0" }]);
  });

  it("a click in the hole beside it still selects the hole", () => {
    const shell = FakeShell.withDocument(withPlatform());
    shell.click({ x: 0.5, y: 1.3 });
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: "mid/h0" }]);
  });

  it("the Hole tool's press on it cuts in it, not in the deck around it", () => {
    const shell = FakeShell.withDocument(withPlatform());
    shell.key("k");
    shell.ui({ type: "pickTool", tool: "hole" });
    const before = Object.keys(shell.doc().deckHoles).length;
    shell.drag({ x: 0.8, y: 1.1 }, { x: 1.2, y: 1.5 });
    expect(shell.view().toast).toBeNull();
    const holes = Object.values(shell.doc().deckHoles);
    expect(holes).toHaveLength(before + 1);
    expect(holes.at(-1)?.deck).toBe("pl/k0");
  });
});
