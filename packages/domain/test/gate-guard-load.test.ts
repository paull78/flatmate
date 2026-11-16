import { describe, expect, it } from "vitest";
import { parseStoredDocument } from "@fm/protocol";
import { deserialize, emptyDocument, execute, fromStored, missingGuards, rectangleRoom, serialize, upgradeStored, validateDocument, type Command, type Document } from "../src";

// The final gate's AC-04 gap: a file with no guard opens valid, through both load paths, its decks reading the guard by
// their top: the file import (deserialize) and the server's (parseStoredDocument, upgradeStored, fromStored).

const build = (...cmds: Command[]): Document => [...rectangleRoom({ x: 0, y: 0 }, 6, 4, "r"), { type: "setCeiling", height: 3.05 } satisfies Command, ...cmds]
  .reduce((doc, c) => {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    return r.value.doc;
  }, emptyDocument());

/** A saved file of a loft (2.15), a platform (0.45) and a platform raised to 0.90 (its None kept), every deck's `guard` taken out. */
const oldFile = () => {
  const doc = build(
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.5, y: 2 }, w: 2, d: 2 },
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 1 }, w: 1, d: 1 },
    { type: "addDeck", opId: "q", preset: "platform", at: { x: 4.5, y: 3 }, w: 1, d: 1 },
    { type: "setDeck", deckId: "q/k0", top: 0.9 },
  );
  expect(doc.decks["q/k0"]?.guardFront.kind).toBe("none");
  const decks = Object.fromEntries(Object.values(doc.decks).map((row) => {
    const rest: Record<string, unknown> = { ...row };
    for (const f of ["guardFront", "guardRight", "guardBack", "guardLeft"]) delete rest[f];
    return [row.id, rest];
  }));
  return { ...serialize(doc), decks };
};

describe("a file with no guard (AC-04)", () => {
  it("opens valid through both load paths, each deck's guard read by its top", () => {
    const file = oldFile();
    expect(Object.values(file.decks).some((row) => "guardFront" in row || "guard" in row)).toBe(false);
    const imported = deserialize(file);
    if (!imported.ok) throw new Error(imported.error.message);
    const parsed = parseStoredDocument(file, "empty");
    if (!parsed) throw new Error("not a stored document");
    const served = fromStored(upgradeStored(parsed));
    if (!served.ok) throw new Error(served.error.message);
    for (const doc of [imported.value, served.value]) {
      expect(validateDocument(doc).ok).toBe(true);
      expect(Object.fromEntries(Object.values(doc.decks).map((d) => [d.id, d.guardFront.kind]))).toEqual({ "l/k0": "railing", "p/k0": "none", "q/k0": "railing" });
      expect(missingGuards(doc)).toEqual([]);
    }
  });
});
