import { CORNER_ATTRIBUTE, KIND_ORDER, LAYOUT, readHeader, type GeometryKind } from "@fm/render";

// WebGL's upload and free for the layer cache in ../gpu-layers.ts (render.13, .14; webgpu.11): one buffer per layer
// and one vertex array per non-empty kind. Pure glue over a few GL calls, so a fake context can count them (the
// drawing itself is in Playwright).

/** The GL calls an upload and a free make. */
export type LayerGl = Pick<
  WebGL2RenderingContext,
  | "ARRAY_BUFFER" | "STATIC_DRAW" | "FLOAT" | "createBuffer" | "createVertexArray" | "bindVertexArray" | "bindBuffer"
  | "bufferData" | "enableVertexAttribArray" | "vertexAttribPointer" | "vertexAttribDivisor" | "deleteBuffer" | "deleteVertexArray"
>;
/** One draw call: `count` instances, or vertices for polygons (plain triangles). */
export type GpuDraw = { kind: GeometryKind; count: number; vao: WebGLVertexArrayObject };
/** A layer on the GPU: its one buffer and its draws in KIND_ORDER. */
export type GpuLayer = { buffer: WebGLBuffer; draws: GpuDraw[] };

/** Uploads a layer's buffer once and points one vertex array per non-empty kind at its section, by the layout table. */
export function uploadLayer(gl: LayerGl, quad: WebGLBuffer, data: ArrayBuffer): GpuLayer {
  const { sections } = readHeader(data);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const draws: GpuDraw[] = [];
  for (const kind of KIND_ORDER) {
    const { count, byteOffset, strideBytes } = sections[kind];
    if (count === 0) continue;
    const { attributes, instanced } = LAYOUT[kind];
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    if (instanced) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(CORNER_ATTRIBUTE.location);
      gl.vertexAttribPointer(CORNER_ATTRIBUTE.location, CORNER_ATTRIBUTE.floats, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const { location, floats, offset } of attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, floats, gl.FLOAT, false, strideBytes, byteOffset + offset * 4);
      if (instanced) gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    draws.push({ kind, count, vao });
  }
  return { buffer, draws };
}

export function freeLayer(gl: LayerGl, layer: GpuLayer): void {
  for (const d of layer.draws) gl.deleteVertexArray(d.vao);
  gl.deleteBuffer(layer.buffer);
}
