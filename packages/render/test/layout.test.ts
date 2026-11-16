import { describe, expect, it } from "vitest";
import { CAP_BUTT, CAP_ROUND, CORNER_ATTRIBUTE, KIND_ORDER, LAYOUT, POLYGON_VS, QUAD_SLOT, RECORD_SLOT, UNIT_M, UNIT_PX, sdfShaders, vertexLayouts, BLEND, SAMPLE_COUNT, TOPOLOGY, TARGET_FORMATS, QUAD_VERTICES, POLYGON_SLOT, UNIT_QUAD, CAMERA_BINDING, WGSL, type GeometryKind } from "../src/index";

// One layout table (render.14, AC-08): every stride and attribute the shaders read is written once, in LAYOUT.

/** A vertex shader's inputs: `layout(location = N) in vecK name;` (or `float`) as location, size and name. */
function inputs(source: string): { name: string; location: number; floats: number }[] {
  return [...source.matchAll(/layout\(location = (\d+)\) in (float|vec([234])) (\w+);/g)].map((m) => ({
    name: m[4] ?? "",
    location: Number(m[1]),
    floats: m[2] === "float" ? 1 : Number(m[3]),
  }));
}

const VERTEX_SHADERS: Record<GeometryKind, string> = {
  polygon: POLYGON_VS,
  segment: sdfShaders(false).segment.vs,
  arc: sdfShaders(false).arc.vs,
  disc: sdfShaders(false).disc.vs,
};

describe("the layout table (AC-08)", () => {
  it.each(KIND_ORDER)("%s: the shader reads exactly the table's attributes", (kind) => {
    const layout = LAYOUT[kind];
    const expected = [...(layout.instanced ? [CORNER_ATTRIBUTE] : []), ...layout.attributes].map(({ name, location, floats }) => ({ name, location, floats }));
    const byLocation = (a: { location: number }, b: { location: number }) => a.location - b.location;
    expect(inputs(VERTEX_SHADERS[kind]).sort(byLocation)).toEqual(expected.sort(byLocation));
  });

  it("the debug shaders read the same attributes", () => {
    const debug = sdfShaders(true);
    for (const kind of ["segment", "arc", "disc"] as const) expect(inputs(debug[kind].vs)).toEqual(inputs(VERTEX_SHADERS[kind]));
  });

  it.each(KIND_ORDER)("%s: attributes cover the record exactly, in order", (kind) => {
    const { strideFloats, attributes } = LAYOUT[kind];
    let next = 0;
    for (const a of attributes) {
      expect(a.offset, a.name).toBe(next);
      next += a.floats;
    }
    expect(next).toBe(strideFloats);
  });

  it("the unit and cap codes are distinct", () => {
    expect(UNIT_M).not.toBe(UNIT_PX);
    expect(CAP_BUTT).not.toBe(CAP_ROUND);
  });

  it("the shaders read the unit and cap codes from the table", () => {
    expect(sdfShaders(false).segment.vs).toContain(`unit == ${UNIT_PX}.0`);
    expect(sdfShaders(false).segment.fs).toContain(`v_round == ${CAP_ROUND}.0`);
    expect(`${UNIT_PX}.0`).not.toBe(`${UNIT_M}.0`);
  });
});

describe("vertexLayouts (webgpu.11, AC-03)", () => {
  it("gives each kind its slots, stride and offsets", () => {
    const { segment, polygon } = vertexLayouts();
    expect(segment).toHaveLength(2);
    expect(segment[QUAD_SLOT]).toEqual({ arrayStride: 8, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] });
    expect(segment[RECORD_SLOT]).toEqual({
      arrayStride: 52,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 1, offset: 0, format: "float32x4" },
        { shaderLocation: 2, offset: 16, format: "float32x3" },
        { shaderLocation: 3, offset: 28, format: "float32x2" },
        { shaderLocation: 4, offset: 36, format: "float32x4" },
      ],
    });
    expect(polygon).toEqual([{ arrayStride: 24, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }, { shaderLocation: 1, offset: 8, format: "float32x4" }] }]);
  });

  it("returns fresh arrays on every call", () => {
    expect(vertexLayouts().arc).not.toBe(vertexLayouts().arc);
  });
});

describe("the pass facts G4 reads, pinned by value (webgpu.11)", () => {
  it.each(KIND_ORDER)("%s: its vertex buffers follow LAYOUT, by slot", (kind) => {
    const { strideFloats, instanced, attributes } = LAYOUT[kind];
    const records = { arrayStride: 4 * strideFloats, stepMode: instanced ? "instance" : "vertex", attributes: attributes.map((a) => ({ shaderLocation: a.location, offset: 4 * a.offset, format: a.floats === 1 ? "float32" : `float32x${a.floats}` })) };
    const layouts = vertexLayouts()[kind];
    if (instanced) {
      expect(layouts[QUAD_SLOT]).toEqual({ arrayStride: 4 * CORNER_ATTRIBUTE.floats, stepMode: "vertex", attributes: [{ shaderLocation: CORNER_ATTRIBUTE.location, offset: 0, format: "float32x2" }] });
      expect(layouts[RECORD_SLOT]).toEqual(records);
    } else expect(layouts).toEqual([records]);
    expect(TOPOLOGY[kind]).toBe(instanced ? "triangle-strip" : "triangle-list");
  });

  it("four samples, premultiplied blending, non-sRGB targets", () => {
    expect(SAMPLE_COUNT).toBe(4);
    const premultiplied = { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" };
    expect(BLEND).toEqual({ color: premultiplied, alpha: premultiplied });
    expect([...TARGET_FORMATS]).toEqual(["bgra8unorm", "rgba8unorm"]);
  });

  it("the quad, the polygon slot and the camera binding", () => {
    expect(QUAD_VERTICES).toBe(UNIT_QUAD.length / CORNER_ATTRIBUTE.floats);
    expect(QUAD_VERTICES).toBe(4);
    expect(POLYGON_SLOT).toBe(0);
    expect(vertexLayouts().polygon[POLYGON_SLOT]?.stepMode).toBe("vertex");
    for (const code of Object.values(WGSL)) expect(code).toContain(`@group(${CAMERA_BINDING.group}) @binding(${CAMERA_BINDING.binding}) var<uniform> camera`);
  });
});
