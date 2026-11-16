import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { planPicture } from "../src/view/picture";
import { textWidth } from "../src/view/fonts";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// "Open to below" (edges.07, .23; AC-10): at a loft's level, in each room the loft covers in part and in each empty hole,
// in every picture of the level; never at the floor, never where it doesn't fit, never selectable.

const LOFT = "l/k0";
/** A 7 × 4 room (clear x 0.1–6.9, y 0.1–3.9), 3.05 ceiling, a loft over x 0.1–2.5, top 2.15. */
const studio = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 4, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.3, y: 2 }, w: 2.4, d: 3.8 },
  ...more,
);
const loftLevel = (doc: Document): Level => {
  const l = levels(doc).find((x) => x.deckIds.includes(LOFT));
  if (!l) throw new Error("no level");
  return l;
};
type Text = Extract<Primitive, { kind: "text" }>;
const words = (ps: readonly Primitive[]): Text[] => ps.filter((p): p is Text => p.kind === "text" && /open to|below/i.test(p.text));
const atLoft = (doc: Document, zoom = 80, style = CANVAS_STYLE) => planPicture(doc, viewAt("s0", loftLevel(doc)), style, zoom, true);

describe("Open to below on the plan", () => {
  it("at the loft's level, one label inside the room's uncovered part", () => {
    const texts = words(atLoft(studio()).tags);
    expect(texts.map((t) => t.text)).toEqual(["Open to below"]);
    const at: Point | undefined = texts[0]?.at;
    expect(at && at.x > 2.5 && at.x < 6.9 && at.y > 0.1 && at.y < 3.9).toBe(true);
    expect(texts[0]?.color).toBe(CANVAS_STYLE.tag.muted);
  });

  it("at the floor, none", () => {
    const doc = studio();
    expect(words(planPicture(doc, floorView(doc, "s0"), CANVAS_STYLE, 80, true).tags)).toEqual([]);
  });

  it("an empty hole gets one at its centre; a hole too small for the words gets none", () => {
    const big = studio({ type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1.3, y: 2 }, w: 1.6, d: 2 });
    const texts = words(atLoft(big).tags);
    expect(texts.some((t) => Math.abs(t.at.x - 1.3) < 1e-9)).toBe(true);
    const small = studio({ type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1.3, y: 2 }, w: 0.3, d: 0.3 });
    expect(words(atLoft(small).tags).length).toBe(1); // the room's only
  });

  it("splits onto two lines where one doesn't fit and two do", () => {
    // A hole whose half-width lies between what two lines need and what one line needs, measured in the canvas font.
    const zoom = 80;
    const tag = CANVAS_STYLE.tag;
    const one = Math.hypot(textWidth(CANVAS_STYLE.font, "Open to below", tag.size) / zoom / 2, tag.size / zoom / 2);
    const two = Math.hypot(textWidth(CANVAS_STYLE.font, "Open to", tag.size) / zoom / 2, (tag.size + tag.line) / zoom / 2);
    expect(two).toBeLessThan(one);
    const w = Math.round((one + two) * 1000) / 1000; // twice the midpoint: a clear between the two
    const doc = studio({ type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1.3, y: 2 }, w, d: 2 });
    const inHole = words(atLoft(doc, zoom).tags).filter((t) => Math.abs(t.at.x - 1.3) < 1e-9);
    expect(inHole.map((t) => t.text)).toEqual(["Open to", "below"]);
    expect((inHole[0]?.at.y ?? 0) > (inHole[1]?.at.y ?? 0)).toBe(true); // "Open to" above "below"
  });

  it("on paper too, in paper's muted ink", () => {
    const texts = words(atLoft(studio(), 80, PRESENTATION_STYLE).tags);
    expect(texts).toHaveLength(1);
    expect(texts[0]?.color).toBe(PRESENTATION_STYLE.tag.muted);
  });
});

describe("on the canvas", () => {
  it("shows at the loft's level, and a click on it selects nothing new", () => {
    const shell = FakeShell.withDocument(studio());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    const layer = shell.scene().layers.find((l) => l.name === "tags");
    const texts = words(layer?.primitives ?? []);
    expect(texts).toHaveLength(1);
    const at = texts[0]?.at ?? { x: 0, y: 0 };
    shell.click(at);
    expect(shell.state.selection).toEqual([]);
  });
});
