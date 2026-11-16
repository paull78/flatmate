import { describe, expect, it } from "vitest";
import type { Host } from "../src/ports/host";
import { textWidth } from "../src/view/fonts";
import { dimensionLayout } from "../src/view/dimension-layout";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/picture";
import { tagLayout } from "../src/view/tags";
import { deckLabelBox, labelledDecks } from "../src/view/deck-label";
import { levelOf } from "@fm/domain";
import { roomDoc, withCommands } from "./builders";

// The core measures by tables (render.06, .15; AC-02): every width comes from textWidth in the style's font, and no
// host is asked.

describe("the core measures by tables (AC-02)", () => {
  it("no host measures text", () => {
    const keys: (keyof Host)[] = ["now", "today", "newId"];
    // @ts-expect-error -- the Host has no textMetrics (render.15)
    const gone: keyof Host = "textMetrics";
    expect(keys).not.toContain(gone);
  });

  it("a dimension's text fits by the style's font: Inter on the canvas, Helvetica on paper", () => {
    const value = "3.00";
    const inter = textWidth("inter", value, CANVAS_STYLE.dim.textSize);
    const helvetica = textWidth("helvetica", value, CANVAS_STYLE.dim.textSize);
    expect(inter).toBeGreaterThan(helvetica);
    // A span whose pixels fit the Helvetica text and its gaps but not Inter's: same size, two styles' fonts.
    const px = (inter + helvetica) / 2 + 2 * CANVAS_STYLE.dim.textGap;
    const zoom = px / 3;
    const canvas = dimensionLayout({ x: 0, y: 0 }, { x: 3, y: 0 }, 0.5, CANVAS_STYLE, zoom);
    const paper = dimensionLayout({ x: 0, y: 0 }, { x: 3, y: 0 }, 0.5, { ...CANVAS_STYLE, font: "helvetica" }, zoom);
    expect(canvas?.text.at.x).toBeGreaterThan(3); // overflows past the end
    expect(paper?.text.at.x).toBeCloseTo(1.5, 9); // centred between the ticks
  });

  it("a tag's plate is as wide as its widest line in the style's font", () => {
    const doc = withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Living", finish: null });
    for (const style of [CANVAS_STYLE, PRESENTATION_STYLE]) {
      const zoom = style === CANVAS_STYLE ? 80 : 20;
      const tag = tagLayout(doc, "L1", { zoom }, null, style);
      if (!tag) throw new Error("no tag");
      const widest = Math.max(...tag.lines.map((l) => textWidth(style.font, l.text, style.tag.size)));
      expect((tag.max.x - tag.min.x) * zoom).toBeCloseTo(widest + 2 * style.tag.pad, 9);
    }
  });

  it("a deck label's plate is as wide as its title in the style's font, on paper too", () => {
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 });
    const [deck] = labelledDecks(doc, levelOf(doc, null));
    if (!deck) throw new Error("no labelled deck");
    for (const [style, zoom] of [[CANVAS_STYLE, 80], [PRESENTATION_STYLE, 20]] as const) {
      const box = deckLabelBox(deck, style, zoom);
      const title = textWidth(style.font, "Loft +2.15", style.deck.label.size);
      expect((box.max.x - box.min.x) * zoom, style.font).toBeCloseTo(title + 2 * style.tag.pad, 9);
    }
  });
});
