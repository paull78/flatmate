// The buffer layout of the render format (render.14): one table of each kind's Float32 record and the attributes the
// shaders read from it. The encoder writes by it, the GPU renderers set their attribute pointers or vertex layouts from
// it, and tests hold the GLSL (shaders.ts, shaders3d.ts) and the WGSL (wgsl.ts, shaders3d.ts) to it, so a stride lives in
// one place.

export type GeometryKind = "polygon" | "segment" | "arc" | "disc";

/**
 * The kinds in format order: the order of the header's section words and of the sections in a buffer, and the order
 * GPU renderers draw kinds within a layer (Canvas2D draws in scene order). Changing it changes the format.
 */
export const KIND_ORDER: readonly GeometryKind[] = ["polygon", "segment", "arc", "disc"];

/** One shader attribute: its location, how many floats it reads, and where it starts in the record (in floats). */
export type Attribute = { name: string; location: number; floats: number; offset: number };
/** A kind's record: `strideFloats` per instance (per vertex for polygons, drawn as plain triangles). */
export type KindLayout = { strideFloats: number; instanced: boolean; attributes: readonly Attribute[] };

/** Instanced kinds also read the shared unit quad (corners in [-1, 1]²) at this location, from its own buffer. */
export const CORNER_ATTRIBUTE: Attribute = { name: "a_corner", location: 0, floats: 2, offset: 0 };
/** That quad: four corners drawn as a triangle strip, one instance per quad. The shaders rely on this order. */
export const UNIT_QUAD: readonly number[] = [-1, -1, 1, -1, -1, 1, 1, 1];

export const LAYOUT: Readonly<Record<GeometryKind, KindLayout>> = {
  // x y | r g b a
  polygon: {
    strideFloats: 6,
    instanced: false,
    attributes: [
      { name: "a_position", location: 0, floats: 2, offset: 0 },
      { name: "a_color", location: 1, floats: 4, offset: 2 },
    ],
  },
  // ax ay bx by | width unit cap | dashOn dashOff | r g b a
  segment: {
    strideFloats: 13,
    instanced: true,
    attributes: [
      { name: "i_ends", location: 1, floats: 4, offset: 0 },
      { name: "i_style", location: 2, floats: 3, offset: 4 },
      { name: "i_dash", location: 3, floats: 2, offset: 7 },
      { name: "i_color", location: 4, floats: 4, offset: 9 },
    ],
  },
  // cx cy | radius start span | width unit | r g b a
  arc: {
    strideFloats: 11,
    instanced: true,
    attributes: [
      { name: "i_center", location: 1, floats: 2, offset: 0 },
      { name: "i_shape", location: 2, floats: 3, offset: 2 },
      { name: "i_width", location: 3, floats: 2, offset: 5 },
      { name: "i_color", location: 4, floats: 4, offset: 7 },
    ],
  },
  // cx cy | radius unit | r g b a
  disc: {
    strideFloats: 8,
    instanced: true,
    attributes: [
      { name: "i_center", location: 1, floats: 2, offset: 0 },
      { name: "i_radius", location: 2, floats: 2, offset: 2 },
      { name: "i_color", location: 3, floats: 4, offset: 4 },
    ],
  },
};

// The codes in the `unit` and `cap` fields. The shaders read them through these constants (shaders.ts), so a code
// lives here only.
export const UNIT_M = 0; // world metres, scaled by zoom
export const UNIT_PX = 1; // CSS pixels, screen-constant
export const CAP_BUTT = 0;
export const CAP_ROUND = 1;

/** The 3D view's faces and edges (webgpu.09): world x y z | r g b per vertex, read by both 3D shaders (shaders3d.ts). */
export const LAYOUT3D: Readonly<{ face3d: { strideFloats: number; attributes: readonly Attribute[] } }> = {
  face3d: {
    strideFloats: 6,
    attributes: [
      { name: "a_pos", location: 0, floats: 3, offset: 0 },
      { name: "a_color", location: 1, floats: 3, offset: 3 },
    ],
  },
};
