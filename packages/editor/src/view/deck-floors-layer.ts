import { ownsDeck, type Document } from "@fm/domain";
import { patternShows } from "./finish/geometry";
import { deckFinishes, type DeckFinish } from "./finish/rooms";
import { finishPrimitives } from "./finishes-layer";
import { idsKey, idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { PlanView } from "./plan-view";
import type { Primitive } from "./scene-types";

// Finished decks on the canvas and on paper (deck-floors.06): a deck draws its finish only where the viewed level owns
// it (the domain's `ownsDeck`, the test `levelDeckAt` clicks by), in the `deckFloors` layer above the ghosts and zone
// fills and below the decks' edges; `decksLayer` leaves out the tint of those decks.

const NONE: readonly Primitive[] = [];

/**
 * The IDs key of the decks whose finish the picture draws: owned by the view's level, finished, only when `on` (the
 * viewer's switch, the export's With) and in a style with a finish (not look's). Empty otherwise.
 */
export function deckFloorIds(doc: Document, view: PlanView, style: PlanStyle, on: boolean): string {
  if (!on || style.finish === null) return "";
  return idsKey(deckFinishes(doc).filter((d) => ownsDeck(doc, view.level, d.id)).map((d) => d.id));
}

/** The finished decks in `owned` (an IDs key), each pattern drawn when in `visible`; reused while its inputs are equal. */
const deckFloorsLayer = memoLast((decks: readonly DeckFinish[], owned: string, style: PlanStyle, visible: string): readonly Primitive[] => {
  const ids = idsOf(owned);
  return finishPrimitives(decks.filter((d) => ids.has(d.id)), style, visible);
});

/**
 * The deck floors layer of a picture: the decks of `deckFloorIds`, their patterns where the spacing is at least the
 * style's `minSpacing` at `zoom` (drawing units per metre), as the rooms' (finishes.16).
 */
export function deckFloors(doc: Document, view: PlanView, style: PlanStyle, zoom: number, on: boolean): readonly Primitive[] {
  const owned = deckFloorIds(doc, view, style, on);
  const finish = style.finish;
  if (owned === "" || finish === null) return NONE;
  const decks = deckFinishes(doc);
  const visible = idsKey(decks.filter((d) => patternShows(d.geometry, finish.minSpacing / zoom)).map((d) => d.id));
  return deckFloorsLayer(decks, owned, style, visible);
}
