import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRoomWithDivider } from "./support/canvas";
import { canvasOf, drawSampleApartment, openProject } from "./support/app-driver";
import { expectPixel } from "./support/pixels";
import { SERVER } from "./support/server";

// WebGPU on the machine's GPU (cycle webgpu, spec: rendering; webgpu.10, .17): the plan drawn by WebGPU, every WGSL module
// compiled, WebGPU's pixels against WebGL's, the 3D WGSL drawn, and a lost device falling back to WebGL2. Headless
// Chromium has a WebGPU adapter only with these flags (webgpu.04), and WebGL then runs on the GPU too, not SwiftShader,
// so the pixel comparisons mean something. Skipped, with the reason, where no adapter answers.
test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

/** Vite serves workspace sources at /@fs/<absolute path>: the page imports the app's own modules and @fm/render. */
const fs = (relative: string): string => `/@fs${fileURLToPath(new URL(relative, import.meta.url))}`;
const RENDER = fs("../../render/src/index.ts");
const WEBGL = fs("../src/adapters/webgl-renderer.ts");
const WEBGPU = fs("../src/adapters/webgpu-renderer.ts");
const KIT = fs("../src/adapters/webgpu/kit.ts");
const WALL = { x: 1.5, y: 0 }; // bottom wall of drawRoomWithDivider's room

test.beforeEach(async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const adapter = await page.evaluate(async () => "gpu" in navigator && (await navigator.gpu.requestAdapter()) !== null);
  test.skip(!adapter, "no WebGPU adapter here: run on a machine with a GPU (the launch flags are in this file)");
});

/** Share of pixels that differ by more than `threshold` in any channel between two PNG screenshots of one size. */
async function differing(page: Page, a: Buffer, b: Buffer, threshold = 16): Promise<number> {
  return page.evaluate(
    async ([pa, pb, t]) => {
      const pixels = async (base64: string): Promise<ImageData> => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
        if (ctx === null) throw new Error("no 2D context");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height);
      };
      const [x, y] = [await pixels(pa), await pixels(pb)];
      if (x.width !== y.width || x.height !== y.height) throw new Error("sizes differ");
      let off = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        if ([0, 1, 2].some((c) => Math.abs((x.data[i + c] ?? 0) - (y.data[i + c] ?? 0)) > t)) off++;
      }
      return off / (x.width * x.height);
    },
    [a.toString("base64"), b.toString("base64"), threshold] as const,
  );
}

test("?renderer=webgpu draws the plan with WebGPU on its own canvas (AC-01)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=webgpu");
  await expect(canvasOf(page)).toBeVisible();
  await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGPU");
  await expect(page.getByTestId("renderer-notice")).toHaveCount(0);
  await expect(page.getByTestId("gpu-canvas")).toHaveCount(1);
  await drawRoomWithDivider(page, canvasOf(page));
  await expectPixel(page, canvasOf(page), WALL, COLORS.wall);
});

test("every WGSL module compiles on the device with no errors (AC-03)", async ({ page }) => {
  const errors = await page.evaluate(async (renderUrl) => {
    const render = (await import(renderUrl)) as typeof import("../../render/src/index");
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error("no device");
    const modules = { ...render.WGSL, face3d: render.WGSL_FACE3D };
    const out: string[] = [];
    for (const [name, code] of Object.entries(modules)) {
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      for (const m of info.messages) if (m.type === "error") out.push(`${name}: ${m.message}`);
    }
    return out;
  }, RENDER);
  expect(errors).toEqual([]);
});

test("WebGPU draws a fixture layer as WebGL does, every kind and feature (AC-02, webgpu.17)", async ({ page }) => {
  for (const dpr of [1, 2]) {
    await page.evaluate(
      async ([renderUrl, webglUrl, webgpuUrl, kitUrl, ratio]) => {
        const render = (await import(renderUrl)) as typeof import("../../render/src/index");
        const { createWebGLRenderer } = (await import(webglUrl)) as typeof import("../src/adapters/webgl-renderer");
        const { createWebGPURenderer } = (await import(webgpuUrl)) as typeof import("../src/adapters/webgpu-renderer");
        const { acquireGpu } = (await import(kitUrl)) as typeof import("../src/adapters/webgpu/kit");
        void render;
        type P = import("@fm/editor").Primitive;
        const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
        const fixture: P[] = [
          { kind: "polygon", points: sq(0, 0, 2), holes: [sq(0.5, 0.5, 1)], color: "#2563eb99" },
          { kind: "segment", a: { x: 2.5, y: 0.2 }, b: { x: 5, y: 0.2 }, width: { m: 0.12 }, color: "#1d1d1f", cap: "butt" },
          { kind: "segment", a: { x: 2.5, y: 0.6 }, b: { x: 5, y: 0.6 }, width: { px: 3 }, color: "#e5484d", cap: "round" },
          { kind: "segment", a: { x: 2.5, y: 1 }, b: { x: 5, y: 1 }, width: { px: 1.5 }, color: "#0f766e", cap: "butt", dash: [6, 4] },
          { kind: "segment", a: { x: 2.5, y: 1.4 }, b: { x: 5, y: 1.9 }, width: { m: 0.05 }, color: "#d97706cc", cap: "round", dash: [10, 3] },
          { kind: "arc", center: { x: 1, y: 3 }, radius: 0.6, from: 0, to: 1.2, width: { px: 2 }, color: "#1d1d1f" },
          { kind: "arc", center: { x: 2.6, y: 3 }, radius: 0.6, from: 0.3, to: 4.4, width: { m: 0.04 }, color: "#2563eb" },
          { kind: "arc", center: { x: 4.2, y: 3 }, radius: 0.6, from: 0, to: 2 * Math.PI, width: { px: 1 }, color: "#5c5347" },
          { kind: "disc", center: { x: 0.5, y: 4.2 }, radius: { px: 6 }, color: "#1d4ed8" },
          { kind: "disc", center: { x: 2, y: 4.2 }, radius: { m: 0.3 }, color: "#e5484d88" },
        ];
        const names = ["grid", "ghosts", "finishes", "zoneFills", "decks", "objects", "overheads", "warnings", "walls", "openings", "deckLabels", "tags", "dimensions", "annotations", "overlays", "presence"] as const;
        const scene = { layers: names.map((name) => ({ name, primitives: name === "walls" ? fixture : [] })), underlay: null };
        const camera = { center: { x: 2.6, y: 2.2 }, zoom: 70, viewport: { width: 420, height: 380 }, dpr: ratio };
        document.querySelectorAll(".fixture-host").forEach((h) => h.remove());
        if (!document.getElementById("fixture-style")) {
          // Every canvas in a host fills it, the WebGPU renderer's own included, as `.canvas-host > canvas` does in the app.
          const style = document.createElement("style");
          style.id = "fixture-style";
          style.textContent = ".fixture-host > canvas { position: absolute; inset: 0; width: 100%; height: 100%; }";
          document.head.append(style);
        }
        const host = (id: string, left: number) => {
          const div = document.createElement("div");
          div.className = "fixture-host";
          div.dataset.testid = id;
          div.style.cssText = `position:fixed;left:${left}px;top:0;width:420px;height:380px;z-index:1000;background:#fff`;
          const gl = document.createElement("canvas");
          const overlay = document.createElement("canvas");
          div.append(gl, overlay);
          document.body.append(div);
          return { gl, overlay };
        };
        const a = host("fixture-webgl", 0);
        const b = host("fixture-webgpu", 440);
        const webgl = createWebGLRenderer(a.gl, a.overlay, () => {}, { sdfDebug: false });
        const kit = await acquireGpu();
        const webgpu = createWebGPURenderer(b.gl, b.overlay, kit, () => {}, {});
        if (!webgl || !webgpu) throw new Error(`renderers: webgl ${String(webgl !== null)}, webgpu ${String(webgpu !== null)}`);
        webgl.render(scene, camera);
        webgpu.render(scene, camera);
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        await kit?.device.queue.onSubmittedWorkDone();
      },
      [RENDER, WEBGL, WEBGPU, KIT, dpr] as const,
    );
    const shotGl = await page.getByTestId("fixture-webgl").screenshot();
    const shotGpu = await page.getByTestId("fixture-webgpu").screenshot();
    expect(await differing(page, shotGl, shotGpu, 16), `dpr ${dpr}`).toBe(0);
  }
});

test("the 3D WGSL draws: depths in WebGPU's range, the nearer face, edges in their colour (webgpu.17)", async ({ page }) => {
  const seen = await page.evaluate(async (renderUrl) => {
    const render = (await import(renderUrl)) as typeof import("../../render/src/index");
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error("no device");
    const size = 64;
    const module = device.createShaderModule({ code: render.WGSL_FACE3D });
    const pipeline = (topology: GPUPrimitiveTopology) =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: render.ENTRY.vertex, buffers: [render.vertexLayout3d()] },
        fragment: { module, entryPoint: render.ENTRY.fragment, targets: [{ format: "rgba8unorm" }] },
        primitive: { topology },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
      });
    const fills = pipeline("triangle-list");
    const lines = pipeline("line-list");
    // Identity rows, depth centre 0 and half range 1: the GLSL's clip z is the vertex z (−1..1).
    const uniform = new Float32Array(render.VIEW3D_BYTES / 4);
    const at = (name: string) => (render.VIEW3D_UNIFORM.find((f) => f.name === name)?.offset ?? 0) / 4;
    uniform.set([1, 0, 0, 0], at("row0"));
    uniform.set([0, 1, 0, 0], at("row1"));
    uniform.set([0, 0, 1, 0], at("row2"));
    uniform.set([0, 1], at("depth"));
    const ubo = device.createBuffer({ size: uniform.byteLength, usage: 0x40 | 0x8 });
    device.queue.writeBuffer(ubo, 0, uniform);
    const tri = (cx: number, cy: number, z: number, rgb: number[]): number[] => [cx - 0.15, cy - 0.15, z, ...rgb, cx + 0.15, cy - 0.15, z, ...rgb, cx, cy + 0.15, z, ...rgb];
    const fill = new Float32Array([
      ...tri(-0.6, 0.5, -0.999, [1, 0, 0]), // near end: visible
      ...tri(0, 0.5, 0.999, [0, 1, 0]), // far end: visible
      ...tri(0.6, 0.5, 1.01, [0, 0, 1]), // beyond far: clipped
      ...tri(0, -0.4, 0.3, [1, 1, 0]), // two overlapping: the nearer (−0.3, magenta) wins
      ...tri(0, -0.4, -0.3, [1, 0, 1]),
    ]);
    const edge = new Float32Array([-0.9, -0.85, 0, 1, 0.5, 0, 0.9, -0.85, 0, 1, 0.5, 0]); // an edge in its vertex colour
    const vb = (data: Float32Array) => {
      const b = device.createBuffer({ size: data.byteLength, usage: 0x20 | 0x8 });
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    const color = device.createTexture({ size: [size, size], format: "rgba8unorm", usage: 0x10 | 0x1 });
    const depth = device.createTexture({ size: [size, size], format: "depth24plus", usage: 0x10 });
    const commands = device.createCommandEncoder();
    const pass = commands.beginRenderPass({
      colorAttachments: [{ view: color.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    for (const [p, data, count] of [[fills, fill, fill.length / 6], [lines, edge, 2]] as const) {
      pass.setPipeline(p);
      pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] }));
      pass.setVertexBuffer(0, vb(data));
      pass.draw(count);
    }
    pass.end();
    const read = device.createBuffer({ size: size * size * 4, usage: 0x1 | 0x8 });
    commands.copyTextureToBuffer({ texture: color }, { buffer: read, bytesPerRow: size * 4 }, [size, size]);
    device.queue.submit([commands.finish()]);
    await read.mapAsync(0x1);
    const px = new Uint8Array(read.getMappedRange());
    const pixel = (x: number, y: number): number[] => {
      const col = Math.round(((x + 1) / 2) * size);
      const row = Math.round(((1 - y) / 2) * size);
      const i = 4 * (row * size + col);
      return [px[i] ?? -1, px[i + 1] ?? -1, px[i + 2] ?? -1];
    };
    return { near: pixel(-0.6, 0.48), far: pixel(0, 0.48), beyond: pixel(0.6, 0.48), overlap: pixel(0, -0.42), edge: pixel(0, -0.85) };
  }, RENDER);
  expect(seen).toEqual({ near: [255, 0, 0], far: [0, 255, 0], beyond: [0, 0, 0], overlap: [255, 0, 255], edge: [255, 128, 0] });
});

test("the WebGPU plan matches WebGL's on the sample apartment (AC-02)", async ({ browser }) => {
  const project = `WebGPU parity ${Date.now()}`;
  const viewport = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  // Drawn once, then closed: the two pages compared open the same drawing fresh, with no tool state and no other cursor.
  const drawing = await browser.newContext(viewport);
  const author = await drawing.newPage();
  await author.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await openProject(author, project);
  await drawSampleApartment(author);
  await drawing.close();
  const shots: Buffer[] = [];
  let compare: Page | null = null;
  for (const renderer of ["webgpu", "webgl"] as const) {
    const context = await browser.newContext(viewport);
    const page = await context.newPage();
    await page.goto(`/?name=Bob&renderer=${renderer}&server=${encodeURIComponent(SERVER)}`);
    // The existing project, never a namesake: with its row missing, openProject makes one (graphics.12).
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 30_000 });
    await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
    await expect(page.locator('[data-action="renderer"]')).toHaveText(renderer === "webgpu" ? "WebGPU" : "WebGL");
    await page.waitForTimeout(500);
    shots.push(await page.getByTestId("canvas").screenshot());
    compare = page;
  }
  const [gpu, gl] = shots;
  if (!compare || !gpu || !gl) throw new Error("no screenshots");
  expect(await differing(compare, gpu, gl, 16)).toBeLessThanOrEqual(0.01);
});

test("a lost device falls back to WebGL2 on a fresh canvas, and stays there (AC-04)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=webgpu&perf");
  await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGPU");
  await drawRoomWithDivider(page, canvasOf(page));
  await page.evaluate(() => {
    const hook: unknown = Reflect.get(window, "__fmGpu");
    const lose: unknown = typeof hook === "object" && hook !== null ? Reflect.get(hook, "lose") : null;
    if (typeof lose !== "function") throw new Error("no __fmGpu.lose under ?perf");
    lose();
  });
  await expect(page.getByTestId("renderer-notice")).toHaveText("WebGPU device lost: drawing with WebGL2");
  await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGL");
  await expect(page.getByTestId("gpu-canvas")).toHaveCount(0);
  await expectPixel(page, canvasOf(page), WALL, COLORS.wall);
  const toggle = page.locator('[data-action="renderer"]');
  await toggle.click();
  await expect(toggle).toHaveText("Canvas2D");
  await toggle.click();
  await expect(toggle).toHaveText("WebGL");
});

for (const renderer of ["webgpu", "webgl"] as const) test(`${renderer} redraws through resizes, height only and both (gate M2: the MSAA target follows the canvas)`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
  await expect(page.locator('[data-action="renderer"]')).toHaveText(renderer === "webgpu" ? "WebGPU" : "WebGL"); // mounted: the kit and the font are in
  await drawRoomWithDivider(page, canvasOf(page));
  await expectPixel(page, canvasOf(page), WALL, COLORS.wall);
  await page.setViewportSize({ width: 1280, height: 620 }); // height only
  await expectPixel(page, canvasOf(page), WALL, COLORS.wall);
  await page.setViewportSize({ width: 1100, height: 900 }); // both
  await expectPixel(page, canvasOf(page), WALL, COLORS.wall);
});

test("text draws on the overlay above the WebGPU canvas (gate M2)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=webgpu");
  await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGPU");
  await drawRoomWithDivider(page, canvasOf(page));
  await page.keyboard.press("z");
  await clickAt(page, canvasOf(page), { x: 1.5, y: 2 }); // labels the left room: its tag is overlay text
  await page.keyboard.press("v");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const host = page.locator(".canvas-host");
  const withText = await host.screenshot();
  await page.addStyleTag({ content: '[data-testid="canvas"] { visibility: hidden !important; }' });
  const withoutOverlay = await host.screenshot();
  // The room's tag is text on the overlay; hiding the overlay must change pixels, and the WebGPU canvas must not cover
  // them (it sits under the overlay).
  expect(await differing(page, withText, withoutOverlay, 16)).toBeGreaterThan(0);
});

test("toggling keeps one WebGPU canvas, and ?perf names WebGPU's draw (gate M2)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=webgpu&perf");
  const toggle = page.locator('[data-action="renderer"]');
  for (let i = 0; i < 3; i++) {
    await toggle.click();
    await expect(toggle).toHaveText("Canvas2D");
    await expect(page.getByTestId("gpu-canvas")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveText("WebGPU");
    await expect(page.getByTestId("gpu-canvas")).toHaveCount(1);
  }
  await drawRoomWithDivider(page, canvasOf(page));
  await expect(page.getByTestId("perf")).toContainText(/draw \(WebGPU, waits for the GPU\) \d/);
});

test("the device-loss hook exists only under ?perf (gate M2)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=webgpu");
  await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGPU");
  expect(await page.evaluate(() => Reflect.has(window, "__fmGpu"))).toBe(false);
});
