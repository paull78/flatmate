import { describe, expect, it } from "vitest";
import { levelOf, type Command, type Document } from "@fm/domain";
import { floorView, viewAt } from "../src/view/plan-view";
import { warningMarks, warningRows } from "../src/view/warnings";
import type { Primitive } from "../src/view/scene-types";
import { cabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The guard warning (AC-01, guards.05, .16): a deck higher than 0.76 m set to None, at the floor and at its own level, in
// every layout. The cabin's loft has one open edge, x 2.10, y 0.10–2.90.

const LOFT = "loft/k0";
const none: Command = { type: "setDeck", deckId: LOFT, guard: "none" };
const view = (doc: Document, deck: string | null = null, layout = "s0") => viewAt(layout, deck === null ? floorView(doc, layout).level : levelOf(doc, deck));
const texts = (doc: Document, deck: string | null = null, layout = "s0"): string[] => warningRows(doc, view(doc, deck, layout)).map((r) => r.text);
const glyphs = (ps: readonly Primitive[]) => ps.filter((p): p is Extract<Primitive, { kind: "text" }> => p.kind === "text");

describe("a loft set to None", () => {
  it("warns at the floor and at its own level", () => {
    const doc = withCommands(cabinDoc(), none);
    expect(texts(doc)).toEqual(["No guard on Loft's right side"]);
    expect(texts(doc, LOFT)).toEqual(["No guard on Loft's right side"]);
  });

  it("warns in every layout, a deck being shared", () => {
    const doc = withCommands(cabinDoc(), none, { type: "addState", opId: "n", name: "Night" });
    expect(texts(doc, null, "n/s0")).toEqual(["No guard on Loft's right side"]);
  });

  it("not when viewing another loft's level", () => {
    const doc = withCommands(cabinDoc(), none, { type: "addDeck", opId: "m", preset: "loft", at: { x: 3.2, y: 1.5 }, w: 1, d: 1, top: 1.5 });
    expect(texts(doc, "m/k0")).toEqual([]);
  });

  it("its mark sits at the middle of the longest open edge, and the count equals the marks", () => {
    const doc = withCommands(cabinDoc(), none);
    const marks = glyphs(warningMarks(doc, view(doc), 80));
    expect(marks).toHaveLength(texts(doc).length);
    expect(marks[0]?.at).toEqual({ x: expect.closeTo(2.1, 6), y: expect.closeTo(1.5, 6) });
  });

  it("with several open edges, the longest's", () => {
    const doc = withCommands(cabinDoc(), { type: "addDeckHole", opId: "n", deck: LOFT, at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 }, none);
    expect(glyphs(warningMarks(doc, view(doc), 80))[0]?.at).toEqual({ x: expect.closeTo(2.1, 6), y: expect.closeTo(1.175, 6) });
  });

  it("clicking its row selects the deck", () => {
    const doc = withCommands(cabinDoc(), none);
    const [row] = warningRows(doc, view(doc));
    expect(row?.ref).toEqual({ table: "decks", id: LOFT });
    const shell = FakeShell.withDocument(doc);
    if (row) shell.ui({ type: "selectEntity", ref: row.ref });
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT }]);
  });

  it("setting it back clears the row and the mark", () => {
    const doc = withCommands(cabinDoc(), none, { type: "setDeck", deckId: LOFT, guard: "railing" });
    expect(texts(doc)).toEqual([]);
    expect(glyphs(warningMarks(doc, view(doc), 80))).toEqual([]);
  });

  it("turning it off blinks the warnings count, as a new warning does", () => {
    const shell = FakeShell.withDocument(cabinDoc());
    const before = shell.state.warningBlink;
    shell.command(none);
    expect(shell.state.warningBlink).toBe(before + 1);
  });
});

describe("what doesn't warn", () => {
  it("a low deck set to None: only the loft's row shows", () => {
    const doc = withCommands(cabinDoc(), none, { type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1 });
    expect(texts(doc)).toEqual(["No guard on Loft's right side"]);
  });

  it("a raised platform does, keeping its None", () => {
    const doc = withCommands(cabinDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1 }, { type: "setDeck", deckId: "p/k0", top: 0.9 });
    expect(texts(doc)).toEqual(["No guard on Platform's lower side", "No guard on Platform's right side", "No guard on Platform's upper side", "No guard on Platform's left side"]);
  });

  it("a rail the ceiling cuts short, under 0.90 m", () => {
    const doc = withCommands(cabinDoc(), { type: "setCeiling", height: 2.8 });
    expect(texts(doc)).toEqual([]);
  });

  it("a high deck with no open edge: walls all round", () => {
    const doc = withCommands(cabinDoc(), { type: "addWall", opId: "w", from: { at: { x: 2.2, y: 0 } }, to: { at: { x: 2.2, y: 3 } } }, none);
    expect(texts(doc)).toEqual([]);
  });
});

describe("found in review", () => {
  it("a blank-named deck's row reads as its plan label does", () => {
    const doc = withCommands(cabinDoc(), none, { type: "setDeck", deckId: LOFT, name: "" });
    expect(texts(doc)).toEqual(["No guard on Deck's right side"]);
  });
});

// One row per side or hole (edges.04, AC-06): each names what to fix and selects where it's set.
describe("a row per side and per hole", () => {
  it("the right side and a hole set to None: two rows, two marks; a row selects the deck, or the hole", () => {
    const doc = withCommands(
      cabinDoc(),
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1, y: 1.5 }, w: 0.6, d: 0.6 },
      { type: "setDeckHole", holeId: "h/h0", guard: { kind: "none" } },
      { type: "setDeck", deckId: LOFT, guardRight: { kind: "none" } },
    );
    const s = FakeShell.withDocument(doc);
    const rows = s.view().warnings.rows;
    expect(rows.map((r) => r.text)).toEqual(["No guard on Loft's right side", "No guard round a hole in Loft"]);
    expect(rows.map((r) => r.ref)).toEqual([{ table: "decks", id: LOFT }, { table: "deckHoles", id: "h/h0" }]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("a 0.30 Railing on the right side clears its row and leaves the hole's", () => {
    const doc = withCommands(
      cabinDoc(),
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1, y: 1.5 }, w: 0.6, d: 0.6 },
      { type: "setDeckHole", holeId: "h/h0", guard: { kind: "none" } },
      { type: "setDeck", deckId: LOFT, guardRight: { kind: "railing", height: 0.3 } },
    );
    expect(FakeShell.withDocument(doc).view().warnings.rows.map((r) => r.text)).toEqual(["No guard round a hole in Loft"]);
  });
});
