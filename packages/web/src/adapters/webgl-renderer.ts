import { colorChannels, COLORS, type Camera, type Scene } from "@fm/editor";
import { backingSize, drawTextOverlay, fitCanvas as fit } from "./canvas2d-renderer";
import type { OnFrame, Renderer } from "./renderer";
import { CAMERA_GLSL, CAMERA_UNIFORM, packCamera, QUAD_VERTICES, TOPOLOGY, type CameraField, KIND_ORDER, LAYOUT, POLYGON_FS, POLYGON_VS, sdfShaders, UNIT_QUAD, type GeometryKind } from "@fm/render";
import { createLayerCache } from "./gpu-layers";
import { freeLayer, uploadLayer, type GpuDraw, type GpuLayer } from "./webgl/layers";

// WebGL2 renderer (spec: rendering): geometry on `glCanvas`, text on the Canvas2D `overlay` stacked above it (spec: rendering).
// Thin glue over the render format (@fm/render's encoder), the layer cache in gpu-layers.ts and WebGL's upload in
// webgl/layers.ts; the drawing is exercised in Playwright (e2e/renderers.spec.ts).
// The Scene's `underlay` is drawn by Canvas2D only; WebGL leaves it out (import.17).

/** Each camera field's uniform location, in CAMERA_UNIFORM's order. */
type Uniforms = readonly { field: CameraField; at: WebGLUniformLocation | null }[];
type Program = { program: WebGLProgram; uniforms: Uniforms };
type Programs = Record<GeometryKind, Program>;

const QUAD = new Float32Array(UNIT_QUAD); // the render format's unit quad, a triangle strip

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
  return { program, uniforms: CAMERA_UNIFORM.map((field) => ({ field, at: at(CAMERA_GLSL[field.name]) })) };
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

function deletePrograms(gl: WebGL2RenderingContext, programs: Programs, quad: WebGLBuffer): void {
  for (const kind of KIND_ORDER) gl.deleteProgram(programs[kind].program);
  gl.deleteBuffer(quad);
}

/** One draw call per draw, in the given order (layers, then kinds within a layer); nothing is uploaded here. */
function drawGeometry(gl: WebGL2RenderingContext, programs: Programs, batches: GpuDraw[], camera: Camera, size: { width: number; height: number }): void {
  const packed = packCamera(camera); // one layout for every renderer (webgpu.12)
  const [r, g, b] = colorChannels(COLORS.background);
  gl.viewport(0, 0, size.width, size.height);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const batch of batches) {
    const p = programs[batch.kind];
    gl.useProgram(p.program);
    for (const { field, at } of p.uniforms) {
      const value = packed.subarray(field.offset / 4, field.offset / 4 + field.floats);
      if (field.floats === 2) gl.uniform2fv(at, value);
      else gl.uniform1fv(at, value);
    }
    gl.bindVertexArray(batch.vao);
    const mode = TOPOLOGY[batch.kind] === "triangle-strip" ? gl.TRIANGLE_STRIP : gl.TRIANGLES;
    if (LAYOUT[batch.kind].instanced) gl.drawArraysInstanced(mode, 0, QUAD_VERTICES, batch.count);
    else gl.drawArrays(mode, 0, batch.count);
  }
  gl.bindVertexArray(null);
}

/**
 * The WebGL2 renderer, or null when WebGL2 (or a shader) is unavailable: the caller then keeps Canvas2D.
 * `onLost` runs on `webglcontextlost`; there is no restore (the switch falls back to Canvas2D).
 * Like Canvas2D it draws at most once per animation frame, the latest scene winning. Its encoder sends a layer's
 * buffer only when the layer's rev changes (spec: rendering, P3, render.13): the editor keeps the walls, floors and tags
 * arrays while they are unchanged, so a pan uploads only the small layers. A new renderer has a new encoder, so its
 * first frame uploads everything.
 * `sdfDebug` (`?sdf=debug`) compiles the SDF programs in their debug form (see @fm/render's shaders.ts); nothing else changes.
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
  const layers = createLayerCache<GpuLayer>({ upload: (data) => uploadLayer(gl, quad, data), free: (layer) => freeLayer(gl, layer) });
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
    const synced = layers.sync(scene);
    const size = backingSize(camera);
    fit(glCanvas, size);
    fit(overlay, size);
    drawGeometry(gl, programs, synced.layers.flatMap((l) => l.draws), camera, size);
    drawTextOverlay(text, synced.texts, camera);
    if (options.onFrame) {
      gl.finish(); // only when measuring (spec: rendering): waits for the GPU, so the time includes its work
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
      lost = true; // a render() after dispose draws nothing
      cancel();
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      if (!gl.isContextLost()) {
        layers.dispose();
        deletePrograms(gl, programs, quad);
      }
    },
  };
}
