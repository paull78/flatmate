import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { flipObjectsLayer, ghostPrimitives, objectsLayer } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { CANVAS_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { place } from "./object-look-helpers";
import { floorView } from "../src/view/plan-view";

// The grey furniture restyle (smart AC-13): every symbol, fill, tile and ghost takes the picked mockup variant, on the
// canvas and on paper, with a lighter detail line inside the outline.

// The warm sand fill and brown line it replaces, as RGB so the repo grep for the old hex stays clean (step 02).
const OLD = [[0xe9, 0xe1, 0xd4], [0x7a, 0x6a, 0x55]].map((rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`);

const configs = OBJECT_KINDS.flatMap((k) => k.configs.map((c) => ({ kind: k.id, config: c.id, w: c.w, d: c.d })));

/** The helper's document plus a second layout s1 holding the same object, moved, as placement p1. */
function withSecondLayout(doc: Document): Document {
  const p = doc.placements["p"];
  if (!p) throw new Error("no placement");
  return {
    ...doc,
    states: { ...doc.states, s1: { id: "s1", name: "Night", order: 1 } },
    placements: { ...doc.placements, p1: { ...p, id: "p1", state: "s1", at: { x: 1, y: 0.5 } } },
  };
}

describe("grey furniture (AC-13)", () => {
  it.each(configs.map((c) => [`${c.kind}.${c.config}`, c] as const))("%s: no symbol, fill, tile or ghost uses the old beige or brown", (_key, c) => {
    const doc = place(c.kind, c.config, c.w, c.d);
    const drawn: Primitive[] = [
      ...objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80),
      ...objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "p", 80),
      ...objectsLayer(doc, floorView(doc, "s0"), PRESENTATION_STYLE, "", 20),
      ...ghostPrimitives({ kind: c.kind, config: c.config, w: c.w, d: c.d, at: { x: 0, y: 0 }, rotation: 0, fits: true }),
      ...flipObjectsLayer(withSecondLayout(doc), floorView(doc, null).level, { from: "s0", to: "s1", t: 0.5 }),
    ];
    expect(drawn.length).toBeGreaterThan(0);
    for (const p of drawn) expect(OLD).not.toContain(p.color.slice(0, 7).toLowerCase());
  });

  it("no palette tile uses the old beige or brown", () => {
    const tiles = PALETTE.flatMap((g) => g.cards).flatMap((k) => [...tileLook(k)]);
    expect(tiles.length).toBeGreaterThan(0);
    for (const p of tiles) expect(OLD).not.toContain(p.color.slice(0, 7).toLowerCase());
  });

  it("the canvas and the paper draw the picked variant", () => {
    expect(pick(CANVAS_STYLE)).toEqual({ fill: "#e0e0de", line: "#2a2c2f", detail: "#8f9296", linePx: 1, detailPx: 0.75, frontPx: 1.6 });
    expect(pick(PRESENTATION_STYLE)).toEqual({ fill: "#e0e0de", line: "#2a2c2f", detail: "#8f9296", linePx: 0.18, detailPx: 0.135, frontPx: 0.35 });
    expectBed(objectsLayer(place("bed", "standard", 1.6, 2), floorView(place("bed", "standard", 1.6, 2), "s0"), CANVAS_STYLE, "", 80), pick(CANVAS_STYLE));
    expectBed(objectsLayer(place("bed", "standard", 1.6, 2), floorView(place("bed", "standard", 1.6, 2), "s0"), PRESENTATION_STYLE, "", 20), pick(PRESENTATION_STYLE));
  });

  it("a selected, ghost or refused piece stays one colour, with no detail line", () => {
    const bed = { kind: "bed", config: "standard", w: 1.6, d: 2, at: { x: 0, y: 0 }, rotation: 0 };
    const cases = [
      { drawn: objectsLayer(place("bed", "standard", 1.6, 2), floorView(place("bed", "standard", 1.6, 2), "s0"), CANVAS_STYLE, "p", 80).slice(1), color: COLORS.wallSelected },
      { drawn: ghostPrimitives({ ...bed, fits: true }).slice(1), color: COLORS.ghostEdge },
      { drawn: ghostPrimitives({ ...bed, fits: false }).slice(1), color: COLORS.invalid },
    ];
    for (const { drawn, color } of cases) {
      const lines = drawn.filter((p) => p.kind === "segment" || p.kind === "arc"); // the selected piece also has its name
      expect(lines.length).toBeGreaterThan(5);
      for (const p of lines) expect(p.color).toBe(color);
    }
  });

  it("during a flip a gliding piece keeps its detail line, and a fading one fades each line in its own colour", () => {
    const doc = place("bed", "standard", 1.6, 2);
    const glide = flipObjectsLayer(withSecondLayout(doc), floorView(doc, null).level, { from: "s0", to: "s1", t: 0.5 });
    expect(glide.some((p) => (p.kind === "segment" || p.kind === "arc") && p.color === CANVAS_STYLE.objectDetail && "px" in p.width && p.width.px === CANVAS_STYLE.objectDetailWidth)).toBe(true);
    expect(glide.at(-1)).toMatchObject({ kind: "segment", color: COLORS.objectEdge, width: { px: CANVAS_STYLE.objectFront } });
    // Only in s0: it fades out, the outline and front still darker than the detail at every alpha.
    const fade = flipObjectsLayer({ ...doc, states: { ...doc.states, s1: { id: "s1", name: "Night", order: 1 } } }, floorView(doc, null).level, { from: "s0", to: "s1", t: 0.5 });
    const [fill, ...rest] = fade;
    expect(fill?.color).toBe(`${COLORS.object}80`);
    const details = rest.slice(4, -1);
    expect(details.length).toBeGreaterThan(0);
    for (const p of [...rest.slice(0, 4), rest.at(-1)]) expect(p?.color).toBe(`${COLORS.objectEdge}80`);
    for (const p of details) expect(p.color).toBe(`${CANVAS_STYLE.objectDetail}80`);
  });
});

type Picked = { fill: string; line: string; detail: string; linePx: number; detailPx: number; frontPx: number };

function pick(s: PlanStyle): Picked {
  return { fill: s.objectFill, line: s.objectLine, detail: s.objectDetail, linePx: s.objectLineWidth, detailPx: s.objectDetailWidth, frontPx: s.objectFront };
}

/** An unselected bed: its fill, the four outline lines, the detail lines, then the front edge. */
function expectBed(drawn: readonly Primitive[], v: Picked): void {
  const [fill, ...rest] = drawn;
  expect(fill).toMatchObject({ kind: "polygon", color: v.fill });
  const outline = rest.slice(0, 4);
  const details = rest.slice(4, -1);
  expect(outline).toHaveLength(4);
  for (const p of outline) expect(p).toMatchObject({ kind: "segment", color: v.line, width: { px: v.linePx } });
  expect(details.length).toBeGreaterThan(0);
  for (const p of details) {
    expect(["segment", "arc"]).toContain(p.kind);
    expect(p).toMatchObject({ color: v.detail, width: { px: v.detailPx } });
  }
  expect(rest.at(-1)).toMatchObject({ kind: "segment", color: v.line, width: { px: v.frontPx } });
}
