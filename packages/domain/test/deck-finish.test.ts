import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import type { Document } from "../src/model";
import { parseDeck } from "../src/shape";
import { validateDocument } from "../src/validate";
import { tinyHouse, withDeck } from "./helpers";

// A deck's finish (deck-floors.01, .04; AC-01): the label's rules and checks, through its own command, which depends on
// the deck row alone.

const house = (): Document => withDeck(tinyHouse(), { id: "L", name: "Loft", at: [1, 1.25], w: 1.6, d: 2.2, top: 2.15, solid: false });
const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

describe("setDeckFinish (AC-01)", () => {
  it("sets a finish on a deck, and null clears it", () => {
    const planks = motifDefaults("planks");
    const finished = run(house(), { type: "setDeckFinish", deckId: "L", finish: planks });
    expect(finished.decks.L?.finish).toEqual(planks);
    expect(run(finished, { type: "setDeckFinish", deckId: "L", finish: null }).decks.L?.finish).toBeNull();
  });

  it("the same finish again commits nothing", () => {
    const finished = run(house(), { type: "setDeckFinish", deckId: "L", finish: motifDefaults("planks") });
    const r = execute(finished, { type: "setDeckFinish", deckId: "L", finish: motifDefaults("planks") });
    if (!r.ok) throw new Error(r.error.message);
    expect([r.value.patch.puts, r.value.patch.deletes]).toEqual([[], []]);
  });

  it("a broken finish is refused naming the field; an unknown deck is not found", () => {
    expect(refusal(house(), { type: "setDeckFinish", deckId: "L", finish: { ...motifDefaults("cementTiles"), size: 0.5 } })).toBe("finish.size must be 0.15–0.40");
    expect(refusal(house(), { type: "setDeckFinish", deckId: "nope", finish: null })).toBe("Deck not found");
  });

  it("its patch depends on the deck row alone", () => {
    const r = execute(house(), { type: "setDeckFinish", deckId: "L", finish: motifDefaults("planks") });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.dependencies).toEqual([{ table: "decks", id: "L" }]);
  });

  it("stores the colour as given by givenColour: six bare hex digits gain their #, upper case is lowered", () => {
    const finished = run(house(), { type: "setDeckFinish", deckId: "L", finish: { ...motifDefaults("planks"), colour: "A99C8A" } });
    expect(finished.decks.L?.finish?.colour).toBe("#a99c8a");
  });
});

describe("a stored deck's finish", () => {
  const row = { id: "L", name: "Loft", at: { x: 1, y: 1.25 }, w: 1.6, d: 2.2, rotation: 0, top: 2.15, solid: false, finish: null, ...sameGuards("railing") };

  it("parseDeck reads a row without finish as null, with one as its finish, and refuses extra keys", () => {
    expect(parseDeck(row)?.finish).toBeNull();
    expect(parseDeck({ ...row, finish: motifDefaults("planks") })?.finish).toEqual(motifDefaults("planks"));
    expect(parseDeck({ ...row, finish: null })?.finish).toBeNull();
    expect(parseDeck({ ...row, colour: "#ffffff" })).toBeNull();
    expect(parseDeck({ ...row, finish: { motif: "planks" } })).toBeNull();
  });

  it("I8 refuses a stored deck whose finish breaks a rule, naming the field", () => {
    const doc = house();
    const deck = doc.decks.L;
    if (!deck) throw new Error("no deck");
    const bad: Document = { ...doc, decks: { L: { ...deck, finish: { ...motifDefaults("planks"), colour: "#ABCDEF" } } } };
    const r = validateDocument(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((v) => v.message).join(" ")).toContain("finish.colour");
  });
});
