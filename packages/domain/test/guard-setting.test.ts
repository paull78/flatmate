import { describe, expect, it } from "vitest";
import { GUARD_DROP, sameGuards, emptyDocument, execute, rectangleRoom, type Command, type Document } from "../src";

// A deck always stores its guard (AC-04, guards.11): chosen from its top when it's created, and kept when the top changes.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of [...rectangleRoom({ x: 0, y: 0 }, 6, 4, "r"), { type: "setCeiling" as const, height: 3.05 }, ...cmds]) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const loft: Command = { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.5, y: 2 }, w: 2, d: 2 };
const platform: Command = { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 2 }, w: 1, d: 1 };

describe("a new deck", () => {
  it("a loft starts with a railing, a platform with none", () => {
    const doc = build(loft, platform);
    expect(doc.decks["l/k0"]?.guardFront.kind).toBe("railing");
    expect(doc.decks["p/k0"]?.guardFront.kind).toBe("none");
  });

  it("picks by its own top, either side of 0.76 m", () => {
    expect(GUARD_DROP).toBe(0.76);
    const at = (top: number): string | undefined => build({ ...platform, top } as Command).decks["p/k0"]?.guardFront.kind;
    expect(at(0.76)).toBe("none");
    expect(at(0.77)).toBe("railing");
  });

  it("given a guard keeps it, and a bad one is refused with its reason", () => {
    expect(build({ ...platform, guard: "glass" } as Command).decks["p/k0"]?.guardFront.kind).toBe("glass");
    const r = execute(build(), { ...loft, guard: "wood" } as unknown as Command);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("guard");
  });
});

describe("changing a deck", () => {
  it("raising a platform past 0.76 keeps its none", () => {
    const doc = build(platform, { type: "setDeck", deckId: "p/k0", top: 2.15, solid: false });
    expect(doc.decks["p/k0"]?.guardFront.kind).toBe("none");
  });

  it("lowering a loft keeps its railing", () => {
    const doc = build(loft, { type: "setDeck", deckId: "l/k0", top: 0.45, solid: true });
    expect(doc.decks["l/k0"]?.guardFront.kind).toBe("railing");
  });

  it("setDeck changes only the guard", () => {
    const before = build(loft);
    const r = execute(before, { type: "setDeck", deckId: "l/k0", guard: "glass" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.decks["l/k0"]).toEqual({ ...before.decks["l/k0"], ...sameGuards("glass") });
    expect(execute(before, { type: "setDeck", deckId: "l/k0", guard: "none" }).ok).toBe(true);
    expect(execute(before, { type: "setDeck", deckId: "l/k0", guard: "x" } as unknown as Command).ok).toBe(false);
  });
});

// Stored files: deck-guards.test.ts (edges.01).
