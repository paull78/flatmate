import { COLORS, type Camera, type LayerName, type Primitive, type Scene } from "@fm/editor";
import { backingSize, drawTextOverlay } from "./canvas2d-renderer";
import type { OnFrame, Renderer } from "./renderer";
import {
  ARC_FLOATS,
  DISC_FLOATS,
  KIND_ORDER,
  POLYGON_VERTEX_FLOATS,
  SEGMENT_FLOATS,
  buildLayer,
  parseColor,
  type Batch,
  type GeometryKind,
  type TextPrimitive,
} from "./webgl/instances";
import { POLYGON_FS, POLYGON_VS, sdfShaders } from "./webgl/shaders";

// WebGL2 renderer (spec §6.2): geometry on `glCanvas`, text on the Canvas2D `overlay` stacked above it (spec §6.1).
// Thin glue over the pure `buildLayer`; it is exercised in Playwright (e2e/renderers.spec.ts), not in Vitest.

type Uniforms = { center: WebGLUniformLocation | null; zoom: WebGLUniformLocation | null; half: WebGLUniformLocation | null; dpr: WebGLUniformLocation | null };
type Program = { program: WebGLProgram; uniforms: Uniforms };
type Programs = Record<GeometryKind, Program>;
/** One attribute: its shader location, float count and float offset inside the instance (or vertex). */
type Attribute = [location: number, size: number, offset: number];
/** How a kind's data is laid out: floats per instance (per vertex for polygons) and its attributes. */
type Layout = { stride: number; attributes: Attribute[]; instanced: boolean };
/** A batch on the GPU: its own buffer and vertex array, kept while its layer's primitives array is unchanged. */
type GpuBatch = { kind: GeometryKind; count: number; vao: WebGLVertexArrayObject; buffer: WebGLBuffer };
type CachedLayer = { primitives: readonly Primitive[]; batches: GpuBatch[]; texts: TextPrimitive[] };

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]); // triangle strip, corners in [-1, 1]²

const LAYOUTS: Record<GeometryKind, Layout> = {
  polygon: { stride: POLYGON_VERTEX_FLOATS, attributes: [[0, 2, 0], [1, 4, 2]], instanced: false },
  segment: { stride: SEGMENT_FLOATS, attributes: [[1, 4, 0], [2, 3, 4], [3, 2, 7], [4, 4, 9]], instanced: true },
  arc: { stride: ARC_FLOATS, attributes: [[1, 2, 0], [2, 3, 2], [3, 2, 5], [4, 4, 7]], instanced: true },
  disc: { stride: DISC_FLOATS, attributes: [[1, 2, 0], [2, 2, 2], [3, 4, 4]], instanced: true },
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader) ?? "no log"}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? "no log"}`);
  }
  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  return { program, uniforms: { center: at("u_center"), zoom: at("u_zoom"), half: at("u_half"), dpr: at("u_dpr") } };
}

function createPrograms(gl: WebGL2RenderingContext, sdfDebug: boolean): { programs: Programs; quad: WebGLBuffer } {
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  const sdf = sdfShaders(sdfDebug);
  const programs: Programs = {
    polygon: link(gl, POLYGON_VS, POLYGON_FS),
    segment: link(gl, sdf.segment.vs, sdf.segment.fs),
    arc: link(gl, sdf.arc.vs, sdf.arc.fs),
    disc: link(gl, sdf.disc.vs, sdf.disc.fs),
  };
  return { programs, quad };
}

/** Uploads one batch once: instanced kinds read the shared quad at location 0 and one instance per quad. */
function uploadBatch(gl: WebGL2RenderingContext, batch: Batch, quad: WebGLBuffer): GpuBatch {
  const { stride, attributes, instanced } = LAYOUTS[batch.kind];
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  if (instanced) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.STATIC_DRAW);
  for (const [location, size, offset] of attributes) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    if (instanced) gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return { kind: batch.kind, count: batch.count, vao, buffer };
}

function freeBatches(gl: WebGL2RenderingContext, batches: GpuBatch[]): void {
  for (const b of batches) {
    gl.deleteVertexArray(b.vao);
    gl.deleteBuffer(b.buffer);
  }
}

function deletePrograms(gl: WebGL2RenderingContext, programs: Programs, quad: WebGLBuffer): void {
  for (const kind of KIND_ORDER) gl.deleteProgram(programs[kind].program);
  gl.deleteBuffer(quad);
}

/** One draw call per batch, in the given order (layers, then kinds within a layer); nothing is uploaded here. */
function drawGeometry(gl: WebGL2RenderingContext, programs: Programs, batches: GpuBatch[], camera: Camera, size: { width: number; height: number }): void {
  const [r, g, b] = parseColor(COLORS.background);
  gl.viewport(0, 0, size.width, size.height);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const batch of batches) {
    const p = programs[batch.kind];
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.center, camera.center.x, camera.center.y);
    gl.uniform1f(p.uniforms.zoom, camera.zoom);
    gl.uniform2f(p.uniforms.half, camera.viewport.width / 2, camera.viewport.height / 2);
    gl.uniform1f(p.uniforms.dpr, camera.dpr);
    gl.bindVertexArray(batch.vao);
    if (batch.kind === "polygon") gl.drawArrays(gl.TRIANGLES, 0, batch.count);
    else gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
  }
  gl.bindVertexArray(null);
}

function fit(canvas: HTMLCanvasElement, size: { width: number; height: number }): void {
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
}

/**
 * The WebGL2 renderer, or null when WebGL2 (or a shader) is unavailable: the caller then keeps Canvas2D.
 * `onLost` runs on `webglcontextlost`; there is no restore (the switch falls back to Canvas2D).
 * Like Canvas2D it draws at most once per animation frame, the latest scene winning. Each layer's batches are
 * built and uploaded only when its primitives array is a new object (spec §6.2, P3): the editor keeps the walls,
 * floors and tags arrays while they are unchanged, so a pan uploads only the small layers.
 * `sdfDebug` (`?sdf=debug`) compiles the SDF programs in their debug form (see shaders.ts); nothing else changes.
 */
export function createWebGLRenderer(glCanvas: HTMLCanvasElement, overlay: HTMLCanvasElement, onLost: () => void, options: { sdfDebug: boolean; onFrame?: OnFrame }): Renderer | null {
  const gl = glCanvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: true });
  const text = overlay.getContext("2d");
  if (gl === null || gl.isContextLost() || text === null) {
    // Says which part failed, so a fallback on a user's machine can be diagnosed from the console.
    console.warn(`WebGL2 renderer unavailable: ${gl === null ? "no webgl2 context (GPU acceleration off or WebGL blocked?)" : gl.isContextLost() ? "context lost" : "no 2d overlay context"}`);
    return null;
  }
  let made: { programs: Programs; quad: WebGLBuffer };
  try {
    made = createPrograms(gl, options.sdfDebug);
  } catch (error) {
    console.error(error);
    return null;
  }
  const { programs, quad } = made;
  let pending: { scene: Scene; camera: Camera } | null = null;
  let frame: number | null = null;
  const layers = new Map<LayerName, CachedLayer>();
  let lost = false;

  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };
  const onContextLost = (): void => {
    lost = true;
    cancel();
    onLost();
  };
  glCanvas.addEventListener("webglcontextlost", onContextLost);

  const draw = (): void => {
    frame = null;
    if (pending === null || lost) return;
    const { scene, camera } = pending;
    pending = null;
    const started = performance.now();
    const batches: GpuBatch[] = [];
    const texts: TextPrimitive[] = [];
    for (const layer of scene.layers) {
      let cached = layers.get(layer.name);
      if (cached?.primitives !== layer.primitives) {
        if (cached) freeBatches(gl, cached.batches);
        const built = buildLayer(layer);
        cached = { primitives: layer.primitives, batches: built.batches.map((b) => uploadBatch(gl, b, quad)), texts: built.texts };
        layers.set(layer.name, cached);
      }
      batches.push(...cached.batches);
      texts.push(...cached.texts);
    }
    const size = backingSize(camera);
    fit(glCanvas, size);
    fit(overlay, size);
    drawGeometry(gl, programs, batches, camera, size);
    drawTextOverlay(text, texts, camera);
    if (options.onFrame) {
      gl.finish(); // only when measuring (spec §6.3): waits for the GPU, so the time includes its work
      options.onFrame(performance.now() - started, scene);
    }
  };

  return {
    render(scene, camera) {
      if (lost) return;
      pending = { scene, camera };
      if (frame === null) frame = requestAnimationFrame(draw);
    },
    dispose() {
      cancel();
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      if (!gl.isContextLost()) {
        for (const cached of layers.values()) freeBatches(gl, cached.batches);
        deletePrograms(gl, programs, quad);
      }
      layers.clear();
    },
  };
}
