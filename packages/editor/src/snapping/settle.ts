import { anchorAt, anchorAtMm, footprintQuad, quadCentre, type Document, type Landed, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { landsOn, ownSurface, pieceFit, type Piece } from "./piece";
import { guideBoxes, lineTargets, shapedBoxAt, type Axis } from "./guides";
import { nearWalls, wallSeenAt } from "./near-walls";
import { pickSnap } from "./picker";

// Walls before guides (furnish.16): one piece being placed, dragged or carried as a duplicate's ghost first takes
// contactPlace (turn and flush), then aligns to the layout's other furniture on each screen axis that no wall holds.
//
//   wall face y 3.9 ══════════════════════
//   ┌────────────┐┌──────┐   x: no wall face within the tolerance, so S's edge 1.30 pulls the piece's 1.35 onto it
//   │ S          ││ piece│   y: the top wall is within the tolerance, so the wall wins and no guide applies
//   └────────────┘└──────┘

const TIE = 1e-9;

/**
 * The screen axes held by wall faces `level` sees (levels.19) within `tolerance` of `quad`: across a horizontal wall y,
 * a vertical one x, a slanted one both.
 */
export function wallLockedAxes(doc: Document, quad: readonly Point[], tolerance: number, level: Level): { x: boolean; y: boolean } {
  const centre = quadCentre(quad);
  const lock = { x: false, y: false };
  if (!centre) return lock;
  // nearWalls measures to the wall body, end caps included: a cap within the tolerance locks across the wall's own
  // direction. The 1e-9 margin is contactPlace's, so a side it saw at exactly the tolerance locks too (furnish.26).
  for (const w of nearWalls(doc, quad, centre, tolerance + TIE)) {
    if (!wallSeenAt(doc, w.wallId, level)) continue;
    const a = w.angleDeg % 180;
    if (a !== 90) lock.y = true;
    if (a !== 0) lock.x = true;
  }
  return lock;
}

/**
 * One piece after the wall rule (furnish.16): on each axis that `axes` allows and no wall face within the tolerance
 * of the placed footprint or of the FREE box (`free`, at the placed rotation) holds, the nearest guide line of the
 * layout's other furniture (except `exclude`), within the tolerance of the free box's lines, moves it there; else
 * contactPlace's place stands. With Ctrl, contactPlace's place unchanged. The rotation never changes (direct.55); the
 * anchor is kept to the millimetre. A guide never moves a piece that fits where contactPlace put it to where it doesn't
 * (shapefit.08): guides read rectangles, so one can pull a chair in a round table's empty corner onto its circle; then
 * the guide on one axis alone is tried, x first, else contactPlace's place stands. The `Piece` fields are the fit's
 * (piece.ts); `landed` is where the piece stands at the answer: where it lands with `land` at `input.level` (decks.11,
 * levels.08; "none" with no deck of an upper level under it), else its own surface. Only the furniture `input.level`
 * shows gives guides (levels.19). Without a layout nothing is tested and the surface is its own.
 */
export function alignAfterContact(doc: Document, input: {
  layout: string | null; exclude: ReadonlySet<string>; size: { w: number; d: number };
  free: Point; placed: { at: Point; rotation: number; held?: true }; tolerance: number; ctrl: boolean; axes: { x: boolean; y: boolean };
} & Piece): { at: Point; rotation: number; landed: Landed } {
  const { size, placed, free, tolerance } = input;
  const { w, d } = size;
  const rotation = placed.rotation;
  const layout = input.layout;
  const at = (c: Point): Point => anchorAtMm(c, d, rotation);
  const own: Landed = { kind: "surface", deck: ownSurface(input) };
  const answer = (a: Point, landed = layout === null ? own : landsOn(doc, layout, input, size, a, rotation)) => ({ at: a, rotation, landed });
  const quad = footprintQuad(placed.at, w, d, rotation);
  const centre = quadCentre(quad);
  if (input.ctrl || placed.held || !centre) return answer(placed.at); // a guide never un-tucks a seat (seating.11) or takes a beam off a slab edge (beams.19)
  // The free box's walls lock too: it can lie up to half a step from the placed box, and a guide moves it by at most
  // the tolerance, so this keeps a guide from pushing the piece into a side wall the placed box is clear of.
  const placedLock = wallLockedAxes(doc, quad, tolerance, input.level);
  const freeLock = wallLockedAxes(doc, footprintQuad(anchorAt(free, d, rotation), w, d, rotation), tolerance, input.level);
  const lock = { x: placedLock.x || freeLock.x, y: placedLock.y || freeLock.y };
  const others = guideBoxes(doc, input.layout, input.exclude, input.level);
  const box = shapedBoxAt(free, w, d, rotation, input.kind, input.arms);
  const pick = (axis: Axis): number => {
    if (lock[axis] || !input.axes[axis]) return centre[axis];
    const targets = lineTargets(box, axis, others, 0, tolerance);
    return pickSnap({ targets, stepped: centre[axis] - free[axis], free: 0, ctrl: false }).value + free[axis];
  };
  const guided = { x: pick("x"), y: pick("y") };
  if (layout === null || (guided.x === centre.x && guided.y === centre.y)) return answer(at(guided));
  const fit = (a: Point): { fits: boolean; landed: Landed } => pieceFit(doc, layout, input, size, a, rotation);
  const there = fit(at(guided));
  const here = there.fits ? null : fit(at(centre));
  if (!here || !here.fits) return answer(at(guided), there.landed);
  for (const a of [{ x: guided.x, y: centre.y }, { x: centre.x, y: guided.y }].map(at)) {
    const f = fit(a);
    if (f.fits) return answer(a, f.landed);
  }
  return answer(at(centre), here.landed);
}
