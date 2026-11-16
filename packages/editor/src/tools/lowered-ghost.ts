import { candidateShape, footprintQuad, lowerable, lowestHeight, placementFit, rangeOf, roomOver, roundMm, type Document, type Heights, type Range } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "./types";

// A new piece that fits by getting shorter (clarity.06): the Object tool's second pass, for a ghost and a drawn footprint.

/** The ghost's range in height on `surface`, for the cut (decks.11). */
export function rangeAt(doc: Document, heights: Heights, size: { w: number; d: number }, at: Point, rotation: number, surface: string | null): Range {
  return rangeOf(doc, heights, footprintQuad(at, size.w, size.d, rotation), surface);
}

/**
 * `first`, today's search at the piece's full height, unless it's red and the kind may be lowered (clarity.10). Then
 * `search` runs again at the lowest allowed height, the height comes from the room at the place it lands, and the fit
 * checks that. It keeps `first` when that's red too, so a piece that fits today lands where it does today, and a red
 * ghost still shows today's numbers. Where the second search lands clear of what stopped the first, the piece keeps
 * its full height, with no `lowered`.
 */
export function lowerGhost(doc: Document, layout: string, first: ObjectGhost, full: Heights, search: (heights: Heights) => ObjectGhost): ObjectGhost {
  const { h: from, z } = full;
  if (first.fits || z === "ceiling" || !lowerable(first.kind)) return first;
  const lowest = lowestHeight(from);
  const trial = search({ h: lowest, z });
  if (!trial.fits) return first; // no deck under it, or a drawn footprint too small to place
  const { kind, config, w, d, at, rotation, surface } = trial;
  const { ring, parts } = candidateShape(kind, at, w, d, rotation);
  const { room, under } = roomOver(doc, parts, ring, surface);
  const h = Math.min(from, roundMm(room - z)); // room is from the surface's top, so the elevation comes off it (clarity.33)
  if (h < lowest || !placementFit(doc, { kind, state: layout, at, rotation, config, w, d, surface, h, z }).fits) return first;
  const ghost = { ...trial, range: rangeAt(doc, { h, z }, trial, at, rotation, surface) };
  return h < from ? { ...ghost, lowered: { h, from, under } } : ghost;
}
