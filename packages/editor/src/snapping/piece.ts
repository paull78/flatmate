import { assertNever, sizePlaceable, candidateShape, footprintFit, landing, tuckRole, type Arms, type CandidateShape, type Document, type Heights, type Landed, type Level, type StairPose, type TuckRole } from "@fm/domain";
import type { Point } from "@fm/protocol";

// The moving piece the placing searches share (heights.44): contactPlace, its corner turn and alignAfterContact test
// each candidate place with `pieceFit`. A single piece put somewhere new by position (the Object tool's ghost, dragging
// one piece) lands where the landing rule says at each candidate, at the viewed level (decks.11, levels.08), so the
// search, the ghost and the commit agree; a duplicate's ghost keeps its surface.

/**
 * What the fit needs of the moving piece: its kind's shape (a rectangle when absent), its heights for the
 * configuration it shows, the placements to skip, the viewed level (its walls and furniture are the ones the snaps
 * see, levels.19), and what it stands on. A piece that lands (`land: true`: the Object tool's ghost, one dragged
 * piece) stands where the landing rule says at that level, from its `current` surface (undefined for a new piece); any
 * other keeps its `surface` (a deck's ID or null for the floor). `config`, the configuration it shows, gives it its
 * role in the tuck rule with its kind (a seat tucks, seating.14); without one its whole shape is tested. `arms` are an
 * `L` piece's (catalog.17): an existing object's own, none for a new piece (its kind's default). A rug tests as one by
 * its kind, through `candidateShape` (catalog.24).
 */
export type Piece = { kind?: string; config?: string; arms?: Arms; riser: number | null; heights: Heights; ignore?: readonly string[]; level: Level } & ({ land: true; current: string | null | undefined } | { land: false; surface: string | null });

/** The surface a piece stands on when nothing is tested: its current one (the floor for a new piece), or the one it keeps. */
export const ownSurface = (piece: Piece): string | null => (piece.land ? (piece.current ?? null) : piece.surface);

type Size = { w: number; d: number };

/** Where the piece stands with its fit `shape`: where it lands at its level with `land`, else on its own surface. */
function landedOf(doc: Document, layout: string, piece: Piece, { ring, parts, centre, rug, well, beam }: CandidateShape, stair?: StairPose, tuck: TuckRole = null): Landed {
  if (!piece.land) return { kind: "surface", deck: piece.surface };
  return landing(doc, { state: layout, ring, parts, heights: piece.heights, current: piece.current, ignore: piece.ignore ?? [], centre, stair, tuck, rug, well, beam }, piece.level);
}

/** The moving piece's stair pose, so an open flight is tested with its underside (stairs.56); the fit ignores it for furniture. */
const poseOf = (piece: Piece, size: Size, at: Point, r: number): StairPose | undefined => (piece.kind === undefined ? undefined : { kind: piece.kind, at, rotation: r, w: size.w, d: size.d, riser: piece.riser });

/** The moving piece's role in the tuck rule at this pose (seating.14): null without a kind and configuration. */
const tuckOf = (piece: Piece, size: Size, at: Point, r: number): TuckRole =>
  piece.kind === undefined || piece.config === undefined ? null : tuckRole({ kind: piece.kind, config: piece.config, at, rotation: r, w: size.w, d: size.d });

/** Where `piece`, `size.w` × `size.d` anchored at `at` at rotation `r` in `layout`, stands there: where it lands with `land`, else its own surface. */
export function landsOn(doc: Document, layout: string, piece: Piece, size: Size, at: Point, r: number): Landed {
  const shape = candidateShape(piece.kind, at, size.w, size.d, r, piece.arms);
  return landedOf(doc, layout, piece, shape, poseOf(piece, size, at, r), tuckOf(piece, size, at, r));
}

/**
 * Whether `piece`, `size.w` × `size.d` anchored at `at` at rotation `r` in `layout`, fits by its shape (shapefit.01)
 * and its range (heights.12) on the surface it stands on there (`landsOn`), a seat by the tuck rule, and where it
 * stands. "none" (no deck of the level under it, levels.16) never fits.
 */
export function pieceFit(doc: Document, layout: string, piece: Piece, size: Size, at: Point, r: number): { fits: boolean; landed: Landed } {
  const shape = candidateShape(piece.kind, at, size.w, size.d, r, piece.arms);
  const { ring, parts, centre, rug, well, beam } = shape;
  const stair = poseOf(piece, size, at, r);
  const tuck = tuckOf(piece, size, at, r);
  const landed = landedOf(doc, layout, piece, shape, stair, tuck);
  switch (landed.kind) {
    case "surface":
      if (piece.kind !== undefined && !sizePlaceable(piece.kind, size.w, size.d, piece.arms)) return { fits: false, landed }; // sizing.04, .32
      return { fits: footprintFit(doc, ring, layout, piece.heights, landed.deck, piece.ignore ?? [], centre, stair, tuck, parts, rug, well, beam).fits, landed };
    case "none":
      return { fits: false, landed };
    default:
      return assertNever(landed);
  }
}
