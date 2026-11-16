import { colorChannels, sceneFaces, STYLE_3D, type Face3d, type View3d, type View3dFrame } from "@fm/editor";
import { FACE3D_FS, FACE3D_POLYGON_OFFSET, FACE3D_VS, LAYOUT3D, triangles3d, VIEW3D_GLSL, VIEW3D_UNIFORM, view3dUniform } from "@fm/render";
import type { Renderer3d } from "./renderer3d";

const NO_GROUND: readonly Face3d[] = [];

// The 3D view on WebGL2 (heights.34, real3d.02): the scene's faces, unordered, as triangles with a depth buffer; one
// matrix (the camera's), back-face culling, the edges as lines on top. The picture fits a centred square, as look's
// raster3d draws it. No 3D library: a few hundred lines (tooling.md, bundle size).

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) throw new Error(`3D shader compile failed: ${gl.getShaderInfoLog(shader) ?? "no log"}`);
  return shader;
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, FACE3D_VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FACE3D_FS));
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) throw new Error(`3D program link failed: ${gl.getProgramInfoLog(p) ?? "no log"}`);
  return p;
}

/**
 * The WebGL2 3D renderer on a canvas of its own in `host`, or null when WebGL2 (or its shader) is unavailable: the
 * panel then shows a note. `onLost` runs on `webglcontextlost`; there is no restore (the note takes the panel).
 * Draws at most once per animation frame, the latest frame winning, and again when the host is resized. `onFrame`
 * (`?perf`) gets each drawn frame's time, waiting for the GPU (`gl.finish`) as the plan's WebGL renderer does.
 */
export function createWebgl3dRenderer(host: HTMLElement, onLost: () => void, onFrame?: (ms: number) => void, transparent = false): Renderer3d | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: transparent }); // transparent: a project card's grid shows through
  if (gl === null || gl.isContextLost()) {
    console.warn("WebGL2 3D renderer unavailable: the 3D panel shows a note");
    return null;
  }
  let prog: WebGLProgram;
  try {
    prog = program(gl);
  } catch (error) {
    console.error(error);
    return null;
  }
  const fillBuffer = gl.createBuffer();
  const edgeBuffer = gl.createBuffer();
  const groundFillBuffer = gl.createBuffer();
  const groundEdgeBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  const at = (name: string) => gl.getUniformLocation(prog, name);
  const uniforms = VIEW3D_UNIFORM.map((field) => ({ field, at: at(VIEW3D_GLSL[field.name]) }));
  const { strideFloats, attributes } = LAYOUT3D.face3d;
  host.replaceChildren(canvas);

  let last: View3dFrame | null = null;
  let frame: number | null = null;
  let lost = false;
  // The frame on the canvas, and its triangles (graphics step 04): the editor keeps a frame's identity while nothing it
  // shows changes, so a pan, a hover or a drag's move draws nothing, and a resize redraws without building them again.
  let drawn: View3dFrame | null | undefined; // undefined: nothing drawn yet
  let drawnDpr = 0; // a new devicePixelRatio (browser zoom, another screen) resizes the canvas: the next render redraws
  type Built = { scene: View3d; fill: Float32Array; edges: Float32Array };
  let built: Built | null = null;
  let uploaded: Built | null = null; // the triangles in the GL buffers: uploaded once per scene, not per drag step
  // The surroundings' ground (about 5000 faces, surroundings.21) apart, in buffers of its own: the editor keeps it while
  // the walls' box stays, so a flip's frames and a selection rebuild only the house's triangles.
  type BuiltGround = { ground: readonly Face3d[]; fill: Float32Array; edges: Float32Array };
  let builtGround: BuiltGround | null = null;
  let uploadedGround: BuiltGround | null = null;

  const draw = (): void => {
    frame = null;
    if (lost) return;
    const dpr = window.devicePixelRatio || 1;
    drawnDpr = dpr;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    if (transparent) gl.clearColor(0, 0, 0, 0); // a card's grid shows through, whatever the scene's background
    else {
      // The surroundings' background, which their ground fades into; the palette's with none, or with no frame.
      const [br, bg, bb] = colorChannels(last?.scene.background ?? STYLE_3D.background);
      gl.clearColor(br, bg, bb, 1);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawn = last;
    if (last === null) return;
    const started = onFrame ? performance.now() : 0;
    const { scene } = last;
    if (built?.scene !== scene) built = { scene, ...triangles3d(sceneFaces(scene), STYLE_3D.edge) }; // once per scene (real3d.11)
    const ground = scene.ground ?? NO_GROUND;
    if (builtGround?.ground !== ground) builtGround = { ground, ...triangles3d(ground, STYLE_3D.edge) }; // once per ground
    const { fill, edges } = built;
    const side = Math.min(w, h);
    gl.viewport(Math.floor((w - side) / 2), Math.floor((h - side) / 2), side, side);
    gl.useProgram(prog);
    const packed = view3dUniform(last.scene.bounds, last.angles); // the uniform's one layout and depth range (webgpu.12)
    for (const { field, at: loc } of uniforms) {
      const value = packed.subarray(field.offset / 4, field.offset / 4 + field.floats);
      if (field.floats === 4) gl.uniform4fv(loc, value);
      else gl.uniform2fv(loc, value);
    }
    gl.bindVertexArray(vao);
    const fresh = uploaded !== built;
    uploaded = built;
    const freshGround = uploadedGround !== builtGround;
    uploadedGround = builtGround;
    const bind = (buffer: WebGLBuffer, data: Float32Array, upload = fresh): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (upload) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      for (const { location, floats, offset } of attributes) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, floats, gl.FLOAT, false, strideFloats * 4, offset * 4);
      }
    };
    // The ground's fills or edges, drawn before the house's as look lists them; none without surroundings.
    const groundPart = (buffer: WebGLBuffer, data: Float32Array, mode: number): void => {
      if (data.length === 0) return;
      bind(buffer, data, freshGround);
      gl.drawArrays(mode, 0, data.length / strideFloats);
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.POLYGON_OFFSET_FILL); // the fills step back so their edges, at the same depth, draw on top
    gl.polygonOffset(FACE3D_POLYGON_OFFSET.factor, FACE3D_POLYGON_OFFSET.units);
    groundPart(groundFillBuffer, builtGround.fill, gl.TRIANGLES);
    bind(fillBuffer, fill);
    gl.drawArrays(gl.TRIANGLES, 0, fill.length / strideFloats);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    groundPart(groundEdgeBuffer, builtGround.edges, gl.LINES);
    bind(edgeBuffer, edges); // in the edge colour, carried by the vertices (webgpu.09)
    gl.drawArrays(gl.LINES, 0, edges.length / strideFloats);
    gl.bindVertexArray(null);
    if (onFrame) {
      gl.finish();
      onFrame(performance.now() - started);
    }
  };
  const schedule = (): void => {
    if (frame === null && !lost) frame = requestAnimationFrame(draw);
  };
  const resized = new ResizeObserver(schedule);
  resized.observe(canvas);
  const onContextLost = (): void => {
    lost = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    onLost();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  return {
    render(next) {
      last = next;
      if (next !== drawn || (window.devicePixelRatio || 1) !== drawnDpr) schedule();
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      resized.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      if (!gl.isContextLost()) {
        gl.deleteBuffer(fillBuffer);
        gl.deleteBuffer(edgeBuffer);
        gl.deleteBuffer(groundFillBuffer);
        gl.deleteBuffer(groundEdgeBuffer);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(prog);
      }
      canvas.remove();
    },
  };
}
