import { outsideDoors, roofOf, trailerOf, type Document } from "@fm/domain";
import type { UiAction } from "./ports/events";
import { activeStateId, type EditorState } from "./state";
import { visibleDoc } from "./document/open-document";
import type { Mods } from "./types";
import { idsKey, idsOf, memoLast } from "./view/memo";
import { DEFAULT_ANGLES, shellBounds, TILT_MAX, TILT_MIN } from "./view3d/camera3d";
import { aroundShell, onWheels } from "./view3d/ground-faces";
import { hiddenWalls } from "./view3d/hidden";
import { view3dItems } from "./view3d/items";
import { roofFaces } from "./view3d/roof-faces";
import { STYLE_3D } from "./view3d/style";
import { surroundingsRow } from "./view3d/surroundings";
import type { View3d, View3dFrame } from "./view3d/types";

// The 3D view's per-viewer state (heights.18, .19, real3d.03): open, its size and its camera's yaw and tilt; a
// preference like the active layout, never synced, saved or undone. Its keys and the panel's buttons change it; the render effect carries the picture's
// input while it is open.

type View3dSize = View3dFrame["size"];
export type View3dState = { open: boolean; size: View3dSize; yaw: number; tilt: number; roof: boolean };

export const CLOSED_3D: View3dState = { open: false, size: "corner", ...DEFAULT_ANGLES, roof: false };

type View3dUi = Extract<UiAction, { type: "toggle3d" | "set3dSize" | "turn3d" | "orbit3d" | "reset3d" | "toggleRoof3d" }>;

/**
 * Degrees a pixel of drag turns the view (real3d.04, .26). Right lowers the yaw: the camera circles clockwise, so the
 * model turns counter-clockwise and its near side moves right with the hand. Down raises the tilt: more from above.
 */
export const ORBIT_DEG_PER_PX = 0.4;

/** An angle in degrees, 0 to under 360, rounded to a nanodegree so drags summing 0.4° steps read back clean. */
export const wrapped = (deg: number): number => Math.round((((deg % 360) + 360) % 360) * 1e9) / 1e9 % 360;

export function onView3dUi(state: EditorState, action: View3dUi): EditorState {
  const v = state.view3d;
  switch (action.type) {
    case "toggle3d": return { ...state, view3d: { ...v, open: !v.open } };
    case "set3dSize": return { ...state, view3d: { ...v, open: true, size: action.size } };
    case "turn3d": return { ...state, view3d: { ...v, yaw: wrapped(v.yaw + 90 * action.by) } }; // a quarter turn from wherever it is
    case "orbit3d": {
      const tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, v.tilt + ORBIT_DEG_PER_PX * action.dy));
      return { ...state, view3d: { ...v, yaw: wrapped(v.yaw - ORBIT_DEG_PER_PX * action.dx), tilt } };
    }
    case "reset3d": return { ...state, view3d: { ...v, ...DEFAULT_ANGLES } };
    case "toggleRoof3d": return { ...state, view3d: { ...v, roof: !v.roof } }; // the Roof switch (roofs.13)
    default: { const never: never = action; return never; }
  }
}

/**
 * The 3D keys (heights.07, .31): 3 shows or hides the view; ⇧3 (the key 3 with Shift, or # or £ as layouts send it)
 * switches corner and split; [ and ] turn it, with Alt too (Italian Mac layouts type them with Alt). Never with Ctrl or
 * Cmd. Null for any other key. Value fields capture digits before this runs (keys.ts).
 */
export function view3dKey(state: EditorState, key: string, mods: Mods): EditorState | null {
  if (mods.ctrl || mods.meta) return null;
  if ((key === "3" && mods.shift) || key === "#" || key === "£") return onView3dUi(state, { type: "set3dSize", size: state.view3d.size === "corner" ? "split" : "corner" });
  if (key === "3") return onView3dUi(state, { type: "toggle3d" });
  if (key === "]" && state.view3d.open) return onView3dUi(state, { type: "turn3d", by: 1 });
  if (key === "[" && state.view3d.open) return onView3dUi(state, { type: "turn3d", by: -1 });
  return null;
}

/** The 3D panel's input for the render effect, or null when the view is closed or nothing frames it. */
export function view3dFrame(state: EditorState): View3dFrame | null {
  const v = state.view3d;
  const layout = activeStateId(state);
  if (!v.open || !state.document || layout === null) return null;
  const selected = state.selection.flatMap((r) => (r.table === "placements" || r.table === "decks" ? [r.id] : []));
  const f = state.flip;
  const doc = visibleDoc(state.document);
  // On, the house is seen from outside: no wall hidden, and its roof drawn when it has one (Outside under a flat ceiling,
  // inherit step 07).
  const roof = v.roof && roofOf(doc).shape !== "flat";
  const scene = sceneFor(doc, layout, f?.from ?? null, f?.to ?? null, f?.t ?? 0, idsKey(selected), v.roof ? "" : idsKey([...hiddenWalls(doc, v.yaw)]), state.finishesOn, true, roof);
  return scene === null ? null : frameFor(scene, v.yaw, v.tilt, v.size);
}

/**
 * A project card's 3D frame (cycle cards), or null without walls: finishes on, nothing selected, and no ground or
 * background, whose opaque rings would cover the card's grid (surroundings.07); on wheels its trailer, framed as the
 * panel frames it.
 */
export function cardFrame3d(doc: Document, layout: string, flip: { from: string; to: string; t: number } | null, yaw: number, tilt: number): View3dFrame | null {
  const scene = sceneFor(doc, layout, flip?.from ?? null, flip?.to ?? null, flip?.t ?? 0, "", idsKey([...hiddenWalls(doc, yaw)]), true, false, false);
  return scene === null ? null : frameFor(scene, yaw, tilt, "corner");
}

/**
 * The scene by value (graphics step 03, AC-04; real3d.11): the same object while nothing it shows changes, so the 3D
 * renderer builds its triangles once per scene. The flip, the selection and the hidden walls come in as values, being
 * new objects on every event; the hidden walls change with the yaw only when one crosses its edge-on angle. The document
 * is the visible one, which a drag's preview leaves alone (the preview lives in the Scene's document). `finishes` is
 * the viewer's Finishes switch (finishes.09). `ground`: whether the document's surroundings draw, with their
 * pulled-back box and background, or only a trailer on wheels, as a card's; an argument, as the panel and a card share
 * this one memo.
 */
const sceneFor = memoLast(
  (doc: Document, layout: string, flipFrom: string | null, flipTo: string | null, flipT: number, selection: string, hidden: string, finishes: boolean, ground: boolean, roof: boolean): View3d | null => {
    const shell = shellBounds(doc);
    if (!shell) return null;
    const flip = flipFrom !== null && flipTo !== null ? { from: flipFrom, to: flipTo, t: flipT } : null;
    const scene: View3d = { items: view3dItems(doc, layout, flip, idsOf(selection), finishes), bounds: shell, hidden: idsOf(hidden), ...(roof ? { roof: roofFaces(doc, STYLE_3D, finishes) } : {}) };
    const row = surroundingsRow(doc)?.row; // undefined: None, today's scene
    if (!row) return scene;
    const wheels = { trailer: trailerOf(doc), doors: outsideDoors(doc) };
    return { ...scene, ...(ground ? aroundShell(row, shell, wheels) : onWheels(row, shell, wheels)) };
  },
);

/** The frame by value: the scene, the angles and the size, the same object while none changes. */
const frameFor = memoLast((scene: View3d, yaw: number, tilt: number, size: View3dSize): View3dFrame => ({ scene, angles: { yaw, tilt }, size }));
