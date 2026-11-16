import { test, type Page } from "@playwright/test";
import { canvasOf } from "./support/app-driver";
import { toScreen, type WorldPoint } from "./support/canvas";
import { SERVER } from "./support/server";

// The speed check on the seeded studio (finishes AC-15): a piece dragged along a person's path for about two seconds,
// and the Day/Night flip, each in Canvas2D and WebGL with the 3D panel in split, three fresh pages each, printed as
// medians. Run on this branch and on a worktree of the cycle's base (whose studio has no labels or finishes) to compare.
// Runs only with FM_PERF=1; numbers are recorded, never asserted (timing under load is noise, graphics.03).

test.skip(!process.env.FM_PERF, "run with FM_PERF=1");
// The machine's GPU (ANGLE on Metal on a Mac): without these flags headless Chromium renders WebGL with SwiftShader, on
// the CPU (graphics.16).
test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

const STUDIO = "Studio";
const RUNS = 3;
const VIEWPORT = { width: 1400, height: 900 };
const DRAG_MOVES = 120; // one move a frame: about two seconds, and the meter keeps 120 samples
const FLIPS = 4; // Night then Day, four times
const FLIP_WAIT_MS = 700; // the flip lasts FLIP_MS = 500 (layout-states.ts)
// The west dining chair, by Day, as the seed places it: on its backrest (x 5.05–5.15), the part outside the table it is tucked under.
const CHAIR: WorldPoint = { x: 5.1, y: 2 };

type Stats = { avg: number; median: number; max: number; count: number } | null;
type Summary = { update: Stats; draw: Stats; frame: Stats; draw3d: Stats; primitives: number | null };

async function summary(page: Page): Promise<Summary> {
  return page.evaluate(() => {
    const perf: unknown = Reflect.get(window, "__fmPerf");
    const read: unknown = typeof perf === "object" && perf !== null ? Reflect.get(perf, "summary") : null;
    if (typeof read !== "function") throw new Error("__fmPerf.summary missing: open with ?perf");
    return read();
  });
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf: unknown = Reflect.get(window, "__fmPerf");
    const fn: unknown = typeof perf === "object" && perf !== null ? Reflect.get(perf, "reset") : null;
    if (typeof fn !== "function") throw new Error("__fmPerf.reset missing: open with ?perf");
    fn();
  });
}

/** One animation frame: whatever the last input scheduled has been drawn. */
async function frame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
}

async function settle(page: Page): Promise<void> {
  await frame(page);
  await frame(page);
}

/** Opens the seeded studio with the 3D panel in split, once both views have drawn. */
async function open(page: Page, renderer: "canvas2d" | "webgl"): Promise<void> {
  await page.goto(`/?name=Perf&perf&renderer=${renderer}&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: STUDIO, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.waitForFunction(() => {
    const perf: unknown = Reflect.get(window, "__fmPerf");
    const read: unknown = typeof perf === "object" && perf !== null ? Reflect.get(perf, "summary") : null;
    return typeof read === "function" && (read().primitives ?? 0) > 200;
  }, undefined, { timeout: 120_000 });
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3"); // split
  await page.waitForFunction(() => {
    const perf: unknown = Reflect.get(window, "__fmPerf");
    const read: unknown = typeof perf === "object" && perf !== null ? Reflect.get(perf, "summary") : null;
    return typeof read === "function" && read().draw3d !== null;
  }, undefined, { timeout: 120_000 });
  await settle(page);
}

/**
 * The chair pressed and glided round a loop over the main room's floor (down towards the TV, west to (3.9, 0.85), back
 * by another curve), one small move a frame, then let go with Esc so nothing is committed and the next run finds it
 * where the seed put it.
 */
async function drag(page: Page): Promise<Summary> {
  await page.keyboard.press("v");
  const canvas = canvasOf(page);
  const start = await toScreen(canvas, CHAIR);
  await page.mouse.move(start.x - 30, start.y + 20);
  await page.mouse.move(start.x, start.y, { steps: 6 });
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(start.x + i, start.y + i); // past the drag threshold
    await frame(page);
  }
  await settle(page);
  await reset(page);
  for (let i = 1; i <= DRAG_MOVES; i++) {
    const t = i / DRAG_MOVES;
    const s = Math.sin(Math.PI * t);
    const at = await toScreen(canvas, { x: CHAIR.x - 1.2 * s * s + 0.1 * Math.sin(2 * Math.PI * t), y: CHAIR.y - 0.7 * s });
    await page.mouse.move(at.x, at.y);
    await frame(page);
  }
  await settle(page);
  const during = await summary(page);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await settle(page);
  return during;
}

/** Night, then Day, FLIPS times: every tween frame redraws the plan and the 3D view (parts.06). */
async function flips(page: Page): Promise<Summary> {
  const pill = page.locator('[data-testid="state-pill"] button[data-state-id]');
  await reset(page);
  for (let i = 0; i < FLIPS; i++) {
    await pill.last().click();
    await page.waitForTimeout(FLIP_WAIT_MS);
    await pill.first().click();
    await page.waitForTimeout(FLIP_WAIT_MS);
  }
  await settle(page);
  return summary(page);
}

type Gesture = { name: string; renderer: "canvas2d" | "webgl"; run: (page: Page) => Promise<Summary> };
const GESTURES: Gesture[] = [
  { name: "Canvas2D, chair drag", renderer: "canvas2d", run: drag },
  { name: "Canvas2D, Day/Night flip ×8", renderer: "canvas2d", run: flips },
  { name: "WebGL, chair drag", renderer: "webgl", run: drag },
  { name: "WebGL, Day/Night flip ×8", renderer: "webgl", run: flips },
];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const fixed = (xs: (number | null | undefined)[], digits = 2): string => {
  const ns = xs.filter((x): x is number => typeof x === "number");
  return ns.length === 0 ? "–" : median(ns).toFixed(digits);
};
const each = (xs: (number | null | undefined)[]): string => xs.map((x) => (typeof x === "number" ? x.toFixed(2) : "–")).join(" / ");

test("studio measurement: a chair drag and the Day/Night flip, Canvas2D and WebGL, 3D split (finishes AC-15)", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const rows: string[] = [
    "| Gesture | frame median (runs) | frame median | draw median | draw avg | draws | update median | update avg | 3D median | 3D draws | primitives |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const g of GESTURES) {
    const runs: Summary[] = [];
    for (let run = 0; run < RUNS; run++) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await open(page, g.renderer);
      runs.push(await g.run(page));
      await context.close();
    }
    const pick = (f: (s: Summary) => number | null | undefined) => runs.map(f);
    rows.push(
      `| ${g.name} | ${each(pick((s) => s.frame?.median))} | ${fixed(pick((s) => s.frame?.median))} | ${fixed(pick((s) => s.draw?.median))} | ${fixed(pick((s) => s.draw?.avg), 3)} | ` +
        `${fixed(pick((s) => s.draw?.count), 0)} | ${fixed(pick((s) => s.update?.median))} | ${fixed(pick((s) => s.update?.avg), 3)} | ${fixed(pick((s) => s.draw3d?.median))} | ` +
        `${fixed(pick((s) => s.draw3d?.count), 0)} | ${fixed(pick((s) => s.primitives), 0)} |`,
    );
  }
  const probe = await browser.newPage();
  const gpu = await probe.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "no webgl2";
  });
  await probe.close();
  console.log(`\nStudio measurement, ${new Date().toISOString()}, ${RUNS} runs, medians in ms, viewport ${VIEWPORT.width}×${VIEWPORT.height} @2x, WebGL on ${gpu}\n${rows.join("\n")}\n`);
});
