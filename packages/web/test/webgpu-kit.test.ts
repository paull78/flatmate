import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireGpu, type GpuEntry } from "../src/adapters/webgpu/kit";

// The GPU kit's startup (webgpu.10, AC-04): every failure WebGPU can report before the app mounts gives no kit, so the
// switch falls back to WebGL2; a kit's device loss flags it. Fakes stand in for navigator.gpu.

type Fakes = { adapter?: "none" | "ok"; device?: "ok" | "reject"; pipeline?: "ok" | "reject"; format?: string; delayMs?: number };

function fakeGpu(f: Fakes = {}) {
  let resolveLost: (info: unknown) => void = () => {};
  const destroyed = { count: 0 };
  const device = {
    lost: new Promise((done) => {
      resolveLost = done;
    }),
    destroy: () => {
      destroyed.count++;
      resolveLost({ reason: "destroyed" });
    },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipelineAsync: () => (f.pipeline === "reject" ? Promise.reject(new Error("bad WGSL")) : Promise.resolve({})),
  };
  const later = <T,>(value: T): Promise<T> => (f.delayMs ? new Promise((done) => setTimeout(() => done(value), f.delayMs)) : Promise.resolve(value));
  const adapter = { requestDevice: () => (f.device === "reject" ? Promise.reject(new Error("refused")) : later(device)) };
  const gpu = {
    requestAdapter: () => later(f.adapter === "none" ? null : adapter),
    getPreferredCanvasFormat: () => f.format ?? "bgra8unorm",
  } as unknown as GpuEntry;
  return { gpu, device, destroyed };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("acquireGpu (AC-04)", () => {
  it("builds a kit with a pipeline per kind when everything answers", async () => {
    const kit = await acquireGpu(fakeGpu().gpu);
    expect(kit?.lost).toBe(false);
    expect(Object.keys(kit?.pipelines ?? {}).sort()).toEqual(["arc", "disc", "polygon", "segment"]);
  });

  it("gives no kit without navigator.gpu, without an adapter, with a refused device or a failing pipeline", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await acquireGpu(undefined)).toBeNull();
    expect(await acquireGpu(fakeGpu({ adapter: "none" }).gpu)).toBeNull();
    expect(await acquireGpu(fakeGpu({ device: "reject" }).gpu)).toBeNull();
    expect(await acquireGpu(fakeGpu({ pipeline: "reject" }).gpu)).toBeNull();
  });

  it("refuses an sRGB target format", async () => {
    expect(await acquireGpu(fakeGpu({ format: "bgra8unorm-srgb" }).gpu)).toBeNull();
  });

  it("gives no kit after the timeout, and destroys a device that answers later", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeGpu({ delayMs: 5000 });
    const result = acquireGpu(f.gpu, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.destroyed.count).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it("a lost device flags the kit and calls its listeners once", async () => {
    const f = fakeGpu();
    const kit = await acquireGpu(f.gpu);
    if (!kit) throw new Error("no kit");
    let calls = 0;
    kit.onLost.add(() => calls++);
    f.device.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(kit.lost).toBe(true);
    expect(calls).toBe(1);
  });
});
