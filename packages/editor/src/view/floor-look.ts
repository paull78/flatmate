import { deckViews, roomFinish, zones, type Document, type Zone } from "@fm/domain";
import { memoLast } from "./memo";
import { onFinishes, type PlanStyle } from "./plan-style";

// How a room's floor looks in a picture (thresholds.06): the one owner, read by the zone fills, the floors layer and a
// door's span, so the span can't drift from its room. Hover and selection are the zone fills' own, not the floor's.

/** "finish": the floors layer draws its finish; "fill": a labelled room's plain fill; "none": an unlabelled room. */
export type FloorLook = "finish" | "fill" | "none";

/** The room's look with the picture's finishes on or off (the viewer's switch, the export's With). */
export function floorLookOf(doc: Document, zone: Zone, finishes: boolean): FloorLook {
  if (finishes && roomFinish(doc, zone) !== null) return "finish";
  return zone.labelIds.length > 0 ? "fill" : "none";
}

/** The rooms by face key, for a span's room. */
export const zonesByKey = memoLast((doc: Document): ReadonlyMap<string, Zone> => new Map(zones(doc).map((z) => [z.face.key, z])));

/** Whether a room or a deck has a finish. */
const holdsFinish = memoLast((doc: Document): boolean => zones(doc).some((z) => roomFinish(doc, z) !== null) || deckViews(doc).some((d) => d.finish !== null));

/**
 * Whether a picture's pieces draw white (seating.02): it shows finishes (the viewer's switch, the export's With) and the
 * document holds a room's or a deck's finish. One flag per picture, never per piece, so a drawing never mixes looks.
 */
export function piecesOnFinish(doc: Document, finishes: boolean): boolean {
  return finishes && holdsFinish(doc);
}

/** The style a picture's pieces draw in: the white look over finishes, else the style's own; a style drawing no finish (look) keeps its own. */
export function piecesStyle(doc: Document, style: PlanStyle, finishes: boolean): PlanStyle {
  return style.finish !== null && piecesOnFinish(doc, finishes) ? onFinishes(style) : style;
}
