import { describe, expect, it } from "vitest";
import { deckView, type Command } from "@fm/domain";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Properties for a deck (spec "The Deck tool and editing", decks.06; AC-11): Name, Top, Solid, Width, Depth, Rotation.
// The preset is only the tool's default and is not shown.

const platform: Command = { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 } };
function selected(): FakeShell {
  const shell = FakeShell.withDocument(withCommands(roomDoc(), platform));
  shell.click({ x: 2.5, y: 1.8 });
  expect(shell.state.selection).toEqual([{ table: "decks", id: "p/k0" }]);
  return shell;
}
const set = (shell: FakeShell, fieldId: string, value: string) => shell.ui({ type: "setField", fieldId, value });
const deck = (shell: FakeShell) => deckView(shell.doc(), "p/k0");

describe("Properties for a deck (AC-11)", () => {
  it("fields show name, top 0.45, solid on, width, depth, rotation, then Floor None (deck-floors.02)", () => {
    const shell = selected();
    const props = shell.view().properties;
    expect(props.kind).toBe("deck");
    const all = props.kind === "deck" ? props.fields : [];
    const fields = all.filter((f) => f.section === "Deck"); // then the Guards group (guard-properties.test.ts)
    expect(fields.map((f) => [f.id, f.label, f.value, f.unit, f.readOnly])).toEqual([
      ["name", "Name", "Platform", null, false],
      ["top", "Top", "0.45", "m", false],
      ["solid", "Solid", "true", null, false],
      ["width", "Width", "2.00", "m", false],
      ["depth", "Depth", "1.40", "m", false],
      ["rotation", "Rotation", "0", "°", false],
      ["row:floor", "Floor", "None", null, true],
      ["floor", "Pattern", "none", null, false],
    ]);
    expect(fields.find((f) => f.id === "solid")?.toggle).toBe(true);
    expect(fields.map((f) => f.step)).toEqual([undefined, 0.01, undefined, 0.01, 0.01, 1, undefined, undefined]);
    expect(new Set(all.map((f) => f.section))).toEqual(new Set(["Deck", "Guards"]));
  });

  it("typing a top of 2.15 and switching Solid off makes a loft; each is one undo step", () => {
    const shell = selected();
    set(shell, "top", "2.15");
    set(shell, "solid", "false");
    expect(deck(shell)).toEqual(expect.objectContaining({ top: 2.15, solid: false }));
    expect(shell.view().properties).toEqual(expect.objectContaining({ fields: expect.arrayContaining([expect.objectContaining({ id: "solid", value: "false" })]) }));
    shell.key("z", { meta: true });
    expect(deck(shell)).toEqual(expect.objectContaining({ top: 2.15, solid: true }));
    shell.key("z", { meta: true });
    expect(deck(shell)).toEqual(expect.objectContaining({ top: 0.45, solid: true }));
  });

  it("typing a name, a width and a depth: the size keeps the centre", () => {
    const shell = selected();
    set(shell, "name", "Stage");
    set(shell, "width", "3");
    set(shell, "depth", "1.2");
    expect(deck(shell)).toEqual(expect.objectContaining({ name: "Stage", at: { x: 3, y: 2 }, w: 3, d: 1.2 }));
  });

  it("typing a rotation of 15 turns an empty deck", () => {
    const shell = selected();
    set(shell, "rotation", "15");
    expect(deck(shell)?.rotation).toBe(15);
  });

  it("\"abc\" in Top toasts \"Can't read abc\"; a refused value toasts the rule and changes nothing", () => {
    const shell = selected();
    set(shell, "top", "abc");
    expect(shell.view().toast).toBe("Can't read abc");
    set(shell, "width", "0.1");
    expect(shell.view().toast).toBe("Deck sizes must be at least 0.30 m, tops 0.15 to 10 m");
    expect(deck(shell)).toEqual(expect.objectContaining({ top: 0.45, w: 2 }));
    expect(shell.view().canUndo).toBe(false);
  });
});
