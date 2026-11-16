import { LOOK_LONG_SIDE, type Face3d, type LookScene3d } from "@fm/editor";
import { raster3d, triangles3d, view3dUniform, type Raster3d } from "@fm/render";
import { encodePng } from "./png";

// Look's 3D picture (real3d.11): the editor's faces through the same triangles and camera uniform WebGL draws
// (view3dUniform), into raster3d's depth buffer, at look's size. The tool, its tests and the palette sheet all draw
// through here.

type Colours = { background: string; edge: string };

/** Faces through a given camera uniform (packView3d), LOOK_LONG_SIDE square: for pictures framed another way. */
export function rasterFaces(faces: readonly Face3d[], view: Float32Array, colours: Colours): Raster3d {
  return raster3d(triangles3d(faces, colours.edge), view, LOOK_LONG_SIDE, colours.background);
}

/** The scene's RGBA pixels, LOOK_LONG_SIDE square. */
export function look3dPixels(scene: Omit<LookScene3d, "caption">): Raster3d {
  return rasterFaces(scene.faces, view3dUniform(scene.bounds, scene.angles), scene);
}

/** The scene as a PNG, LOOK_LONG_SIDE square. */
export function look3dPng(scene: Omit<LookScene3d, "caption">): Uint8Array {
  const { width, height, pixels } = look3dPixels(scene);
  return encodePng(width, height, pixels);
}
