import { describe, expect, it } from "vitest";
import type { StoredDocument } from "@fm/protocol";
import { DECK_SIDES, emptyDocument, execute, fromStored, rectangleRoom, sameGuards, sideField, toStored, upgradeStored, type Command, type Document } from "../src";

// A guard per side of a deck (edges.01, .02, .08): four fields, each a kind and a height, chosen from the top at
// creation, each set on its own; an older row's one guard goes to all four at 1.00 (AC-04, AC-05).

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
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  if (r.ok) throw new Error("expected a refusal");
  return r.error.message;
};

describe("a new deck's sides", () => {
  it("a 2.15 loft gets Railing at 1.00 on all four sides", () => {
    const deck = build(loft).decks["l/k0"];
    expect(deck && DECK_SIDES.map((s) => deck[sideField(s)])).toEqual(DECK_SIDES.map(() => ({ kind: "railing", height: 1 })));
  });

  it("a 0.45 platform gets None on all four", () => {
    expect(build(platform).decks["p/k0"]).toMatchObject(sameGuards("none"));
  });

  it("given one guard, all four sides take it; given a side, only that side differs", () => {
    expect(build({ ...platform, guard: "glass" } as Command).decks["p/k0"]).toMatchObject(sameGuards("glass"));
    const deck = build({ ...loft, guardRight: { kind: "none" } } as Command).decks["l/k0"];
    expect(deck?.guardRight).toEqual({ kind: "none", height: 1 });
    expect(deck?.guardFront).toEqual({ kind: "railing", height: 1 });
  });
});

describe("setting one side", () => {
  it("sets one side's kind and keeps the others", () => {
    const before = build(loft);
    const r = execute(before, { type: "setDeck", deckId: "l/k0", guardRight: { kind: "none" } });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.decks["l/k0"]).toEqual({ ...before.decks["l/k0"], guardRight: { kind: "none", height: 1 } });
  });

  it("sets a side's height and keeps its kind, to the millimetre", () => {
    const doc = build(loft, { type: "setDeck", deckId: "l/k0", guardBack: { height: 0.3004 } });
    expect(doc.decks["l/k0"]?.guardBack).toEqual({ kind: "railing", height: 0.3 });
  });

  it("a None side keeps its height, so switching back restores it", () => {
    const doc = build(
      loft,
      { type: "setDeck", deckId: "l/k0", guardLeft: { height: 0.5 } },
      { type: "setDeck", deckId: "l/k0", guardLeft: { kind: "none" } },
      { type: "setDeck", deckId: "l/k0", guardLeft: { kind: "glass" } },
    );
    expect(doc.decks["l/k0"]?.guardLeft).toEqual({ kind: "glass", height: 0.5 });
  });

  it("one guard for all sets every kind and keeps every height", () => {
    const doc = build(loft, { type: "setDeck", deckId: "l/k0", guardBack: { height: 0.3 } }, { type: "setDeck", deckId: "l/k0", guard: "glass" });
    expect(doc.decks["l/k0"]?.guardBack).toEqual({ kind: "glass", height: 0.3 });
    expect(doc.decks["l/k0"]?.guardFront).toEqual({ kind: "glass", height: 1 });
  });

  it("a height outside 0.30–1.10 is refused with the range in the reason", () => {
    const doc = build(loft);
    expect(refusal(doc, { type: "setDeck", deckId: "l/k0", guardFront: { height: 1.2 } })).toBe("Guard height must be 0.30 to 1.10 m");
    expect(refusal(doc, { type: "setDeck", deckId: "l/k0", guardFront: { height: 0.2 } })).toBe("Guard height must be 0.30 to 1.10 m");
    expect(execute(doc, { type: "setDeck", deckId: "l/k0", guardFront: { height: 1.1 } }).ok).toBe(true);
    expect(execute(doc, { type: "setDeck", deckId: "l/k0", guardFront: { height: 0.3 } }).ok).toBe(true);
  });

  it("an unknown kind, or a side value that isn't a record, is refused", () => {
    const doc = build(loft);
    expect(refusal(doc, { type: "setDeck", deckId: "l/k0", guardFront: { kind: "wood" } } as unknown as Command)).toBe("Invalid guard: railing, glass or none");
    expect(refusal(doc, { type: "setDeck", deckId: "l/k0", guardFront: "railing" } as unknown as Command)).toBe("Invalid guard: railing, glass or none");
  });
});

describe("a stored file", () => {
  const withRows = (doc: Document, edit: (row: Record<string, unknown>) => Record<string, unknown>): StoredDocument => {
    const stored = toStored(doc);
    return { ...stored, decks: Object.fromEntries(Object.entries(stored.decks).map(([id, row]) => [id, edit({ ...row })])) } as StoredDocument;
  };
  const oldRow = (guard: string | null) => (row: Record<string, unknown>): Record<string, unknown> => {
    for (const s of DECK_SIDES) delete row[sideField(s)];
    return guard === null ? row : { ...row, guard };
  };

  it("an old row's guard goes to its four sides at 1.00", () => {
    const r = fromStored(upgradeStored(withRows(build(platform), oldRow("glass")))); // the server's path; deserialize fills the same way
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.decks["p/k0"]).toMatchObject(sameGuards("glass"));
    expect(r.value.decks["p/k0"]).not.toHaveProperty("guard");
  });

  it("an old row with no guard reads its top", () => {
    const r = fromStored(upgradeStored(withRows(build(loft, platform), oldRow(null))));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.decks["l/k0"]).toMatchObject(sameGuards("railing"));
    expect(r.value.decks["p/k0"]).toMatchObject(sameGuards("none"));
  });

  it("a saved four-sided deck round-trips unchanged", () => {
    const doc = build(loft, { type: "setDeck", deckId: "l/k0", guardRight: { kind: "none", height: 0.4 } }, { type: "setDeck", deckId: "l/k0", guardBack: { kind: "glass" } });
    const r = fromStored(toStored(doc));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.decks["l/k0"]).toEqual(doc.decks["l/k0"]);
  });

  it("refuses a row with a bad kind, a height out of range, or both the old field and the sides", () => {
    const doc = build(loft);
    expect(fromStored(withRows(doc, (row) => ({ ...row, guardFront: { kind: "wood", height: 1 } }))).ok).toBe(false);
    expect(fromStored(withRows(doc, (row) => ({ ...row, guardFront: { kind: "railing", height: 2 } }))).ok).toBe(false);
    expect(fromStored(withRows(doc, (row) => ({ ...row, guardFront: { kind: "railing" } }))).ok).toBe(false);
    expect(fromStored(withRows(doc, (row) => ({ ...row, guard: "railing" }))).ok).toBe(false);
  });
});
