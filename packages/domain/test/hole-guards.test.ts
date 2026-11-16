import { describe, expect, it } from "vitest";
import type { StoredDocument } from "@fm/protocol";
import { emptyDocument, execute, fromStored, guardRuns, rectangleRoom, toStored, upgradeStored, type Command, type Document } from "../src";

// A hole's own guard (edges.01, .02; AC-02, AC-04, AC-05): one kind and height for all its sides, chosen from its deck's
// top when cut, set on its own; an older hole takes its deck's old guard on load.

const LOFT = "l/k0";
const HOLE = "h/h0";
const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
/** An 8 × 6 room, 3.05 ceiling, a free 3 × 3 loft at (4, 3), top 2.15, with a 1 × 1 hole in its middle. */
const room = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 4, y: 3 }, w: 3, d: 3, top: 2.15 },
  { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 4, y: 3 }, w: 1, d: 1 },
  ...more,
);
const holeRuns = (doc: Document) => guardRuns(doc).filter((r) => r.hole === HOLE);
const sideRuns = (doc: Document) => guardRuns(doc).filter((r) => r.deck === LOFT && r.side !== null);

describe("a new hole", () => {
  it("in a 2.15 loft starts with Railing at 1.00", () => {
    expect(room().deckHoles[HOLE]?.guard).toEqual({ kind: "railing", height: 1 });
  });

  it("in a 0.45 platform starts with None", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"),
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 4, y: 3 }, w: 3, d: 3 },
      { type: "addDeckHole", opId: "h", deck: "p/k0", at: { x: 4, y: 3 }, w: 1, d: 1 },
    );
    expect(doc.deckHoles[HOLE]?.guard).toEqual({ kind: "none", height: 1 });
  });

  it("given a guard keeps it", () => {
    const doc = room({ type: "addDeckHole", opId: "g", deck: LOFT, at: { x: 3, y: 2 }, w: 0.5, d: 0.5, guard: { kind: "glass", height: 0.9 } });
    expect(doc.deckHoles["g/h0"]?.guard).toEqual({ kind: "glass", height: 0.9 });
  });
});

describe("setting a hole's guard", () => {
  it("sets its kind and keeps its place and height", () => {
    const before = room();
    const after = room({ type: "setDeckHole", holeId: HOLE, guard: { kind: "glass" } });
    expect(after.deckHoles[HOLE]).toEqual({ ...before.deckHoles[HOLE], guard: { kind: "glass", height: 1 } });
  });

  it("refuses a height out of range and an unknown kind, with the deck's reasons", () => {
    const doc = room();
    const msg = (cmd: Command): string => {
      const r = execute(doc, cmd);
      return r.ok ? "accepted" : r.error.message;
    };
    expect(msg({ type: "setDeckHole", holeId: HOLE, guard: { height: 1.2 } })).toBe("Guard height must be 0.30 to 1.10 m");
    expect(msg({ type: "setDeckHole", holeId: HOLE, guard: { kind: "wood" } } as unknown as Command)).toBe("Invalid guard: railing, glass or none");
  });
});

describe("a hole's sides in guardRuns (AC-02)", () => {
  it("a Glass hole draws Glass on its four sides while the loft's sides keep Railing", () => {
    const doc = room({ type: "setDeckHole", holeId: HOLE, guard: { kind: "glass" } });
    expect(holeRuns(doc).map((r) => r.kind)).toEqual(["glass", "glass", "glass", "glass"]);
    expect(holeRuns(doc).every((r) => r.side === null)).toBe(true);
    expect(sideRuns(doc).map((r) => r.kind)).toEqual(["railing", "railing", "railing", "railing"]);
  });

  it("a None hole draws nothing round it, and the loft's sides still do", () => {
    const doc = room({ type: "setDeckHole", holeId: HOLE, guard: { kind: "none" } });
    expect(holeRuns(doc)).toEqual([]);
    expect(sideRuns(doc)).toHaveLength(4);
  });

  it("the hole's height is its own: a 0.30 hole guard tops at 2.45 while the sides reach the ceiling", () => {
    const doc = room({ type: "setDeckHole", holeId: HOLE, guard: { height: 0.3 } });
    for (const r of holeRuns(doc)) expect(r.top).toBeCloseTo(2.45, 9);
    for (const r of sideRuns(doc)) expect(r.top).toBeCloseTo(3.05, 9);
  });

  it("a side set to None leaves the hole's guard", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guard: "none" });
    expect(holeRuns(doc)).toHaveLength(4);
  });
});

describe("a stored file", () => {
  it("an old hole takes its deck's old guard at 1.00", () => {
    const stored = toStored(room());
    const decks = Object.fromEntries(Object.entries(stored.decks).map(([id, row]) => {
      const rest: Record<string, unknown> = { ...row };
      for (const f of ["guardFront", "guardRight", "guardBack", "guardLeft"]) delete rest[f];
      return [id, { ...rest, guard: "glass" }];
    }));
    const holes = Object.fromEntries(Object.entries(stored.deckHoles).map(([id, row]) => {
      const rest: Record<string, unknown> = { ...row };
      delete rest.guard;
      return [id, rest];
    }));
    const r = fromStored(upgradeStored({ ...stored, decks, deckHoles: holes } as unknown as StoredDocument));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.deckHoles[HOLE]?.guard).toEqual({ kind: "glass", height: 1 });
  });

  it("an old hole in a deck with no guard reads the deck's top", () => {
    const stored = toStored(room());
    const decks = Object.fromEntries(Object.entries(stored.decks).map(([id, row]) => {
      const rest: Record<string, unknown> = { ...row };
      for (const f of ["guardFront", "guardRight", "guardBack", "guardLeft"]) delete rest[f];
      return [id, rest];
    }));
    const holes = Object.fromEntries(Object.entries(stored.deckHoles).map(([id, row]) => {
      const rest: Record<string, unknown> = { ...row };
      delete rest.guard;
      return [id, rest];
    }));
    const r = fromStored(upgradeStored({ ...stored, decks, deckHoles: holes } as unknown as StoredDocument));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.deckHoles[HOLE]?.guard).toEqual({ kind: "railing", height: 1 });
  });

  it("a saved hole round-trips, and a bad guard is refused", () => {
    const doc = room({ type: "setDeckHole", holeId: HOLE, guard: { kind: "glass", height: 0.6 } });
    const r = fromStored(toStored(doc));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.deckHoles[HOLE]).toEqual(doc.deckHoles[HOLE]);
    const stored = toStored(doc);
    const bad = { ...stored, deckHoles: { [HOLE]: { ...stored.deckHoles[HOLE], guard: { kind: "glass", height: 2 } } } } as StoredDocument;
    expect(fromStored(bad).ok).toBe(false);
  });
});
