import { describe, expect, it } from "vitest";
import { BLEND, vertexLayouts } from "@fm/render";

// @fm/render can't name WebGPU's DOM types (its lib is ES2022): its plain data must still be what WebGPU takes
// (webgpu.11). This file type-checks under the web test config, which has the DOM lib.

describe("the render format's WebGPU data", () => {
  it("is assignable to WebGPU's own types", () => {
    const records: GPUVertexBufferLayout | null | undefined = vertexLayouts().segment[1];
    const blend: GPUBlendState = BLEND;
    expect(records?.arrayStride).toBe(52);
    expect(blend.color.srcFactor).toBe("one");
  });
});
