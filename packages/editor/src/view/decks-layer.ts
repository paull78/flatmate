import { guardPrimitives } from "./guards-layer";
import { deckRelationAt, deckViews, type CutRelation, type DeckView, type Document, type Level } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { COLORS } from "./colors";
import { deckLabelBox, deckLabelled } from "./deck-label";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { Color, Dash, Primitive } from "./scene-types";

// Decks classified by the cut like walls and pieces (spec "The plan", decks.07): below it a tinted fill with a solid
// outline, above it a dashed outline and no fill, crossing it the fill with an outline at the cut weight; each labelled
// "Name +0.45" (its absolute top). A deck's drawing is split in three layers: `decksLayer` under the pieces,
// `overheadsLayer` (the dashed outlines) over them, since drafting draws overhead lines on top, and `deckLabelsLayer`
// over the walls and openings, so a partition under a loft never paints over its label. At an upper level a deck under
// the level is a ghost, an unfilled hairline with no label, and the level's own decks draw as below the cut, filled and
// labelled, though their tops are the level (levels.04, .24). `selected` (an IDs key) outlines decks in the selection
// blue; an export passes none.

type Classified = { deck: DeckView; relation: CutRelation; picked: boolean };
const NONE = ""; // no selection

/**
 * Every deck with where it lies at the `level` (the domain's `deckRelationAt`: the level's own decks are never under
 * it): the one place the layers classify decks.
 */
function classified(doc: Document, level: Level, selected: string): Classified[] {
  const picked = idsOf(selected);
  return deckViews(doc).map((deck) => ({ deck, relation: deckRelationAt(deck, level), picked: picked.has(deck.id) }));
}

const outline = (style: PlanStyle, picked: boolean): Color => (picked ? COLORS.wallSelected : style.deck.line.color);

/** A deck's outline: its slab's boundary (stairwell.09, .15), so a hole's sides draw and a notch's open side doesn't. */
function slabEdges(deck: DeckView, color: Color, px: number, cap: "butt" | "round", dash?: Dash): Primitive[] {
  return deck.edges.map(({ a, b }): Primitive => (dash ? { kind: "segment", a, b, width: { px }, color, cap, dash } : { kind: "segment", a, b, width: { px }, color, cap }));
}

/** A deck's fill: its slab's traced outline, each hole a clockwise hole ring as rooms' holes are (fixes.06). */
export function slabFill(deck: DeckView, color: Color): Primitive[] {
  return deck.fills.map(({ ring, holes }): Primitive => ({ kind: "polygon", points: ring, holes, color }));
}

/**
 * Under the pieces: fills, then the solid outlines of decks below or crossing the cut, and the ghosts under the level.
 * A deck in `finished` (an IDs key, `deckFloorIds`) draws its finish in the deck floors layer instead of its tint.
 */
export const decksLayer = memoLast((doc: Document, level: Level, style: PlanStyle, selected: string, finished: string): readonly Primitive[] => {
  const floored = idsOf(finished);
  const fills: Primitive[] = [];
  const edges: Primitive[] = [];
  for (const { deck, relation, picked } of classified(doc, level, selected)) {
    switch (relation) {
      case "above":
        break; // its outline is an overhead line
      case "under":
        edges.push(...slabEdges(deck, picked ? COLORS.wallSelected : style.ghost.line, style.ghost.width, "round"));
        break;
      case "below":
      case "crossing":
        if (!floored.has(deck.id)) fills.push(...slabFill(deck, style.deck.tint));
        edges.push(...slabEdges(deck, outline(style, picked), relation === "crossing" ? style.deck.cutLine : style.deck.line.width, "round"));
        break;
      default:
        assertNever(relation);
    }
  }
  return [...fills, ...edges];
});

/**
 * A selected hole's outline in the selection blue (stairwell.19), and a hovered one's, thinner (riser.20): over the pieces,
 * since a stair fills its hole and would hide them.
 */
function markedHoles(doc: Document, selected: string, hovered: string | null, style: PlanStyle): Primitive[] {
  const picked = idsOf(selected);
  return deckViews(doc).flatMap((d) => d.holes.flatMap((h) => {
    const on = picked.has(h.id);
    if (!on && h.id !== hovered) return [];
    return h.ring.map((a, i): Primitive => ({ kind: "segment", a, b: h.ring[(i + 1) % h.ring.length] ?? a, width: { px: on ? style.deck.line.width + 1 : style.deck.line.width }, color: COLORS.wallSelected, cap: "round" }));
  }));
}

/** Over the pieces: the dashed outlines of decks wholly above the cut, and the guards the level shows (guards-layer.ts). */
export const overheadsLayer = memoLast((doc: Document, level: Level, style: PlanStyle, selected: string, hoveredHole: string | null): readonly Primitive[] => [
  ...classified(doc, level, selected).flatMap(({ deck, relation, picked }) =>
    relation === "above" ? slabEdges(deck, outline(style, picked), style.deck.line.width, "butt", style.deck.dash) : [],
  ),
  ...markedHoles(doc, selected, hoveredHole, style),
  ...guardPrimitives(doc, level, style),
]);

/**
 * Over the walls and openings: each deck's "Loft +2.15", upright, left-aligned and hanging below a point LABEL_INSET_M
 * inside the deck's top-left corner, so it stays inside the deck clear of the walls it meets (M1 gate); none for a
 * ghost under the level. `zoom` is drawing units per metre: text is centred on its point, so it moves half its size down.
 * Under the room tags' plate rule (cleanup.05): with a plate colour (the canvas) a box in it sits behind the text, the
 * tags' pad around it and a tag line high, so a piece's outline crossing the label hides under it; on paper none.
 */
export const deckLabelsLayer = memoLast((doc: Document, level: Level, style: PlanStyle, zoom: number): readonly Primitive[] =>
  classified(doc, level, NONE).flatMap(({ deck, relation }): Primitive[] => {
    if (!deckLabelled(relation)) return [];
    const { lines, min, max } = deckLabelBox(deck, style, zoom);
    const label = lines.map((l): Primitive => ({ kind: "text", text: l.text, at: l.at, size: style.deck.label.size, color: style.deck.label.color, align: "left", rotation: 0, font: style.font }));
    const { plate } = style.tag;
    if (plate === null) return label;
    const box = [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
    return [{ kind: "polygon", points: box, holes: [], color: plate }, ...label];
  }),
);


