import type { Point } from "@fm/protocol";
import type { Document } from "../model";
import { footprintFit } from "./fit";
import { isFloor, levelDeckAt, type Level } from "./levels";
import type { TuckRole } from "./tucks";
import type { StairPose } from "./underside";
import type { Heights } from "./vertical";

// The landing rule (spec "Standing on a deck", "Placing at a level"; decks.11, levels.08, .16): which surface a single
// piece put somewhere new by position stands on, at the viewed level. A query, never a command step: validation
// refuses a surface the piece doesn't fit, and the caller refuses "none" (no surface at that level). Beside fit.ts
// rather than in decks.ts, which fit.ts imports.

/**
 * A piece's fit shape `ring` (its outline) and convex `parts` (catalog.16) in `state` with its `heights`, the
 * footprint's `centre`, the placements to skip, and the surface it stands on now (`current`: a deck's ID or null for
 * the floor; undefined for a new piece).
 */
export type LandingCandidate = {
  state: string;
  ring: readonly Point[];
  parts: readonly (readonly Point[])[];
  heights: Heights;
  current: string | null | undefined;
  ignore: readonly string[];
  centre: Point | null;
  stair?: StairPose; // a moving stair, so an open flight lands where its underside clears what is under it (stairs.56)
  tuck?: TuckRole; // the moving piece's role in the tuck rule, so a tucked seat lands where it fits (seating.14)
  rug?: boolean; // a moving rug lands wherever its walls and decks let it (catalog.24)
  well?: boolean; // a wheel well may run under walls (trailer.07)
  beam?: boolean; // a beam's ends may run into walls (beams.05)
};

/** Where a piece lands: on a surface (a deck's ID, null for the floor), or nowhere at an upper level (levels.16). */
export type Landed = { kind: "surface"; deck: string | null } | { kind: "none" };

/**
 * The surface the piece lands on at `level`: the first of its current surface (at any level) and the level's
 * candidates where footprintFit says it fits. The floor level's candidates are the floor, then the deck under the
 * centre among the decks below its cut; an upper level's, the deck under the centre among its own. When nothing fits,
 * the first of them; when the level has no candidate (an upper level with none of its decks under the centre),
 * "none", even if the piece has a current surface it no longer fits.
 */
export function landing(doc: Document, c: LandingCandidate, level: Level): Landed {
  const under = c.centre ? (levelDeckAt(doc, level, c.centre)?.id ?? null) : null;
  const own = isFloor(level) ? [null, under] : under === null ? [] : [under];
  const all = [...(c.current === undefined ? [] : [c.current]), ...own];
  const order = all.filter((s, i) => all.indexOf(s) === i);
  for (const s of order) {
    if (footprintFit(doc, c.ring, c.state, c.heights, s, c.ignore, c.centre, c.stair, c.tuck, c.parts, c.rug, c.well, c.beam).fits) return { kind: "surface", deck: s };
  }
  const first = order[0];
  return own.length === 0 || first === undefined ? { kind: "none" } : { kind: "surface", deck: first };
}
