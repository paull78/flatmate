import { describe, expect, it } from "vitest";
import { camera3d, type Bounds3, type Face3d } from "@fm/editor";
import { ENTRY, FACE3D_FS, FACE3D_VS, LAYOUT3D, VIEW3D_BYTES, VIEW3D_GLSL, VIEW3D_UNIFORM, WGSL_FACE3D, packView3d, triangles3d, vertexLayout3d } from "../src/index";

const FACE3D_VERTEX_FLOATS = LAYOUT3D.face3d.strideFloats;

// The 3D faces in the render format (webgpu.09, AC-06): one vertex layout read by both 3D shaders, and the edges'
// colour in their vertices, since WebGPU can't switch a uniform between two draws of one pass.

const square: Face3d = {
  points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
  holes: [],
  color: "#808080",
  owner: "w1",
};

describe("triangles3d", () => {
  it("writes the edge colour into every edge vertex, the face colour into the fill", () => {
    const { fill, edges } = triangles3d([square], "#123456");
    expect(FACE3D_VERTEX_FLOATS).toBe(6);
    expect(edges.length / FACE3D_VERTEX_FLOATS).toBe(8); // four edges, two vertices each
    for (let v = 0; v < edges.length; v += 6) expect([edges[v + 3], edges[v + 4], edges[v + 5]]).toEqual([0x12 / 255, 0x34 / 255, 0x56 / 255].map((c) => Math.fround(c)));
    for (let v = 0; v < fill.length; v += 6) expect(fill[v + 3]).toBeCloseTo(0x80 / 255, 6);
  });
});

/** `layout(location = N) in vecK name;` in a GLSL vertex shader. */
const glslInputs = (src: string) => [...src.matchAll(/layout\(location = (\d+)\) in vec(\d) (\w+);/g)].map((m) => ({ location: Number(m[1]), floats: Number(m[2]), name: m[3] }));
/** The `vs` entry point's `@location(N) name: vecKf` parameters in WGSL. */
const wgslInputs = (src: string) => {
  const params = /fn vs\(([\s\S]*?)\)\s*->/.exec(src)?.[1] ?? "";
  return [...params.matchAll(/@location\((\d+)\) (\w+): vec(\d)f/g)].map((m) => ({ location: Number(m[1]), floats: Number(m[3]), name: m[2] }));
};

describe("the 3D shaders read LAYOUT3D.face3d", () => {
  const expected = LAYOUT3D.face3d.attributes.map(({ location, floats, name }) => ({ location, floats, name }));
  it("GLSL", () => expect(glslInputs(FACE3D_VS)).toEqual(expected));
  it("WGSL", () => expect(wgslInputs(WGSL_FACE3D)).toEqual(expected));
  it("the stride covers the attributes", () => {
    const last = LAYOUT3D.face3d.attributes.at(-1);
    expect((last?.offset ?? 0) + (last?.floats ?? 0)).toBe(LAYOUT3D.face3d.strideFloats);
  });
  it("no per-draw uniforms are left: the colour comes from the vertices", () => {
    for (const src of [FACE3D_VS, FACE3D_FS, WGSL_FACE3D]) expect(src).not.toMatch(/u_tint|u_flat/);
  });
  it("WGSL maps the GLSL's -1..1 depth into WebGPU's 0..1", () => {
    expect(WGSL_FACE3D).toContain("0.5 * d + 0.5");
  });
});

describe("the 3D uniform and entry points (webgpu.12)", () => {
  it("packView3d writes the matrix rows and the depth range at VIEW3D_UNIFORM's offsets", () => {
    const m = [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 1, 0];
    const packed = packView3d(m, { min: { x: 0, y: 0 }, max: { x: 2, y: 3 }, top: 2.5 });
    expect(packed.byteLength).toBe(VIEW3D_BYTES);
    const at = (name: string): number => (VIEW3D_UNIFORM.find((f) => f.name === name)?.offset ?? NaN) / 4;
    expect([...packed.slice(at("row0"), at("row0") + 4)]).toEqual([1, 2, 3, 4]);
    expect([...packed.slice(at("row2"), at("row2") + 4)]).toEqual([0, 0, 1, 0]);
    // depths through row 2 are z itself: 0 and 2.5, a metre of margin each side → near −1, far 3.5
    expect([...packed.slice(at("depth"), at("depth") + 2)]).toEqual([1.25, 2.25]);
  });

  it("a pulled depth range holds a plate of the frame's radius at tilt 10, yaws 225, 270, 300, and at tilt 90, at the near end as well as the far (AC-02, surroundings.14)", () => {
    const at = (name: string): number => (VIEW3D_UNIFORM.find((f) => f.name === name)?.offset ?? NaN) / 4;
    const studio: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05, pull: 0.88 };
    const small: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, top: 2.5, bottom: -0.75, pull: 0.88 };
    const cases = [...[225, 270, 300].map((yaw) => ({ yaw, tilt: 10 })), { yaw: 225, tilt: 90 }, { yaw: 300, tilt: 90 }];
    for (const bounds of [studio, small]) {
      for (const angles of cases) {
        const m = camera3d(bounds, angles).matrix;
        const packed = packView3d(m, bounds);
        const [mid = NaN, half = NaN] = packed.slice(at("depth"), at("depth") + 2);
        const [near, far] = [mid - half, mid + half];
        const rf = 1 / Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0); // the frame's radius in metres
        const c = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
        const depths: number[] = [];
        for (const z of [0, bounds.bottom ?? 0]) {
          for (let i = 0; i < 360; i++) {
            const p = { x: c.x + rf * Math.cos((i * Math.PI) / 180), y: c.y + rf * Math.sin((i * Math.PI) / 180), z };
            depths.push((m[8] ?? 0) * p.x + (m[9] ?? 0) * p.y + (m[10] ?? 0) * p.z + (m[11] ?? 0));
          }
        }
        const label = `${JSON.stringify(bounds)} ${JSON.stringify(angles)}: ${near} to ${far}`;
        expect(Math.min(...depths), `near end, ${label}`).toBeGreaterThan(near);
        expect(Math.max(...depths), `far end, ${label}`).toBeLessThan(far);
      }
    }
    // The studio at tilt 10, yaw 270: today −1.63 to 3.56; the plate needs −3.69 to 6.16 (surroundings.13).
    const [mid = NaN, half = NaN] = packView3d(camera3d(studio, { yaw: 270, tilt: 10 }).matrix, studio).slice(at("depth"), at("depth") + 2);
    expect([mid - half < -3.69, mid + half > 6.16]).toEqual([true, true]);
  });

  it("with no pull, the depth range is today's: the box's corners from 0 to the top, a metre each side; a bottom lowers the box", () => {
    const studio: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05 };
    const m = camera3d(studio, { yaw: 270, tilt: 10 }).matrix;
    const at = (VIEW3D_UNIFORM.find((f) => f.name === "depth")?.offset ?? NaN) / 4;
    const [mid = NaN, half = NaN] = packView3d(m, studio).slice(at, at + 2);
    expect([mid - half, mid + half].map((v) => Math.round(v * 100) / 100)).toEqual([-1.63, 3.56]);
    // A bottom alone widens it to the box's lower corners.
    const low: Bounds3 = { ...studio, bottom: -0.75 };
    const [lowMid = NaN, lowHalf = NaN] = packView3d(camera3d(low, { yaw: 270, tilt: 10 }).matrix, low).slice(at, at + 2);
    const lowest = camera3d(low, { yaw: 270, tilt: 10 }).project({ x: 0, y: 2.6, z: -0.75 }).z;
    expect(lowMid + lowHalf - (lowest + 1)).toBeCloseTo(0, 5);
  });

  it("the WGSL struct and the GLSL uniforms follow VIEW3D_UNIFORM", () => {
    const fields = [...(/struct View3d \{([\s\S]*?)\}/.exec(WGSL_FACE3D)?.[1] ?? "").matchAll(/(\w+): vec(\d)f/g)].map((m) => ({ name: m[1], floats: Number(m[2]) }));
    expect(fields).toEqual(VIEW3D_UNIFORM.map(({ name, floats }) => ({ name, floats })));
    for (const f of VIEW3D_UNIFORM) expect(FACE3D_VS).toMatch(new RegExp(`uniform vec${f.floats} ${VIEW3D_GLSL[f.name]};`));
  });

  it("the 3D WGSL uses ENTRY's entry points", () => {
    expect(WGSL_FACE3D).toMatch(new RegExp(`@vertex\\s+fn ${ENTRY.vertex}\\(`));
    expect(WGSL_FACE3D).toMatch(new RegExp(`@fragment\\s+fn ${ENTRY.fragment}\\(`));
  });

  it("vertexLayout3d is face3d's one buffer", () => {
    expect(vertexLayout3d()).toEqual({ arrayStride: 24, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] });
  });
});
