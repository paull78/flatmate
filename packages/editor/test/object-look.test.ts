import { isFurnitureSet } from "../src/furniture-sets";
import { describe, expect, it } from "vitest";
import { kindOf } from "@fm/domain";
import { aggregateLayout, isAggregate } from "../src/view/aggregate";
import type { Primitive } from "../src/view/scene-types";
import { placedSymbol } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { CANVAS_STYLE, pieceFill } from "../src/view/plan-style";
import { place } from "./object-look-helpers";

// Canvas objects and palette tiles take their look from one function (arch-review R-03, AC-12): the same plan symbol and
// front edge; the tile adds its fill and draws a thinner front edge (a smaller tile).
const widthless = (ps: readonly Primitive[]) => ps.map((p) => (p.kind === "segment" ? { ...p, width: { px: 0 } } : p));

describe("one object look", () => {
  const kinds = PALETTE.flatMap((g) => g.cards).filter((k) => !isFurnitureSet(k.kind)); // a set's tile is its pieces' looks (sets-group.test.ts)

  it.each(kinds.map((k) => [k.kind, k] as const))("%s: the tile's lines are the canvas symbol at the origin", (_id, k) => {
    const doc = place(k.kind, k.config, k.w, k.d);
    const p = doc.placements["p"];
    if (!p) throw new Error("no placement");
    const canvas = placedSymbol(doc, p, CANVAS_STYLE.objectLine);
    const tile = tileLook(k);
    // One fill, or an aggregate's parts: each chair's ring and the table's (seating.15).
    const fills = tile.filter((p) => p.kind === "polygon");
    const lines = tile.slice(fills.length);
    expect(fills.length).toBe(isAggregate(k.kind) ? (aggregateLayout(k.kind, k.w, k.d)?.chairs.length ?? 0) + 1 : 1);
    for (const fill of fills) expect(fill).toMatchObject({ kind: "polygon", color: pieceFill(CANVAS_STYLE, k.kind) });
    expect(widthless(lines)).toEqual(widthless(canvas));
    if (isAggregate(k.kind) || kindOf(k.kind)?.front === false) return; // an aggregate has no front line, nor a plant or a rug (catalog.54)
    expect(lines.at(-1)).toMatchObject({ kind: "segment", width: { px: 1 } });
    expect(canvas.at(-1)).toMatchObject({ kind: "segment", width: { px: CANVAS_STYLE.objectFront } });
  });
});
