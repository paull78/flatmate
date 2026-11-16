import { describe, expect, it } from "vitest";
import { deckViews, execute, levelOf, unwrap, type Command, type Document } from "@fm/domain";
import { deckLabelBox, deckTitle } from "../src/view/deck-label";
import { deckLabelsLayer } from "../src/view/decks-layer";
import { PRESENTATION_STYLE, CANVAS_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import { viewAt, floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";

// A deck's area on its label (areas step 09, areas.10, AC-09): every deck's label gains a second line, its w × d less its
// holes, at every level the label shows and on paper; the area line drops when the label doesn't fit inside the deck.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const LOFT: Command = { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.5, y: 2 }, w: 2.4, d: 1.75 };
const WELL: Command = { type: "addDeckHole", opId: "well", deck: "loft/k0", at: { x: 1.5, y: 2 }, w: 0.8, d: 1 };
const texts = (prims: readonly Primitive[]): string[] => prims.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const ZOOM = 80;

describe("a deck's area on its label (AC-09)", () => {
  it("a 2.40 × 1.75 loft with a 0.80 × 1.00 hole reads Loft +2.15 over 3.40 m², at the floor and at its level", () => {
    const doc = run(roomDoc(), LOFT, WELL);
    expect(texts(deckLabelsLayer(doc, levelOf(doc, null), CANVAS_STYLE, ZOOM))).toEqual(["Loft +2.15", "3.40 m²"]);
    expect(texts(deckLabelsLayer(doc, levelOf(doc, "loft/k0"), CANVAS_STYLE, ZOOM))).toEqual(["Loft +2.15", "3.40 m²"]);
  });

  it("the area line sits under the title, in the label's colour and size", () => {
    const doc = run(roomDoc(), LOFT);
    const [title, area] = deckLabelsLayer(doc, levelOf(doc, null), CANVAS_STYLE, ZOOM).filter((p) => p.kind === "text");
    expect(title?.kind === "text" && area?.kind === "text" && area.at.y < title.at.y && area.at.x === title.at.x).toBe(true);
    expect(area?.kind === "text" && area.color === CANVAS_STYLE.deck.label.color && area.size === CANVAS_STYLE.deck.label.size).toBe(true);
  });

  it("a platform shows its area the same way", () => {
    const doc = run(roomDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 }, w: 2, d: 1.4 });
    expect(texts(deckLabelsLayer(doc, levelOf(doc, null), CANVAS_STYLE, ZOOM))).toEqual(["Platform +0.45", "2.80 m²"]);
  });

  it("a deck too shallow for two lines keeps its title only", () => {
    const doc = run(roomDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 }, w: 2, d: 0.4 });
    expect(texts(deckLabelsLayer(doc, levelOf(doc, null), CANVAS_STYLE, ZOOM))).toEqual(["Platform +0.45"]);
  });

  it("the box covers both lines, and deckTitle stays one line", () => {
    const doc = run(roomDoc(), LOFT);
    const deck = deckViews(doc)[0];
    if (!deck) throw new Error("no deck");
    const box = deckLabelBox(deck, CANVAS_STYLE, ZOOM);
    const [, area] = deckLabelsLayer(doc, levelOf(doc, null), CANVAS_STYLE, ZOOM).filter((p) => p.kind === "text");
    expect(area?.kind === "text" && area.at.y > box.min.y && area.at.y < box.max.y).toBe(true);
    expect(deckTitle(deck)).toBe("Loft +2.15");
  });

  it("the PDF plan sheet draws the loft's area line", () => {
    const doc = run(roomDoc(), LOFT, WELL);
    expect(texts(pictureLayers(planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 40, true)))).toContain("3.40 m²");
    expect(texts(pictureLayers(planPicture(doc, viewAt("s0", levelOf(doc, "loft/k0")), PRESENTATION_STYLE, 40, true)))).toContain("3.40 m²");
  });
});
