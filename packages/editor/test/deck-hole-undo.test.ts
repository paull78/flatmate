import { describe, expect, it } from "vitest";
import { deckView } from "@fm/domain";
import { notchedCabinDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Deleting a deck deletes its holes in one edit, and one undo brings back both (stairwell.03, AC-02); dragging a deck
// carries its holes, in the preview and the commit (stairwell.34).

describe("deleting a deck with a hole", () => {
  it("Delete removes the loft and its notch; one undo brings back both", () => {
    const shell = FakeShell.withDocument(notchedCabinDoc());
    shell.click({ x: 0.6, y: 0.6 }); // on the loft's slab, at the floor level
    expect(shell.state.selection).toEqual([{ table: "decks", id: "loft/k0" }]);
    shell.key("Delete");
    expect(deckView(shell.doc(), "loft/k0")).toBeNull();
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(deckView(shell.doc(), "loft/k0")?.holes.map((h) => h.id)).toEqual(["notch/h0"]);
  });

  it("dragging the loft carries its notch; one undo brings both back", () => {
    const shell = FakeShell.withDocument(notchedCabinDoc());
    shell.click({ x: 0.6, y: 0.6 });
    shell.drag({ x: 0.6, y: 0.6 }, { x: 0.8, y: 0.6 });
    expect([deckView(shell.doc(), "loft/k0")?.at, shell.doc().deckHoles["notch/h0"]?.at]).toEqual([{ x: 1.3, y: 1.5 }, { x: 1.95, y: 2.575 }]);
    shell.key("z", { meta: true });
    expect([deckView(shell.doc(), "loft/k0")?.at, shell.doc().deckHoles["notch/h0"]?.at]).toEqual([{ x: 1.1, y: 1.5 }, { x: 1.75, y: 2.575 }]);
  });
});
