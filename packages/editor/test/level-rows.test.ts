import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The level strip's view model (levels.10): one row per level, highest first, the height and the name as two columns,
// the viewed one marked; none while the drawing has only the floor level. The chip reads the viewed level's cut.

const loft = (opId: string, x: number, name?: string): Command => ({ type: "addDeck", opId, preset: "loft", at: { x, y: 2.5 }, ...(name ? { name } : {}) });
const platform: Command = { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 1 }, w: 1, d: 1 };
const loftDoc = (): Document => withCommands(roomDoc(), platform, loft("m", 1.2));
const rows = (shell: FakeShell) => shell.view().levels?.rows.map((r) => ({ text: `${r.height}  ${r.name}`, viewed: r.viewed, deck: r.deck }));

describe("the level strip's rows", () => {
  it("no level rows with only the floor level; with a loft, \"+2.15  Loft\" above \"0.00  Floor\", the floor viewed", () => {
    expect(FakeShell.withDocument(roomDoc()).view().levels).toBeNull();
    expect(FakeShell.withDocument(withCommands(roomDoc(), platform)).view().levels).toBeNull(); // a platform is part of the floor level
    const shell = FakeShell.withDocument(loftDoc());
    expect(rows(shell)).toEqual([
      { text: "+2.15  Loft", viewed: false, deck: "m/k0" },
      { text: "0.00  Floor", viewed: true, deck: null },
    ]);
    shell.ui({ type: "setViewedLevel", deck: "m/k0" });
    expect(rows(shell)?.map((r) => r.viewed)).toEqual([true, false]);
  });

  it("no level rows without a document", () => {
    const shell = FakeShell.withDocument(loftDoc());
    expect(new FakeShell({ ...shell.state, document: null }, shell.host).view().levels).toBeNull();
  });

  it("a second 2.15 deck named Bunk makes \"+2.15  Loft, Bunk\"", () => {
    // Bunk's ID "z/k0" sorts after the loft's, so the name keeps ID order, not the order of adding.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), loft("z", 3.4, "Bunk"), loft("m", 1.2)));
    expect(rows(shell)?.[0]).toEqual({ text: "+2.15  Loft, Bunk", viewed: false, deck: "m/k0" });
  });

  it("the chip reads \"Cut +2.33\" at the loft", () => {
    const shell = FakeShell.withDocument(loftDoc());
    expect(shell.view().cut).toBe("Cut +1.20");
    shell.ui({ type: "setViewedLevel", deck: "m/k0" });
    expect(shell.view().cut).toBe("Cut +2.33");
  });

  it("the chip rounds like the strip: \"Cut +2.68\" at the loft under a 3.20 ceiling, where toFixed(2) reads 2.67", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "setCeiling", height: 3.2 }, loft("m", 1.2)));
    shell.ui({ type: "setViewedLevel", deck: "m/k0" });
    expect(shell.view().cut).toBe("Cut +2.68"); // the cut is 2.675, 2.67499… in floats
  });
});
