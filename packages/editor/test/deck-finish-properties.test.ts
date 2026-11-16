import { describe, expect, it } from "vitest";
import { motifDefaults, withMotif, type Document, type Finish } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import type { Field } from "../src/view/view-model-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A deck's finish in Properties (deck-floors.02; AC-05, AC-07's plan): the Deck section gains the room's Floor, Colour,
// Hex, Strength, Size and Angle, sending setDeckFinish; the motif-change rule and the refusals are the room's.
//
// The 5.8 × 3.8 shell (roomDoc) with a platform P (0.45) over x 0.5–2.5, y 0.3–1.7.

const P = "p/k0";
const ON_P = { x: 0.8, y: 0.6 };

function studio(finish: Finish | null = null): Document {
  return withCommands(
    roomDoc(),
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.5, y: 1 }, w: 2, d: 1.4 },
    ...(finish ? [{ type: "setDeckFinish" as const, deckId: P, finish }] : []),
  );
}
function selected(finish: Finish | null = null): FakeShell {
  const shell = FakeShell.withDocument(studio(finish));
  shell.click(ON_P);
  expect(shell.state.selection).toEqual([{ table: "decks", id: P }]);
  return shell;
}
const fields = (shell: FakeShell): Field[] => {
  const p = shell.view().properties;
  return "fields" in p ? p.fields.filter((f) => f.section === "Deck") : []; // the Guards group follows (guard-properties.test.ts)
};
const fieldOf = (shell: FakeShell, id: string): Field | undefined => fields(shell).find((f) => f.id === id);
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const finishOf = (shell: FakeShell): Finish | null | undefined => shell.doc().decks[P]?.finish;

describe("the Deck section's finish fields (AC-05)", () => {
  it("a deck without a finish shows Floor None after its own fields, and no other finish field", () => {
    const shell = selected();
    const ids = fields(shell).map((f) => f.id);
    expect(ids).toEqual(["name", "top", "solid", "width", "depth", "rotation", "row:floor", "floor"]);
    expect(fieldOf(shell, "floor")).toMatchObject({ section: "Deck", label: "Pattern", value: "none", readOnly: false, select: true });
  });

  it("choosing Planks sends setDeckFinish with the motif's defaults; the fields then show its values", () => {
    const shell = selected();
    set(shell, "floor", "planks");
    expect(finishOf(shell)).toEqual(motifDefaults("planks"));
    expect(fields(shell).slice(7).map((f) => [f.id, f.value])).toEqual([
      ["floor", "planks"], ["colour", "#c8a27a"], ["hex", "#c8a27a"], ["strength", "45"], ["size", "0.200"], ["angle", "0"],
    ]);
  });

  it("a motif change keeps the colour and the direction (withMotif); Hex and Strength edit the finish", () => {
    const start = { ...motifDefaults("planks"), colour: "#a99c8a", angle: 90 };
    const shell = selected(start);
    set(shell, "floor", "herringbone");
    expect(finishOf(shell)).toEqual(withMotif(start, "herringbone"));
    set(shell, "hex", "#7a5236");
    set(shell, "strength", "60");
    expect(finishOf(shell)).toEqual({ ...withMotif(start, "herringbone"), colour: "#7a5236", strength: 60 });
  });

  it("a typed size out of range toasts the refusal naming Size; None clears the finish", () => {
    const shell = selected(motifDefaults("cementTiles"));
    set(shell, "size", "0.5");
    expect(shell.view().toast).toBe("Size must be 0.15–0.40");
    expect(finishOf(shell)?.size).toBe(0.2);
    set(shell, "floor", "none");
    expect(finishOf(shell)).toBeNull();
  });

  it('a pattern too fine for the deck reads "Pattern too fine for this deck"', () => {
    const big = withCommands(roomDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 }, w: 5.6, d: 3.6 }, { type: "setDeckFinish", deckId: P, finish: { ...motifDefaults("mosaic"), size: 0.02 } });
    const shell = FakeShell.withDocument(big);
    shell.click({ x: 1, y: 1 });
    expect(fieldOf(shell, "finishNote")?.value).toBe("Pattern too fine for this deck");
  });
});

describe("a selected finished deck on the plan (AC-07)", () => {
  it("keeps its pattern, with its outline in the selection blue", () => {
    const shell = selected(motifDefaults("planks"));
    const layer = (name: string): readonly Primitive[] => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
    expect(layer("deckFloors").some((p) => p.kind === "polygon" && p.color === motifDefaults("planks").colour)).toBe(true);
    expect(layer("decks").some((p) => p.kind === "segment" && p.color === COLORS.wallSelected)).toBe(true);
  });
});
