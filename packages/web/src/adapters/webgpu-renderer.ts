import { colorChannels, COLORS, type Camera, type Scene } from "@fm/editor";
import { CAMERA_BINDING, CAMERA_BYTES, LAYOUT, packCamera, POLYGON_SLOT, QUAD_SLOT, QUAD_VERTICES, RECORD_SLOT, SAMPLE_COUNT, UNIT_QUAD } from "@fm/render";
import { backingSize, drawTextOverlay, fitCanvas } from "./canvas2d-renderer";
import { createLayerCache } from "./gpu-layers";
import type { OnFrame, Renderer } from "./renderer";
import { GPU_FLAGS, type GpuKit } from "./webgpu/kit";
import { freeLayer, uploadLayer, type GpuLayer } from "./webgpu/layers";

// The WebGPU plan renderer (webgpu.10, spec: rendering): @fm/render's buffers drawn by the WGSL pipelines the kit built at
// startup, the same layers and kinds in the same order as WebGL, MSAA ×4 resolved to the canvas, text on the Canvas2D
// overlay above. It draws on a canvas of its own, inserted beside the shared GL canvas and removed on dispose: a canvas
// keeps one context mode, so WebGL2 could never open the shared one after WebGPU had (webgpu.08). The underlay is
// Canvas2D's only, as under WebGL.

const background = colorChannels(COLORS.background);

/**
 * The WebGPU renderer, or null without a kit, after its device was lost, or without a 2D overlay context. `onLost`
 * runs when the device is lost (a later microtask, never during creation); the switch then falls back to WebGL2.
 * Draws at most once per animation frame, the latest scene winning. Under `?perf` a frame is timed once the GPU has
 * finished it (`onSubmittedWorkDone`: WebGPU has no `gl.finish()`).
 */
export function createWebGPURenderer(glCanvas: HTMLCanvasElement, overlay: HTMLCanvasElement, kit: GpuKit | null, onLost: () => void, options: { onFrame?: OnFrame }): Renderer | null {
  if (kit === null || kit.lost) return null;
  const text = overlay.getContext("2d");
  if (text === null) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "gl-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.testid = "gpu-canvas";
  glCanvas.after(canvas); // under the overlay, like the GL canvas
  const context = canvas.getContext("webgpu"); // TS 6 types it as RenderingContext: narrowed below
  if (!(context instanceof GPUCanvasContext)) {
    canvas.remove();
    return null;
  }
  const { device } = kit;
  context.configure({ device, format: kit.format, alphaMode: "opaque" });
  const uniforms = device.createBuffer({ size: CAMERA_BYTES, usage: GPU_FLAGS.buffer.uniform | GPU_FLAGS.buffer.copyDst });
  const bindGroup = device.createBindGroup({ layout: kit.layout, entries: [{ binding: CAMERA_BINDING.binding, resource: { buffer: uniforms } }] });
  const quad = device.createBuffer({ size: 4 * UNIT_QUAD.length, usage: GPU_FLAGS.buffer.vertex | GPU_FLAGS.buffer.copyDst });
  device.queue.writeBuffer(quad, 0, new Float32Array(UNIT_QUAD));
  const usage = GPU_FLAGS.buffer.vertex | GPU_FLAGS.buffer.copyDst;
  const layers = createLayerCache<GpuLayer<GPUBuffer>>({ upload: (data) => uploadLayer(device, data, usage), free: freeLayer });
  let msaa: GPUTexture | null = null;
  let pending: { scene: Scene; camera: Camera } | null = null;
  let frame: number | null = null;
  let lost = false;

  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };
  const onDeviceLost = (): void => {
    if (lost) return;
    lost = true;
    cancel();
    onLost();
  };
  kit.onLost.add(onDeviceLost);

  /** The multisampled colour target, recreated when the canvas's backing size changes. */
  const target = (width: number, height: number): GPUTexture => {
    if (msaa?.width !== width || msaa.height !== height) {
      msaa?.destroy();
      msaa = device.createTexture({ size: [width, height], format: kit.format, sampleCount: SAMPLE_COUNT, usage: GPU_FLAGS.texture.renderAttachment });
    }
    return msaa;
  };

  const draw = (): void => {
    frame = null;
    if (pending === null || lost) return;
    const { scene, camera } = pending;
    pending = null;
    const started = performance.now();
    const synced = layers.sync(scene);
    const size = backingSize(camera);
    fitCanvas(canvas, size);
    fitCanvas(overlay, size);
    device.queue.writeBuffer(uniforms, 0, packCamera(camera));
    const commands = device.createCommandEncoder();
    const [r, g, b] = background;
    const pass = commands.beginRenderPass({
      colorAttachments: [{ view: target(size.width, size.height).createView(), resolveTarget: context.getCurrentTexture().createView(), clearValue: { r, g, b, a: 1 }, loadOp: "clear", storeOp: "discard" }],
    });
    pass.setBindGroup(CAMERA_BINDING.group, bindGroup);
    for (const layer of synced.layers) {
      for (const d of layer.draws) {
        pass.setPipeline(kit.pipelines[d.kind]);
        if (LAYOUT[d.kind].instanced) {
          pass.setVertexBuffer(QUAD_SLOT, quad);
          pass.setVertexBuffer(RECORD_SLOT, layer.buffer, d.byteOffset);
          pass.draw(QUAD_VERTICES, d.count);
        } else {
          pass.setVertexBuffer(POLYGON_SLOT, layer.buffer, d.byteOffset);
          pass.draw(d.count);
        }
      }
    }
    pass.end();
    device.queue.submit([commands.finish()]);
    drawTextOverlay(text, synced.texts, camera);
    const timed = options.onFrame;
    if (timed) {
      void device.queue.onSubmittedWorkDone().then(() => {
        if (!lost) timed(performance.now() - started, scene);
      });
    }
  };

  return {
    render(scene, camera) {
      if (lost) return;
      pending = { scene, camera };
      if (frame === null) frame = requestAnimationFrame(draw);
    },
    dispose() {
      lost = true; // a render() after dispose draws nothing
      cancel();
      kit.onLost.delete(onDeviceLost);
      if (!kit.lost) {
        layers.dispose();
        uniforms.destroy();
        quad.destroy();
        msaa?.destroy();
        context.unconfigure();
      }
      canvas.remove();
    },
  };
}
