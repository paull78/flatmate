import { COLORS, type Camera, type Scene } from "@fm/editor";
import { backingSize, drawTextOverlay } from "./canvas2d-renderer";
import type { OnFrame, Renderer } from "./renderer";
import {
  ARC_FLOATS,
  DISC_FLOATS,
  KIND_ORDER,
  POLYGON_VERTEX_FLOATS,
  SEGMENT_FLOATS,
  buildFrame,
  parseColor,
  type Frame,
  type GeometryKind,
} from "./webgl/instances";
import { POLYGON_FS, POLYGON_VS, sdfShaders } from "./webgl/shaders";

// WebGL2 renderer (spec §6.2): geometry on `glCanvas`, text on the Canvas2D `overlay` stacked above it (spec §6.1).
// Thin glue over the pure `buildFrame`; it is exercised in Playwright (e2e/renderers.spec.ts), not in Vitest.

type Uniforms = { center: WebGLUniformLocation | null; zoom: WebGLUniformLocation | null; half: WebGLUniformLocation | null; dpr: WebGLUniformLocation | null };
type Program = { program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer; uniforms: Uniforms };
type Programs = Record<GeometryKind, Program>;
/** One attribute: its shader location, float count and float offset inside the instance (or vertex). */
type Attribute = [location: number, size: number, offset: number];

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]); // triangle strip, corners in [-1, 1]²

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

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? "no log"}`);
  }
  return program;
}

/** A program with its VAO: instanced kinds read the shared quad at location 0 and one instance per quad. */
function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string, stride: number, attributes: Attribute[], quad: WebGLBuffer | null): Program {
  const program = link(gl, vs, fs);
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  if (quad !== null) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [location, size, offset] of attributes) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    if (quad !== null) gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  return { program, vao, buffer, uniforms: { center: at("u_center"), zoom: at("u_zoom"), half: at("u_half"), dpr: at("u_dpr") } };
}

function createPrograms(gl: WebGL2RenderingContext, sdfDebug: boolean): { programs: Programs; quad: WebGLBuffer } {
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  const sdf = sdfShaders(sdfDebug);
  const programs: Programs = {
    polygon: makeProgram(gl, POLYGON_VS, POLYGON_FS, POLYGON_VERTEX_FLOATS, [[0, 2, 0], [1, 4, 2]], null),
    segment: makeProgram(gl, sdf.segment.vs, sdf.segment.fs, SEGMENT_FLOATS, [[1, 4, 0], [2, 3, 4], [3, 2, 7], [4, 4, 9]], quad),
    arc: makeProgram(gl, sdf.arc.vs, sdf.arc.fs, ARC_FLOATS, [[1, 2, 0], [2, 3, 2], [3, 2, 5], [4, 4, 7]], quad),
    disc: makeProgram(gl, sdf.disc.vs, sdf.disc.fs, DISC_FLOATS, [[1, 2, 0], [2, 2, 2], [3, 4, 4]], quad),
  };
  return { programs, quad };
}

function deletePrograms(gl: WebGL2RenderingContext, programs: Programs, quad: WebGLBuffer): void {
  for (const kind of KIND_ORDER) {
    const p = programs[kind];
    gl.deleteProgram(p.program);
    gl.deleteVertexArray(p.vao);
    gl.deleteBuffer(p.buffer);
  }
  gl.deleteBuffer(quad);
}

/** One draw call per batch, in the frame's order (layers, then kinds within a layer). */
function drawGeometry(gl: WebGL2RenderingContext, programs: Programs, frame: Frame, camera: Camera, size: { width: number; height: number }): void {
  const [r, g, b] = parseColor(COLORS.background);
  gl.viewport(0, 0, size.width, size.height);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const batch of frame.batches) {
    const p = programs[batch.kind];
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.center, camera.center.x, camera.center.y);
    gl.uniform1f(p.uniforms.zoom, camera.zoom);
    gl.uniform2f(p.uniforms.half, camera.viewport.width / 2, camera.viewport.height / 2);
    gl.uniform1f(p.uniforms.dpr, camera.dpr);
    gl.bindVertexArray(p.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.DYNAMIC_DRAW);
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
 * Like Canvas2D it draws at most once per animation frame, the latest scene winning; the frame's buffers are
 * rebuilt only for a new Scene object, which in practice is every editor event (the editor rebuilds its Scene).
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
  let built: { scene: Scene; frame: Frame } | null = null;
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
    if (built === null || built.scene !== scene) built = { scene, frame: buildFrame(scene) };
    const size = backingSize(camera);
    fit(glCanvas, size);
    fit(overlay, size);
    drawGeometry(gl, programs, built.frame, camera, size);
    drawTextOverlay(text, built.frame.texts, camera);
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
      if (!gl.isContextLost()) deletePrograms(gl, programs, quad);
      built = null;
    },
  };
}
