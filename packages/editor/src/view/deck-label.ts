import { EPS, cross, deckLabel, deckRelationAt, deckViews, shown, slabArea, sub, type CutRelation, type DeckView, type Document, type Level } from "@fm/domain";
import { formatArea } from "./area-text";
import type { Point } from "@fm/protocol";
import { textWidth } from "./fonts";
import { plateBox } from "./labels";
import type { PlanStyle } from "./plan-style";

// How the editor titles a deck on the plan and in Properties (spec "The plan", "The Deck tool and editing"). The name
// itself, "Deck" when blank, is the domain's `deckLabel`, the same one refusals use (decks.23). Where the label sits
// and the box around it are here too, the one place the deck label layer and the room tags read them (tidy.13).

/** "Loft +2.15": the deck's label and its absolute top to the centimetre. */
export const deckTitle = (deck: Pick<DeckView, "name" | "top">): string => `${deckLabel(deck)} +${shown(deck.top)}`;

/** How far inside a deck's top-left corner its label hangs, along both of the deck's own axes. */
const LABEL_INSET_M = 0.12;

/** A deck gets a label unless it lies under the viewed level (a ghost there, levels.04). */
export const deckLabelled = (relation: CutRelation): boolean => relation !== "under";

/** The decks labelled at `level`, in `deckViews` order. */
export function labelledDecks(doc: Document, level: Level): DeckView[] {
  return deckViews(doc).filter((deck) => deckLabelled(deckRelationAt(deck, level)));
}

/** A label line: its text and its point, left-aligned. */
export type DeckLabelLine = { text: string; at: Point };

/**
 * The label's lines and the plate box around them, the tags' pad around the text and a tag line high per line. The
 * title's point is left-aligned, hanging below the anchor (text is centred on its point, so half its size down); the
 * deck's area, its slab's (w × d less its holes, areas.10), a tag line under it when the two-line box lies inside the
 * deck, else the title alone. The same box whether or not the style draws a plate. `zoom` is drawing units per metre.
 */
export function deckLabelBox(deck: DeckView, style: PlanStyle, zoom: number): { at: Point; min: Point; max: Point; lines: DeckLabelLine[] } {
  const anchor = labelAnchor(deck);
  const size = style.deck.label.size;
  const at = { x: anchor.x, y: anchor.y - size / 2 / zoom };
  const title = deckTitle(deck);
  const area = formatArea(slabArea(deck));
  const step = style.tag.line / zoom;
  const width = Math.max(textWidth(style.font, title, size), textWidth(style.font, area, size));
  const two = plateBox({ x: at.x + width / 2 / zoom, y: at.y - step / 2 }, width, 2, style.tag, zoom);
  if (insideRing(deck.ring, [two.min, { x: two.max.x, y: two.min.y }, two.max, { x: two.min.x, y: two.max.y }])) {
    return { at, ...two, lines: [{ text: title, at }, { text: area, at: { x: at.x, y: at.y - step } }] };
  }
  const one = textWidth(style.font, title, size);
  return { at, ...plateBox({ x: at.x + one / 2 / zoom, y: at.y }, one, 1, style.tag, zoom), lines: [{ text: title, at }] };
}

/** Whether every point lies in the convex, counter-clockwise ring, its edges included within EPS. */
function insideRing(ring: readonly Point[], points: readonly Point[]): boolean {
  return points.every((p) => ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return cross(sub(b, a), sub(p, a)) >= -EPS;
  }));
}


/**
 * The ring corner with the smallest x, then the largest y (ties: the first), moved LABEL_INSET_M in along both axes.
 * Exact comparisons: quarter turns give exactly equal x (cosSinDeg), and whole degrees keep other corners at least
 * 0.30 m × sin 1° apart.
 */
function labelAnchor(deck: DeckView): Point {
  const [head, ...rest] = deck.ring;
  if (!head) return deck.at;
  let corner = head;
  for (const c of rest) {
    if (c.x < corner.x || (c.x === corner.x && c.y > corner.y)) corner = c;
  }
  const r = (deck.rotation * Math.PI) / 180;
  const u = { x: Math.cos(r), y: Math.sin(r) }; // the deck's width axis
  const v = { x: -Math.sin(r), y: Math.cos(r) }; // its depth axis
  const rel = { x: corner.x - deck.at.x, y: corner.y - deck.at.y };
  const su = Math.sign(rel.x * u.x + rel.y * u.y);
  const sv = Math.sign(rel.x * v.x + rel.y * v.y);
  return { x: corner.x - LABEL_INSET_M * (su * u.x + sv * v.x), y: corner.y - LABEL_INSET_M * (su * u.y + sv * v.y) };
}
