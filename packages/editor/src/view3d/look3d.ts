import { outsideDoors, roofOf, trailerOf, type Document } from "@fm/domain";
import { shellBounds, TILT_MAX, TILT_MIN } from "./camera3d";
import { aroundShell } from "./ground-faces";
import { hiddenWalls } from "./hidden";
import { view3dItems } from "./items";
import { sceneFaces } from "./scene-faces";
import { STYLE_3D, type Style3d } from "./style";
import { surroundingsRow } from "./surroundings";
import type { Angles3d, Bounds3, Face3d } from "./types";
import { roofFaces } from "./roof-faces";

/**
 * What Claude's 3D look draws (real3d.11): the faces, the box and angles the camera frames, the colours; never pixels.
 * With surroundings, the ground's faces come first, the box is pulled back and the background is the surroundings'.
 */
export type LookScene3d = { faces: Face3d[]; bounds: Bounds3; angles: Angles3d; background: string; edge: string; caption: string };

/**
 * Claude's `look` in 3D (heights.20, .32, real3d.06): the faces of `state` seen at `angles` (the yaw taken round the
 * circle), for the shell's raster3d to draw as the panel's WebGL does. Refused for a tilt outside the camera's range
 * (the orbit's own), without walls (nothing frames the camera) or for an unknown state.
 */
export function lookScene3d(doc: Document, state: string, angles: Angles3d, style: Style3d = STYLE_3D, roof = false): LookScene3d | { refused: string } {
  if (!(angles.tilt >= TILT_MIN && angles.tilt <= TILT_MAX)) return { refused: `The tilt is ${TILT_MIN} to ${TILT_MAX} degrees` };
  const shell = shellBounds(doc);
  if (!shell) return { refused: "Nothing to look at in 3D yet: draw some walls" };
  const seen = { yaw: ((angles.yaw % 360) + 360) % 360, tilt: angles.tilt };
  const s = Object.hasOwn(doc.states, state) ? doc.states[state] : undefined;
  if (!s) return { refused: `No layout state has the id ${state}` };
  const surroundings = surroundingsRow(doc); // null: None, today's picture
  const around = surroundings ? aroundShell(surroundings.row, shell, { trailer: trailerOf(doc), doors: outsideDoors(doc) }, style) : null; // as the panel's scene has it
  const items = view3dItems(doc, state, null, new Set(), true); // finishes always: look has no switch
  const roofed = roof && roofOf(doc).shape !== "flat"; // as the panel's Roof switch: the roof over every wall (roofs.13)
  // Under a flat ceiling `roof` is the Outside switch: every wall, no roof (inherit step 07).
  const house = sceneFaces({ items, hidden: roof ? new Set() : hiddenWalls(doc, seen.yaw), ...(roofed ? { roof: roofFaces(doc, style, true) } : {}), ...(around?.trailer ? { trailer: around.trailer } : {}) }, style); // its trailer last
  const faces = around ? [...around.ground, ...house] : house; // the ground first, as the panel draws it
  // Named, so Claude doesn't read the ground as drawing content (surroundings.15).
  const named = surroundings ? `; round it, the ${surroundings.label} surroundings, not part of the drawing` : "";
  return {
    faces, bounds: around?.bounds ?? shell, angles: seen, edge: style.edge,
    background: around?.background ?? style.background, // the surroundings' own, over the palette's
    caption: `3D view of ${s.name}, yaw ${round(seen.yaw)}°, tilt ${round(seen.tilt)}°; ${roofed ? "the roof drawn over every wall" : roof ? "every wall shown from outside, no roof" : "shell walls facing the camera are hidden, the ceiling is not drawn"}${named}`,
  };
}

const round = (deg: number): number => Math.round(deg * 10) / 10;
