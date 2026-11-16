import { BLEND, CAMERA_BINDING, ENTRY, KIND_ORDER, SAMPLE_COUNT, TARGET_FORMATS, TOPOLOGY, vertexLayouts, WGSL, type GeometryKind } from "@fm/render";

// WebGPU set up once, before the app mounts (webgpu.05, .10). WebGPU reports most failures asynchronously (a shader
// that doesn't compile, a device lost at birth), while the renderer factories are synchronous, so everything that can
// fail happens here: the adapter, the device, and every pipeline through createRenderPipelineAsync. A kit that exists
// and isn't lost draws; anything else makes the WebGPU factory return null, and the switch moves on to WebGL2.

export type GpuKit = {
  device: GPUDevice;
  format: GPUTextureFormat;
  layout: GPUBindGroupLayout; // one uniform buffer (the camera), seen by both stages
  pipelines: Record<GeometryKind, GPURenderPipeline>;
  lost: boolean;
  /** Called once, when the device is lost; renderers add and remove themselves. */
  onLost: Set<() => void>;
};

/**
 * WebGPU's flag values, from the spec: TypeScript 6's DOM lib declares the WebGPU interfaces but not the
 * GPUShaderStage, GPUBufferUsage and GPUTextureUsage constants (webgpu.18).
 */
export const GPU_FLAGS = {
  stage: { vertex: 0x1, fragment: 0x2 },
  buffer: { copyDst: 0x8, vertex: 0x20, uniform: 0x40 },
  texture: { renderAttachment: 0x10 },
} as const;

const isTargetFormat = (format: string): format is (typeof TARGET_FORMATS)[number] => TARGET_FORMATS.some((f) => f === format);

/** The part of `navigator.gpu` the kit uses: a parameter, so tests pass fakes. */
export type GpuEntry = Pick<GPU, "requestAdapter" | "getPreferredCanvasFormat">;

async function build(gpu: GpuEntry | undefined): Promise<GpuKit | null> {
  if (gpu === undefined) return null;
  const adapter = await gpu.requestAdapter();
  if (adapter === null) return null;
  const device = await adapter.requestDevice();
  const format = gpu.getPreferredCanvasFormat();
  if (!isTargetFormat(format)) return null; // never an sRGB target (TARGET_FORMATS)
  const layout = device.createBindGroupLayout({ entries: [{ binding: CAMERA_BINDING.binding, visibility: GPU_FLAGS.stage.vertex | GPU_FLAGS.stage.fragment, buffer: { type: "uniform" } }] });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const layouts = vertexLayouts();
  const made = await Promise.all(
    KIND_ORDER.map(async (kind) => {
      const module = device.createShaderModule({ code: WGSL[kind] });
      return device.createRenderPipelineAsync({
        layout: pipelineLayout,
        vertex: { module, entryPoint: ENTRY.vertex, buffers: layouts[kind] },
        fragment: { module, entryPoint: ENTRY.fragment, targets: [{ format, blend: BLEND }] },
        primitive: { topology: TOPOLOGY[kind] },
        multisample: { count: SAMPLE_COUNT },
      });
    }),
  );
  const [polygon, segment, arc, disc] = made;
  if (!polygon || !segment || !arc || !disc) return null;
  const kit: GpuKit = { device, format, layout, pipelines: { polygon, segment, arc, disc }, lost: false, onLost: new Set() };
  void device.lost.then(() => {
    kit.lost = true;
    for (const fn of kit.onLost) fn();
  });
  return kit;
}

/**
 * The kit, or null when WebGPU can't draw here: no `navigator.gpu`, no adapter, a refused device, a pipeline that fails,
 * or no answer within `timeoutMs`. A device that answers after the timeout is destroyed, not left running.
 */
export async function acquireGpu(gpu: GpuEntry | undefined = "gpu" in navigator ? navigator.gpu : undefined, timeoutMs = 2000): Promise<GpuKit | null> {
  let timedOut = false;
  const attempt = build(gpu).catch((error: unknown) => {
    console.warn("WebGPU unavailable:", error);
    return null;
  });
  const timeout = new Promise<null>((done) =>
    setTimeout(() => {
      timedOut = true;
      done(null);
    }, timeoutMs),
  );
  void attempt.then((kit) => {
    if (!timedOut || kit === null) return;
    console.warn(`WebGPU answered after ${timeoutMs} ms: not used`);
    kit.device.destroy();
  });
  return Promise.race([attempt, timeout]);
}

/** Under `?perf` only: `window.__fmGpu.lose()` destroys the device, so the e2e can check the fallback (AC-04). */
export function exposeGpuLoss(target: object, kit: GpuKit): void {
  Object.defineProperty(target, "__fmGpu", { value: { lose: () => kit.device.destroy() }, configurable: true });
}
