import { describe, expect, it } from "vitest";
import { levelOf, type Document } from "@fm/domain";
import { noFloorAt, refusalText } from "../src/toast-text";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Refusal toasts in plain words (spec item 9, AC-20), for the command event too; Claude's MCP replies keep the domain's
// IDs through the MCP server's own execute pre-check (arch-review R-09).
// roomDoc's bottom wall runs from (0, 0) to (6, 0); the door d/d0 spans x 2.6–3.4 on it.
const bottom = (doc: Document): string => wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
const withOpening = (kind: "swing" | "window"): Document => withCommands(roomDoc(), { type: "addOpening", opId: "d", wall: bottom(roomDoc()), kind, offset: 2.6 });

describe("refusal toasts in plain words (AC-20)", () => {
  it('a door added over another door toasts "This door would overlap a door on this wall"', () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    shell.key("d");
    shell.click({ x: 3.2, y: 0.05 });
    expect(Object.keys(shell.doc().openings)).toEqual(["d/d0"]);
    expect(shell.view().toast).toBe("This door would overlap a door on this wall");
  });

  it('a door added over a window toasts "This door would overlap a window on this wall"', () => {
    const shell = FakeShell.withDocument(withOpening("window"));
    shell.key("d");
    shell.click({ x: 3.2, y: 0.05 });
    expect(shell.view().toast).toBe("This door would overlap a window on this wall");
  });

  it('a window added over a door toasts "This window would overlap a door on this wall"', () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    shell.ui({ type: "pickOpeningKind", kind: "window" });
    shell.click({ x: 2.4, y: 0.05 });
    expect(shell.view().toast).toBe("This window would overlap a door on this wall");
  });

  it('a door dragged past the wall\'s end toasts "This door doesn\'t fit on its wall"', () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 6.5, y: 0 });
    shell.up({ x: 6.5, y: 0 });
    expect(shell.view().toast).toBe("This door doesn't fit on its wall");
  });

  it('a corner dragged so the wall no longer holds its door toasts "A door doesn\'t fit on its wall"', () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    shell.drag({ x: 6, y: 0 }, { x: 3.1, y: 0 });
    expect(shell.doc()).toEqual(withOpening("swing"));
    expect(shell.view().toast).toBe("A door doesn't fit on its wall");
  });

  it('a wall ending inside a door toasts "A wall can\'t end inside a door"', () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    shell.key("w");
    shell.click({ x: 3, y: 2 });
    shell.click({ x: 3, y: 0 });
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
    expect(shell.view().toast).toBe("A wall can't end inside a door");
  });

  it("the wall-split refusal toast comes from its violation and command, not from the message text (arch-review R-09)", () => {
    const doc = withOpening("window");
    const id = Object.keys(doc.openings)[0] ?? "";
    const wall = doc.openings[id]?.wall ?? "";
    const error = {
      kind: "topology" as const,
      message: "any wording",
      violations: [{ invariant: "I12" as const, message: "any wording", entities: [{ table: "openings" as const, id }, { table: "walls" as const, id: wall }] }],
    };
    const cmd = { type: "addWall" as const, opId: "x", from: { at: { x: 3, y: 2 } }, to: { at: { x: 3, y: 0 } } };
    expect(refusalText(error, doc, cmd)).toBe("A wall can't end inside a window");
  });

  it("no refusal toast names an opening or a wall ID", () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    shell.key("d");
    shell.click({ x: 3.2, y: 0.05 });
    const text = shell.view().toast ?? "";
    expect(text).not.toContain("d/d0");
    expect(text).not.toContain(bottom(shell.doc()));
  });

  it("the command event toasts in plain words like any tool; Claude's replies keep the IDs through the MCP pre-check (arch-review R-09)", () => {
    const doc = withOpening("swing");
    const shell = FakeShell.withDocument(doc);
    shell.send({ type: "command", command: { type: "addOpening", opId: "e", wall: bottom(doc), kind: "swing", offset: 3 } });
    expect(shell.view().toast).toBe("This door would overlap a door on this wall");
  });

  it("on a 2.03 m half wall a door dragged past the wall's end toasts that it doesn't fit, not a height text (decks.17, sills.02)", () => {
    const low = withCommands(roomDoc(), { type: "setWallTop", wallId: bottom(roomDoc()), top: 2.03 });
    const shell = FakeShell.withDocument(withCommands(low, { type: "addOpening", opId: "d", wall: bottom(roomDoc()), kind: "swing", offset: 2.6 }));
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 6.5, y: 0 });
    shell.up({ x: 6.5, y: 0 });
    expect(shell.view().toast).toBe("This door doesn't fit on its wall");
  });

  it("a wall with a door lowered to 2.19 m toasts the door's head and the new top; to 2.20 m it is lowered (sills.02)", () => {
    const shell = FakeShell.withDocument(withOpening("swing"));
    const wallId = bottom(roomDoc());
    shell.send({ type: "command", command: { type: "setWallTop", wallId, top: 2.19 } });
    expect([shell.doc().walls[wallId]?.top, shell.view().toast]).toEqual(["ceiling", "A door's head must be at least 0.10 m under its wall's top, at 2.19 m"]);
    shell.send({ type: "command", command: { type: "setWallTop", wallId, top: 2.2 } });
    expect(shell.doc().walls[wallId]?.top).toBe(2.2);
  });
});

describe("the no-floor toast (spec \"Placing at a level\", levels.16)", () => {
  it("› noFloorAt names the level", () => {
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.4, y: 2.2 }, w: 2, d: 1.6 });
    expect(noFloorAt(levelOf(doc, "loft/k0"))).toBe("No floor at +2.15 here");
    const higher = withCommands(doc, { type: "setCeiling", height: 3.2 }, { type: "setDeck", deckId: "loft/k0", top: 2.3 });
    expect(noFloorAt(levelOf(higher, "loft/k0"))).toBe("No floor at +2.30 here");
  });
});
