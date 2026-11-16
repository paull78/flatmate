import { describe, expect, it } from "vitest";
import { CAMERA_BYTES, CAMERA_UNIFORM, CAP_ROUND, CORNER_ATTRIBUTE, ENTRY, KIND_ORDER, LAYOUT, UNIT_PX, WGSL } from "../src/index";

// The WGSL modules (webgpu.11, AC-03) read the same table as the GLSL: vertex inputs from LAYOUT, the camera struct from
// CAMERA_UNIFORM, the unit and cap codes from layout.ts.

/** The vertex entry point's parameters only (inter-stage fields carry `@location` too), as location, size and name. */
function vertexInputs(module: string): { name: string; location: number; floats: number }[] {
  const params = new RegExp(`@vertex\\s+fn\\s+${ENTRY.vertex}\\(([\\s\\S]*?)\\)\\s*->`).exec(module)?.[1] ?? "";
  return [...params.matchAll(/@location\((\d+)\)\s+(\w+):\s*(f32|vec([234])f)\b/g)].map((m) => ({
    name: m[2] ?? "",
    location: Number(m[1]),
    floats: m[3] === "f32" ? 1 : Number(m[4]),
  }));
}

/** `struct Camera { … }` as fields with their WGSL offsets (vec2f: size 8, align 8; f32: size 4, align 4) and size. */
function cameraStruct(module: string): { fields: { name: string; offset: number; floats: number }[]; bytes: number } {
  const body = /struct Camera \{([^}]*)\}/.exec(module)?.[1] ?? "";
  let next = 0;
  let maxAlign = 4;
  const fields = [...body.matchAll(/(\w+):\s*(f32|vec2f)/g)].map((m) => {
    const floats = m[2] === "vec2f" ? 2 : 1;
    const align = 4 * floats;
    maxAlign = Math.max(maxAlign, align);
    const offset = Math.ceil(next / align) * align;
    next = offset + 4 * floats;
    return { name: m[1] ?? "", offset, floats };
  });
  return { fields, bytes: Math.ceil(next / maxAlign) * maxAlign };
}

describe("the WGSL modules (AC-03)", () => {
  it.each(KIND_ORDER)("%s: every WGSL vertex input matches the layout table", (kind) => {
    const layout = LAYOUT[kind];
    const expected = [...(layout.instanced ? [CORNER_ATTRIBUTE] : []), ...layout.attributes].map(({ name, location, floats }) => ({ name, location, floats }));
    const byLocation = (a: { location: number }, b: { location: number }) => a.location - b.location;
    expect(vertexInputs(WGSL[kind]).sort(byLocation)).toEqual(expected.sort(byLocation));
  });

  it.each(KIND_ORDER)("%s: the WGSL camera struct matches CAMERA_UNIFORM", (kind) => {
    const { fields, bytes } = cameraStruct(WGSL[kind]);
    expect(fields).toEqual(CAMERA_UNIFORM.map(({ name, offset, floats }) => ({ name, offset, floats })));
    expect(bytes).toBe(CAMERA_BYTES);
    expect(WGSL[kind]).toMatch(/@group\(0\) @binding\(0\) var<uniform> camera: Camera;/);
  });

  it.each(KIND_ORDER)("%s: the codes come from the table", (kind) => {
    const module = WGSL[kind];
    expect(module).toContain(`const UNIT_PX: f32 = ${UNIT_PX}.0;`);
    expect(module).toContain(`const CAP_ROUND: f32 = ${CAP_ROUND}.0;`);
    expect(module).toMatch(/unit == UNIT_PX\b/);
    // No comparison against a bare number: a unit or cap code is read only through its constant.
    expect(module).not.toMatch(/[=!]=\s*-?\d/);
  });

  it("the segment's cap test reads CAP_ROUND", () => {
    expect(WGSL.segment).toMatch(/== CAP_ROUND\b/);
  });

  it.each(KIND_ORDER)("%s: each module is self-contained", (kind) => {
    const module = WGSL[kind];
    expect(module).not.toContain("${");
    expect(module.match(new RegExp(`@vertex\\s+fn\\s+${ENTRY.vertex}\\(`, "g"))).toHaveLength(1);
    expect(module.match(new RegExp(`@fragment\\s+fn\\s+${ENTRY.fragment}\\(`, "g"))).toHaveLength(1);
    for (const fn of ["toLocal", "toClip", "toPx", "shade"]) expect(module, fn).toMatch(new RegExp(`\\bfn ${fn}\\(`));
    expect(module).not.toMatch(/\bround\b/);
  });
});
