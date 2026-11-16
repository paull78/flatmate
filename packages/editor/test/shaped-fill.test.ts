import { describe, expect, it } from "vitest";
import { footprintQuad, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { flipObjectsLayer, ghostPrimitives, objectsLayer } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { pictureLayers, planPicture } from "../src/view/picture";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { place } from "./object-look-helpers";
import { floorView } from "../src/view/plan-view";

// The fill follows the kind's shape (furnish.12, .18, shapefit.01): pieces selected or not, the ghost fitting or red,
// the flip, the tile and the exports. Fit checks the same shape.

const polygons = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));

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

describe("shaped fills (furnish.12, .18, shapefit.01)", () => {
  it("objects layer: shaped fill, selected or not", () => {
    const doc = place("roundBlock", "standard", 0.6, 0.6);
    const [unselected] = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    expect(unselected).toMatchObject({ kind: "polygon", color: CANVAS_STYLE.objectFill });
    expect(unselected?.kind === "polygon" ? unselected.points : []).toHaveLength(32);
    const [selected] = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "p", 80);
    expect(selected).toMatchObject({ kind: "polygon", color: COLORS.objectSelected });
    expect(selected?.kind === "polygon" ? selected.points : []).toEqual(unselected?.kind === "polygon" ? unselected.points : null);
    const [block] = objectsLayer(place("block", "standard", 0.6, 0.6), floorView(place("block", "standard", 0.6, 0.6), "s0"), CANVAS_STYLE, "", 80);
    expect(block).toEqual({ kind: "polygon", points: footprintQuad({ x: 0, y: 0 }, 0.6, 0.6, 0), holes: [], color: CANVAS_STYLE.objectFill });
  });

  it("ghost: shaped, fitting or red", () => {
    const ghost = (fits: boolean) => ghostPrimitives({ kind: "cornerBlock", config: "standard", w: 0.6, d: 0.6, at: { x: 2, y: 1 }, rotation: 90, fits })[0];
    const check = (p: Primitive | undefined, want: [number, number][], color: string) => {
      if (p?.kind !== "polygon") throw new Error("not a polygon");
      expect(p.color).toBe(color);
      expect(p.points).toHaveLength(want.length);
      want.forEach(([x, y], i) => {
        expect(p.points[i]?.x).toBeCloseTo(x, 9);
        expect(p.points[i]?.y).toBeCloseTo(y, 9);
      });
    };
    check(ghost(true), [[2, 0.7], [2.6, 0.7], [2, 1.3]], COLORS.ghostFill);
    check(ghost(false), [[2, 0.7], [2.6, 0.7], [2, 1.3]], COLORS.invalidFill);
  });

  it("flip and tile use the shaped fill", () => {
    const doc = place("roundBlock", "standard", 0.6, 0.6);
    const glide = polygons(flipObjectsLayer(withSecondLayout(doc), floorView(doc, null).level, { from: "s0", to: "s1", t: 0.5 }));
    expect(glide[0]?.points).toHaveLength(32);
    const fade = polygons(flipObjectsLayer({ ...doc, states: { ...doc.states, s1: { id: "s1", name: "Night", order: 1 } } }, floorView(doc, null).level, { from: "s0", to: "s1", t: 0.5 }));
    expect(fade[0]?.points).toHaveLength(32);
    const tile = PALETTE.flatMap((g) => g.cards).find((k) => k.kind === "roundBlock");
    if (!tile) throw new Error("no roundBlock tile");
    const look = tileLook(tile);
    expect(look[0]).toMatchObject({ kind: "polygon", color: CANVAS_STYLE.objectFill });
    expect(look[0]?.kind === "polygon" ? look[0].points : []).toHaveLength(32);
    expect(look.at(-1)).toMatchObject({ kind: "segment", width: { px: 1 } });
  });

  it("exports draw the shaped fill", () => {
    for (const [kind, n] of [["roundBlock", 32], ["cornerBlock", 3]] as const) {
      const drawn = pictureLayers(planPicture(place(kind, "standard", 0.6, 0.6), floorView(place(kind, "standard", 0.6, 0.6), "s0"), PRESENTATION_STYLE, 20, true));
      const fills = polygons(drawn).filter((p) => p.color === PRESENTATION_STYLE.objectFill);
      expect(fills, kind).toHaveLength(1);
      expect(fills[0]?.points, kind).toHaveLength(n);
    }
  });
});
