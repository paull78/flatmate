import { describe, expect, it } from "vitest";
import { levelOf, signedArea } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { decksLayer, overheadsLayer } from "../src/view/decks-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { notchedCabinDoc, cabinDoc, withCommands } from "./builders";

// Holes on the plan (stairwell.09; AC-11): at the deck's level the fill has each hole as a hole ring and the outline is
// the slab's boundary, so the east side stops at the notch; at the floor under the loft the overhead outline dashes
// the hole's sides too. The notch: x 1.40–2.10, y 2.25–2.90 in the loft x 0.1–2.1, y 0.1–2.9.

const NONE = "";
type Seg = Extract<Primitive, { kind: "segment" }>;
const segments = (ps: readonly Primitive[]): Seg[] => ps.filter((p): p is Seg => p.kind === "segment");
const r = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const key = (s: Seg): string => [s.a, s.b].map((p: Point) => `${r(p.x)},${r(p.y)}`).sort().join(" ");

describe("a deck with a notch on the plan (AC-11)", () => {
  it("a hole away from the sides is a clockwise hole ring in the fill, as rooms' holes are", () => {
    const doc = withCommands(cabinDoc(), { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 1.1, y: 1.5 }, w: 0.6, d: 0.6 });
    const fill = decksLayer(doc, levelOf(doc, "loft/k0"), CANVAS_STYLE, NONE, "").find((p) => p.kind === "polygon");
    expect(fill?.kind === "polygon" && fill.holes.length).toBe(1);
    expect(fill?.kind === "polygon" && signedArea(fill.holes[0] ?? [])).toBeLessThan(0);
  });

  it("at the loft's level: the fill's outline follows the notch, as its outline's six sides do (fixes.06)", () => {
    const doc = notchedCabinDoc();
    const level = levelOf(doc, "loft/k0");
    const drawn = decksLayer(doc, level, CANVAS_STYLE, NONE, "");
    const fill = drawn.find((p) => p.kind === "polygon");
    expect(fill?.kind === "polygon" && fill.holes.length).toBe(0);
    expect(fill?.kind === "polygon" && fill.points.length).toBe(6);
    expect(segments(drawn).map(key).sort()).toEqual([
      "0.1,0.1 2.1,0.1", "0.1,0.1 0.1,2.9", "0.1,2.9 1.4,2.9", "1.4,2.25 1.4,2.9", "1.4,2.25 2.1,2.25", "2.1,0.1 2.1,2.25",
    ].sort());
  });

  it("at the floor: the loft's overhead outline is dashed and follows the notch", () => {
    const doc = notchedCabinDoc();
    const overhead = segments(overheadsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, NONE, null));
    expect(overhead.length).toBeGreaterThan(0);
    expect(overhead.every((s) => s.dash !== undefined)).toBe(true);
    expect(overhead.map(key)).toContain("1.4,2.25 1.4,2.9");
    expect(overhead.map(key)).not.toContain("2.1,0.1 2.1,2.9");
  });
});
