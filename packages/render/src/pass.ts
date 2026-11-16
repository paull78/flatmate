import { CORNER_ATTRIBUTE, LAYOUT, LAYOUT3D, type Attribute, type GeometryKind } from "./layout";

// The facts a WebGPU pass (in a browser now, in G4's wgpu shell later) reads from the render format (webgpu.11), as plain
// data: a core can't name WebGPU's DOM types, but these literals are what WebGPU and wgpu take.

/** Instanced kinds read the unit quad at QUAD_SLOT and their records at RECORD_SLOT; polygons read records at slot 0. */
export const QUAD_SLOT = 0;
export const RECORD_SLOT = 1;
export const POLYGON_SLOT = 0;
/** The unit quad's vertices (UNIT_QUAD has two floats each): an instanced kind draws QUAD_VERTICES per instance. */
export const QUAD_VERTICES = 4;
/** Where the camera uniform binds (`@group(0) @binding(0)` in every 2D WGSL module). */
export const CAMERA_BINDING = { group: 0, binding: 0 } as const;
/** Multisampling: WebGL's `antialias: true` is 4 samples on the machines measured, so the WebGPU pass matches it. */
export const SAMPLE_COUNT = 4;
/** How each kind's vertices assemble: polygons are plain triangles, instanced kinds one quad strip per instance. */
export const TOPOLOGY: Readonly<Record<GeometryKind, "triangle-list" | "triangle-strip">> = { polygon: "triangle-list", segment: "triangle-strip", arc: "triangle-strip", disc: "triangle-strip" };
/**
 * The canvas formats a pass may target: non-sRGB 8-bit, so the shaders' premultiplied output is written as is (an sRGB
 * target, which wgpu surfaces often prefer, would wash it out). Clip z runs 0..1, as WebGPU and wgpu define it.
 */
export const TARGET_FORMATS = ["bgra8unorm", "rgba8unorm"] as const;
/** Entry point names in every WGSL module. */
export const ENTRY = { vertex: "vs", fragment: "fs" } as const;
/** Premultiplied output over the cleared canvas, as WebGL's blendFunc(ONE, ONE_MINUS_SRC_ALPHA). */
export const BLEND = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
} as const;

export type VertexFormat = "float32" | "float32x2" | "float32x3" | "float32x4";
export type VertexAttributeLayout = { shaderLocation: number; offset: number; format: VertexFormat };
export type VertexBufferLayout = { arrayStride: number; stepMode: "vertex" | "instance"; attributes: VertexAttributeLayout[] };

const FORMATS: readonly VertexFormat[] = ["float32", "float32x2", "float32x3", "float32x4"];

function format(floats: number): VertexFormat {
  const f = FORMATS[floats - 1];
  if (f === undefined) throw new Error(`no vertex format of ${floats} floats`);
  return f;
}

function buffer(strideFloats: number, stepMode: "vertex" | "instance", attributes: readonly Attribute[]): VertexBufferLayout {
  return { arrayStride: 4 * strideFloats, stepMode, attributes: attributes.map((a) => ({ shaderLocation: a.location, offset: 4 * a.offset, format: format(a.floats) })) };
}

/** Each kind's vertex buffers by slot, from LAYOUT; fresh arrays on every call (WebGPU's layout arrays are mutable). */
export function vertexLayouts(): Record<GeometryKind, VertexBufferLayout[]> {
  const instanced = (kind: GeometryKind): VertexBufferLayout[] => {
    const slots: VertexBufferLayout[] = [];
    slots[QUAD_SLOT] = buffer(CORNER_ATTRIBUTE.floats, "vertex", [CORNER_ATTRIBUTE]);
    slots[RECORD_SLOT] = buffer(LAYOUT[kind].strideFloats, "instance", LAYOUT[kind].attributes);
    return slots;
  };
  return {
    polygon: [buffer(LAYOUT.polygon.strideFloats, "vertex", LAYOUT.polygon.attributes)],
    segment: instanced("segment"),
    arc: instanced("arc"),
    disc: instanced("disc"),
  };
}

/** The 3D faces' one vertex buffer, from LAYOUT3D.face3d (fills as a triangle list, edges as a line list). */
export function vertexLayout3d(): VertexBufferLayout {
  return buffer(LAYOUT3D.face3d.strideFloats, "vertex", LAYOUT3D.face3d.attributes);
}
