import { describe, expect, it } from "vitest";
import { CAMERA_BYTES, CAMERA_GLSL, CAMERA_UNIFORM, POLYGON_VS, packCamera, sdfShaders } from "../src/index";

// The camera uniform is a fact of the render format (webgpu.11): one field order and byte layout for the WGSL struct,
// the GLSL uniforms and every renderer.

describe("the camera uniform", () => {
  it("packCamera puts each field at its offset", () => {
    const packed = packCamera({ center: { x: 1.5, y: -2 }, zoom: 80, viewport: { width: 1200, height: 800 }, dpr: 2 });
    expect(packed.byteLength).toBe(CAMERA_BYTES);
    const at = (name: string): number => (CAMERA_UNIFORM.find((f) => f.name === name)?.offset ?? NaN) / 4;
    expect([packed[at("center")], packed[at("center") + 1]]).toEqual([1.5, -2]);
    expect(packed[at("zoom")]).toBe(80);
    expect(packed[at("dpr")]).toBe(2);
    expect([packed[at("half")], packed[at("half") + 1]]).toEqual([600, 400]);
  });

  it("is laid out as WGSL lays a struct: vec2 fields 8-aligned, the size a multiple of 8", () => {
    let next = 0;
    for (const f of CAMERA_UNIFORM) {
      const align = f.floats === 2 ? 8 : 4;
      expect(f.offset % align, f.name).toBe(0);
      expect(f.offset, f.name).toBeGreaterThanOrEqual(next);
      next = f.offset + 4 * f.floats;
    }
    expect(CAMERA_BYTES % 8).toBe(0);
    expect(next).toBe(CAMERA_BYTES);
  });

  it("names a GLSL uniform for every field, declared in the GLSL with its size", () => {
    expect(CAMERA_GLSL).toEqual({ center: "u_center", zoom: "u_zoom", dpr: "u_dpr", half: "u_half" });
    const glsl = [POLYGON_VS, sdfShaders(false).segment.vs, sdfShaders(false).segment.fs].join("\n");
    for (const f of CAMERA_UNIFORM) expect(glsl, f.name).toMatch(new RegExp(`uniform ${f.floats === 2 ? "vec2" : "float"} ${CAMERA_GLSL[f.name]};`));
  });
});
