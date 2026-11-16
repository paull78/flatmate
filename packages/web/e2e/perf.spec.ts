import { test, type Page } from "@playwright/test";
import { canvasOf } from "./support/app-driver";
import { toScreen } from "./support/canvas";
import { SERVER } from "./support/server";

// The G1 measurement (graphics step 02, graphics.08): seven gestures on the 50 × 50 seed grid, each run three times from a
// fresh page, printed as one table of medians; and the parts measurement (parts step 10, parts.06): the Day/Night flip
// in the furnished studio with the 3D panel open. Runs only with FM_PERF=1, which also makes playwright.config.ts seed the
// grid; numbers are recorded, never asserted (timing under load is noise, graphics.03).

test.skip(!process.env.FM_PERF, "run with FM_PERF=1 (seeds the 50 × 50 grid)");
// The machine's GPU (ANGLE on Metal on a Mac), as P1–P3 measured: without these flags headless Chromium renders WebGL
// with SwiftShader, on the CPU, and the WebGL rows measure that instead of the renderer (graphics.16).
test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

const GRID = "Grid 50×50";
const RUNS = 3;
const VIEWPORT = { width: 1400, height: 900 };

type Stats = { avg: number; median: number; max: number; count: number } | null;
type Summary = { update: Stats; draw: Stats; frame: Stats; draw3d: Stats; primitives: number | null };
type Sample = { total: number; summary: Summary; draw3dAfterRelease?: number };

async function summary(page: Page): Promise<Summary> {
  return page.evaluate(() => {
    const hook: unknown = Reflect.get(window, "__fmPerf");
    if (typeof hook !== "object" || hook === null) throw new Error("no __fmPerf: open with ?perf");
    const read: unknown = Reflect.get(hook, "summary");
    if (typeof read !== "function") throw new Error("__fmPerf.summary missing");
    return read();
  });
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook: unknown = Reflect.get(window, "__fmPerf");
    const fn: unknown = typeof hook === "object" && hook !== null ? Reflect.get(hook, "reset") : null;
    if (typeof fn !== "function") throw new Error("__fmPerf.reset missing");
    fn();
  });
}

/** Two animation frames: whatever the last input scheduled has been drawn. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** Opens a seeded project, waiting until it draws more than `drawn` primitives (not the empty canvas). */
async function open(page: Page, renderer: "canvas2d" | "webgl" | "webgpu", view3d: boolean, project = GRID, drawn = 10_000): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/?name=Perf&perf&renderer=${renderer}&server=${encodeURIComponent(SERVER)}`);
  // The seeded project, never a new one: with its row missing, openProject would make it.
  await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.waitForFunction((least) => {
    const hook: unknown = Reflect.get(window, "__fmPerf");
    const read: unknown = typeof hook === "object" && hook !== null ? Reflect.get(hook, "summary") : null;
    return typeof read === "function" && (read().primitives ?? 0) > least;
  }, drawn, { timeout: 120_000 });
  if (view3d) {
    await page.keyboard.press("3");
    await page.keyboard.press("Shift+Digit3"); // split
    await page.waitForFunction(() => {
      const hook: unknown = Reflect.get(window, "__fmPerf");
      const read: unknown = typeof hook === "object" && hook !== null ? Reflect.get(hook, "summary") : null;
      return typeof read === "function" && read().draw3d !== null;
    }, undefined, { timeout: 120_000 });
  }
  await settle(page);
}

async function pans(page: Page, count: number): Promise<Sample> {
  const box = await canvasOf(page).boundingBox();
  if (box === null) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await reset(page);
  const started = Date.now();
  for (let i = 0; i < count; i++) await page.mouse.wheel(0, i % 2 === 0 ? 40 : -40); // stays in view
  await settle(page);
  return { total: Date.now() - started, summary: await summary(page) };
}

/** Zoom steps with Ctrl + wheel, in and out around the same point: every step rebuilds the zoom-keyed layers (tags,
 * objects, deck labels, dimensions), so WebGL re-encodes and uploads them (render AC-10). */
async function zooms(page: Page, count: number): Promise<Sample> {
  const box = await canvasOf(page).boundingBox();
  if (box === null) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await reset(page);
  const started = Date.now();
  await page.keyboard.down("Control");
  for (let i = 0; i < count; i++) await page.mouse.wheel(0, i % 2 === 0 ? -40 : 40);
  await page.keyboard.up("Control");
  await settle(page);
  return { total: Date.now() - started, summary: await summary(page) };
}

/** The joint at (3, 3), where four walls meet, dragged in `moves` steps of 4 px with the Select tool. */
async function jointDrag(page: Page, moves: number): Promise<Sample> {
  await page.keyboard.press("v");
  const at = await toScreen(canvasOf(page), { x: 3, y: 3 });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await settle(page);
  await reset(page);
  const started = Date.now();
  for (let i = 1; i <= moves; i++) await page.mouse.move(at.x + 4 * i, at.y);
  await settle(page);
  const during = await summary(page);
  const total = Date.now() - started;
  await page.mouse.up();
  await settle(page);
  const after = await summary(page);
  return { total, summary: during, draw3dAfterRelease: (after.draw3d?.count ?? 0) - (during.draw3d?.count ?? 0) };
}

type Gesture = { name: string; renderer: "canvas2d" | "webgl" | "webgpu"; view3d: boolean; run: (page: Page) => Promise<Sample> };

const GESTURES: Gesture[] = [
  { name: "Canvas2D, 3D closed, 150 pans", renderer: "canvas2d", view3d: false, run: (p) => pans(p, 150) },
  { name: "Canvas2D, 3D split, 20 pans", renderer: "canvas2d", view3d: true, run: (p) => pans(p, 20) },
  { name: "Canvas2D, 3D split, 20-move joint drag", renderer: "canvas2d", view3d: true, run: (p) => jointDrag(p, 20) },
  { name: "WebGL, 3D closed, 150 pans", renderer: "webgl", view3d: false, run: (p) => pans(p, 150) },
  { name: "WebGL, 3D closed, 40 zooms", renderer: "webgl", view3d: false, run: (p) => zooms(p, 40) },
  { name: "WebGPU, 3D closed, 150 pans", renderer: "webgpu", view3d: false, run: (p) => pans(p, 150) },
  { name: "WebGPU, 3D closed, 40 zooms", renderer: "webgpu", view3d: false, run: (p) => zooms(p, 40) },
];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const med = (samples: Sample[], pick: (s: Sample) => number | null | undefined): string => {
  const xs = samples.map(pick).filter((x): x is number => typeof x === "number");
  return xs.length === 0 ? "–" : median(xs).toFixed(1);
};

test("G1 measurement on the 50 × 50 grid", async ({ browser }) => {
  test.setTimeout(30 * 60_000); // the 3D runs repaint about a second per event before G1 (graphics.07)
  const rows: string[] = [
    "| Gesture | total ms | update avg | update max | draw avg | draws | frame avg | frame max | 3D avg | 3D draws | 3D after release |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const g of GESTURES) {
    const samples: Sample[] = [];
    for (let run = 0; run < RUNS; run++) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await open(page, g.renderer, g.view3d);
      samples.push(await g.run(page));
      await context.close();
    }
    rows.push(
      `| ${g.name} | ${med(samples, (s) => s.total)} | ${med(samples, (s) => s.summary.update?.avg)} | ${med(samples, (s) => s.summary.update?.max)} | ` +
        `${med(samples, (s) => s.summary.draw?.avg)} | ${med(samples, (s) => s.summary.draw?.count)} | ${med(samples, (s) => s.summary.frame?.avg)} | ` +
        `${med(samples, (s) => s.summary.frame?.max)} | ${med(samples, (s) => s.summary.draw3d?.avg)} | ${med(samples, (s) => s.summary.draw3d?.count ?? (g.view3d ? 0 : null))} | ` +
        `${med(samples, (s) => s.draw3dAfterRelease)} |`,
    );
  }
  const probe = await browser.newPage();
  const gpu = await probe.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "no webgl2";
  });
  await probe.close();
  console.log(`\nG1 measurement, ${new Date().toISOString()}, ${RUNS} runs, medians, WebGL on ${gpu}\n${rows.join("\n")}\n`);
});

const STUDIO = "Studio";
const FLIPS = 4;
const FLIP_WAIT_MS = 700; // the flip lasts FLIP_MS = 500 (layout-states.ts)

/** Night, then Day, FLIPS times with the 3D panel in split: every tween frame repaints the 3D view (parts.06). */
async function flips(page: Page): Promise<Sample> {
  const pill = page.locator('[data-testid="state-pill"] button[data-state-id]');
  await reset(page);
  const started = Date.now();
  for (let i = 0; i < FLIPS; i++) {
    await pill.last().click();
    await page.waitForTimeout(FLIP_WAIT_MS);
    await pill.first().click();
    await page.waitForTimeout(FLIP_WAIT_MS);
  }
  await settle(page);
  return { total: Date.now() - started, summary: await summary(page) };
}

test("parts measurement: the Day/Night flip in the furnished studio, 3D split (parts AC-09)", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const samples: Sample[] = [];
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await open(page, "canvas2d", true, STUDIO, 200);
    samples.push(await flips(page));
    await context.close();
  }
  const probe = await browser.newPage();
  const gpu = await probe.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "no webgl2";
  });
  await probe.close();
  // Recorded, not asserted (graphics.03): the budget, a 3D avg of at most 8 ms, is checked at the gate (parts.06).
  console.log(`\nParts measurement, ${new Date().toISOString()}, ${RUNS} runs, medians, WebGL on ${gpu}: ${FLIPS * 2} flips, 3D avg ${med(samples, (s) => s.summary.draw3d?.avg)} ms, ` +
    `3D max ${med(samples, (s) => s.summary.draw3d?.max)} ms, 3D draws ${med(samples, (s) => s.summary.draw3d?.count)}, update avg ${med(samples, (s) => s.summary.update?.avg)} ms\n`);
});

const ORBIT_STEPS = 20;

/** A 20-step orbit drag in the 3D panel, a frame waited out between steps (real3d.07, AC-11): every step redraws 3D. */
async function orbit(page: Page): Promise<Sample> {
  const host = page.getByTestId("view3d");
  const box = await host.boundingBox();
  if (box === null) throw new Error("no 3D host");
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await reset(page);
  const started = Date.now();
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= ORBIT_STEPS; i++) {
    await page.mouse.move(x + 6 * i, y + 2 * i); // 2.4° of yaw and 0.8° of tilt a step
    await settle(page);
  }
  await page.mouse.up();
  await settle(page);
  return { total: Date.now() - started, summary: await summary(page) };
}

test("real3d measurement: a 20-step orbit with the 3D panel in split, in the studio and on the grid (real3d AC-11)", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const rows: string[] = [];
  for (const [name, project, drawn] of [["studio", STUDIO, 200], ["grid", GRID, 10_000]] as const) {
    const samples: Sample[] = [];
    for (let run = 0; run < RUNS; run++) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await open(page, "canvas2d", true, project, drawn);
      samples.push(await orbit(page));
      await context.close();
    }
    rows.push(`${name}: 3D median ${med(samples, (s) => s.summary.draw3d?.median)} ms, avg ${med(samples, (s) => s.summary.draw3d?.avg)} ms, max ${med(samples, (s) => s.summary.draw3d?.max)} ms, draws ${med(samples, (s) => s.summary.draw3d?.count)}`);
  }
  const probe = await browser.newPage();
  const gpu = await probe.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "no webgl2";
  });
  await probe.close();
  // Recorded, not asserted (graphics.03): AC-11's 16 ms median is checked at the gate.
  console.log(`\nreal3d orbit measurement, ${new Date().toISOString()}, ${RUNS} runs, medians, WebGL on ${gpu}\n${rows.join("\n")}\n`);
});
