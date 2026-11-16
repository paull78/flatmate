import type { UiAction } from "./ports/events";
import type { FramesView } from "./view/view-model-types";

// The frames under the plan (spec "The strip", section.45, .46): this viewer's dock, a preference like the 3D view's,
// never synced, saved or undone. Heights and widths are shares of the stage, so the shell's style can keep the plan and
// the dock at their minimum sizes at any window size with no measuring.
//
//   ┌─────── plan ───────┐   height: the dock's share of the stage's height
//   ├──────┬─────────────┤   sectionShare: the section's share of the dock's width, wherever it sits
//   │  A–A │     3D      │   sectionFirst: which sits on the left
//   └──────┴─────────────┘

export type FramesState = { height: number; larger: boolean; sectionShare: number; sectionFirst: boolean };
type FramesUi = Extract<UiAction, { type: "setDockHeight" | "resetDockHeight" | "toggleLargerDock" | "setDockShare" | "swapFrames" }>;

const DOCK_HEIGHT = 0.46;
const LARGER_HEIGHT = 0.74;
const [MIN_SHARE, MAX_SHARE] = [0.2, 0.8]; // the narrower frame still shows its title bar

export const INITIAL_FRAMES: FramesState = { height: DOCK_HEIGHT, larger: false, sectionShare: 0.56, sectionFirst: true };

const within = (low: number, high: number, v: number): number => Math.min(high, Math.max(low, v));

export function framesAfter(frames: FramesState, action: FramesUi): FramesState {
  switch (action.type) {
    case "setDockHeight": return { ...frames, height: within(0, 1, action.height), larger: false };
    case "resetDockHeight": return { ...frames, height: DOCK_HEIGHT, larger: false };
    case "toggleLargerDock": return { ...frames, larger: !frames.larger };
    case "setDockShare": return { ...frames, sectionShare: within(MIN_SHARE, MAX_SHARE, action.sectionShare) };
    case "swapFrames": return { ...frames, sectionFirst: !frames.sectionFirst };
    default: { const never: never = action; return never; }
  }
}

/** What the shell lays out, given what's open: a section, and whether 3D is open in split. */
export function framesView(frames: FramesState, section: boolean, split3d: boolean): FramesView {
  return { height: frames.larger ? LARGER_HEIGHT : frames.height, larger: frames.larger, sectionShare: frames.sectionShare, sectionFirst: frames.sectionFirst, docked: section || split3d, side: section && split3d };
}
