import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, type Command, type Document } from "@fm/domain";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Stair polish (AC-02): the small leftovers from the stairs and stair drawing cycles that still happen.

const LOFT = "loft/k0";
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 5, "r"),
  { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 2.5 }, w: 3.5, d: 4.8 },
  ...more,
);
const arm = (doc: Document, kind: string): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  return shell;
};

describe("stair polish", () => {
  it("a second L's landing has its own name (stairdraw.37)", () => {
    const l = (opId: string, y: number, shape: "l-left" | "l-right"): Command => ({ type: "placeStair", opId, state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 3.6, y }, shape });
    const doc = room(l("a", 2.1, "l-left"), l("b", 3, "l-right")); // turning away from each other
    const names = Object.values(doc.decks).map((d) => d.name).filter((n) => n.startsWith("Landing")).sort();
    expect(names).toEqual(["Landing", "Landing 2"]);
  });

  it("a deck moved away after click 1 drops back to hovering, with a ghost or none, not a dead click (stairdraw.28)", () => {
    const doc = room();
    const shell = arm(doc, "stair");
    shell.moveTo({ x: 4, y: 2.5 });
    shell.click({ x: 4, y: 2.5 });
    const t = () => (shell.state.tool.name === "object" ? shell.state.tool.state : null);
    expect(t()?.stair?.phase).toBe("fixed");
    // The collaborator's move, as the editor receives it: the document changes under the fixed top.
    shell.command({ type: "setDeck", deckId: LOFT, at: { x: 1.6, y: 2.5 }, w: 3 });
    shell.moveTo({ x: 4, y: 2.5 });
    expect(t()?.stair?.phase ?? "hover").toBe("hover");
  });

  it("a refusal names the layout in view (stairdraw.54)", () => {
    const doc = room(
      { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, opId: "a", state: "s0", object: { kind: "block", size: { w: 1, d: 1 } }, at: { x: 5, y: 2 }, rotation: 0, deck: null },
      { type: "placeObject", linked: false, opId: "b", state: "s0", object: { kind: "block", size: { w: 1, d: 1 } }, at: { x: 7, y: 2 }, rotation: 0, deck: null },
      { type: "placeObject", linked: false, opId: "a2", state: "n/s0", object: { existing: "a/o0" }, at: { x: 5, y: 2 }, rotation: 0, deck: null },
      { type: "placeObject", linked: false, opId: "bn", state: "n/s0", object: { existing: "b/o0" }, at: { x: 7, y: 2 }, rotation: 0, deck: null },
    );
    const shell = FakeShell.withDocument(doc);
    const size: Command = { type: "setObjectSize", objectId: "a/o0", w: 4, d: { standard: 1 } };
    shell.command(size);
    expect(shell.view().toast).toContain("in Layout");
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.command(size);
    expect(shell.view().toast).toContain("in Night");
  });

  it("a later edit that goes through clears an old refusal (stairdraw.54)", () => {
    const shell = FakeShell.withDocument(room(
      { type: "placeObject", linked: false, opId: "a", state: "s0", object: { kind: "block", size: { w: 1, d: 1 } }, at: { x: 5, y: 2 }, rotation: 0, deck: null },
      { type: "placeObject", linked: false, opId: "b", state: "s0", object: { kind: "block", size: { w: 1, d: 1 } }, at: { x: 7, y: 2 }, rotation: 0, deck: null },
    ));
    shell.command({ type: "setObjectSize", objectId: "a/o0", w: 4, d: { standard: 1 } });
    expect(shell.view().toast).not.toBeNull();
    shell.command({ type: "setObjectSize", objectId: "a/o0", w: 1.2, d: { standard: 1 } });
    expect(shell.view().toast).toBeNull();
  });

  it("the hint and the toast name two colliding pieces in the same order, whatever their IDs (stairdraw.23)", () => {
    const doc = room({ type: "placeObject", linked: false, opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 4.8, y: 2.5 }, rotation: 0, deck: null });
    const tried = (opId: string): string => {
      const r = execute(doc, { type: "placeStair", opId, state: "s0", kind: "spiralStair", surface: null, deck: LOFT, at: { x: 3.6, y: 2.5 }, shape: "straight" });
      if (r.ok) throw new Error("it fitted");
      return r.error.message;
    };
    expect(tried("a0")).toContain("overlap");
    expect(tried("a0")).toBe(tried("zz"));
  });

  it("a selected stair has no name drawn across its treads (stairs)", () => {
    const shell = FakeShell.withDocument(room({ type: "placeObject", linked: false, opId: "st", state: "s0", object: { kind: "stair" }, at: { x: 3.6, y: 2.5 }, rotation: 90, deck: null, reaches: LOFT }));
    shell.click({ x: 5, y: 2.5 });
    expect(shell.state.selection[0]?.table).toBe("placements");
    const texts = (shell.scene().layers.find((l) => l.name === "objects")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(texts).not.toContain("Stair");
    expect(texts.some((t) => t.startsWith("UP"))).toBe(true);
  });
});
