import { describe, expect, it } from "vitest";
import type { Primitive } from "@fm/editor";
import { encodeLayer, readHeader } from "@fm/render";
import { uploadLayer } from "../src/adapters/webgpu/layers";

// WebGPU's upload (webgpu.10, AC-01): one buffer per layer, written whole, and a draw per non-empty kind bound at its
// section's header offset. A fake device records what the renderer asks for.

function fakeDevice() {
  const created: { size: number; usage: number }[] = [];
  const writes: { buffer: number; offset: number; bytes: number }[] = [];
  return {
    created,
    writes,
    device: {
      createBuffer: (d: { size: number; usage: number }): number => {
        created.push(d);
        return created.length - 1;
      },
      queue: { writeBuffer: (buffer: number, offset: number, data: ArrayBuffer): void => void writes.push({ buffer, offset, bytes: data.byteLength }) },
    },
  };
}

const seg: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#111111", cap: "butt" };
const dot: Primitive = { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 3 }, color: "#111111" };

describe("uploadLayer (AC-01)", () => {
  it("writes the whole layer into one buffer and binds each non-empty section at its header offset", () => {
    const data = encodeLayer([seg, seg, dot]);
    const { created, writes, device } = fakeDevice();
    const layer = uploadLayer(device, data, 0x28);
    expect(created).toEqual([{ size: data.byteLength, usage: 0x28 }]);
    expect(writes).toEqual([{ buffer: 0, offset: 0, bytes: data.byteLength }]);
    const { sections } = readHeader(data);
    expect(layer.draws).toEqual([
      { kind: "segment", count: 2, byteOffset: sections.segment.byteOffset },
      { kind: "disc", count: 1, byteOffset: sections.disc.byteOffset },
    ]);
  });

  it("an empty layer gets a buffer and no draws", () => {
    const { device } = fakeDevice();
    expect(uploadLayer(device, encodeLayer([]), 0x28).draws).toEqual([]);
  });
});
