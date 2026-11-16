import { KIND_ORDER, readHeader, type GeometryKind } from "@fm/render";

// WebGPU's half of the layer cache (webgpu.10, .14): a layer's encoder buffer uploaded whole as one vertex buffer, and
// one draw per non-empty kind that binds its section by the header's offset. The rev contract and the texts live in
// gpu-layers.ts. Generic over the buffer type, so a fake device can count what is written.

/** One draw: `count` instances, or vertices for polygons, from the section at `byteOffset` of the layer's buffer. */
export type GpuDraw = { kind: GeometryKind; count: number; byteOffset: number };
export type GpuLayer<B> = { buffer: B; draws: GpuDraw[] };
/** The device calls an upload makes. */
export type UploadDevice<B> = { createBuffer(descriptor: { size: number; usage: number }): B; queue: { writeBuffer(buffer: B, offset: number, data: ArrayBuffer): void } };

/** Uploads a layer's whole buffer once (`usage`: VERTEX | COPY_DST) and lists a draw per non-empty kind, in KIND_ORDER. */
export function uploadLayer<B>(device: UploadDevice<B>, data: ArrayBuffer, usage: number): GpuLayer<B> {
  const { sections } = readHeader(data);
  const buffer = device.createBuffer({ size: data.byteLength, usage });
  device.queue.writeBuffer(buffer, 0, data);
  const draws = KIND_ORDER.flatMap((kind): GpuDraw[] => (sections[kind].count === 0 ? [] : [{ kind, count: sections[kind].count, byteOffset: sections[kind].byteOffset }]));
  return { buffer, draws };
}

export function freeLayer<B extends { destroy(): void }>(layer: GpuLayer<B>): void {
  layer.buffer.destroy();
}
