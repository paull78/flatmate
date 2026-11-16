import { isFloor, levelOf, type Document, type Level } from "@fm/domain";
import { memoLast } from "./memo";

/**
 * What a plan picture is drawn for (levels.16): the layout whose furniture it shows, the level it is cut at and that
 * level's cut height. Resolved once and passed to `planPicture` and the layer builders, so no layer reads the cut
 * itself. The same object while its document, layout and level are the same, so the layers memoised on it are reused.
 * A function of the document alone: the canvas's view comes from the session in `levels.ts` (`planView`).
 */
export type PlanView = { layout: string | null; level: Level; cut: number };

const makeView = (layout: string | null, level: Level): PlanView => ({ layout, level, cut: level.cut });
const floorSlot = memoLast(makeView);
const upperSlot = memoLast(makeView);
const paperSlot = memoLast(makeView);

/**
 * The view of a layout at a level, keyed on the Level object: the domain gives the same one while the document is the
 * same, and a new one for a new document, so the layers memoised on the view are reused. Two slots: the floor's, shared
 * by the canvas and paper (at the floor both reuse one view), and the upper level's, which only the canvas and the
 * viewed level's PNG and SVG use.
 */
export function viewAt(layout: string | null, level: Level): PlanView {
  return isFloor(level) ? floorSlot(layout, level) : upperSlot(layout, level);
}

/** The floor's view of `doc` in a layout. */
export function floorView(doc: Document, layout: string | null): PlanView {
  return viewAt(layout, levelOf(doc, null));
}

/** A sheet's view: at the floor shared as above, at a loft its own slot, so a page never takes the canvas's view (levels.26). */
export function paperView(layout: string | null, level: Level): PlanView {
  return isFloor(level) ? floorSlot(layout, level) : paperSlot(layout, level);
}

/** Whether a view is cut at an upper level, where room fills, tags and dimensions are hidden (levels.04). */
export function upperLevel(view: PlanView): boolean {
  return !isFloor(view.level);
}
