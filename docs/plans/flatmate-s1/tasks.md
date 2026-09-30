# S1 Tasks: WebGL2 SDF Renderer and Live Canvas2D Toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Part of the [S1 plan](README.md). Read its decisions, waves and gate first; working rules are those of `docs/plans/flatmate/README.md` ("Working rules for every task") and `EXECUTION.md` (lean mode).

**Goal:** see [README.md](README.md). **Spec:** §1.4 step 10, §5.9, §6, §6.1, §6.2, §11 item 2.

**Design memory to read first:**
- `rendering.md`: Scene units (dashes px, arc radius m, angles CCW with world y up); hex-only palette. Don't: claim analytic AA for polygons; claim a draw-call number that was not computed; let the demo depend on WebGL.
- `architecture.md`: the editor has no DOM or WebGL; shells never read editor state to draw (the `render` effect carries the camera).
- `process.md` lesson 4: don't overclaim (antialiasing, draw calls, performance).
- `implementation.md`: local-mode Playwright specs open `?server=off`; canvas text is not in the DOM.

**Rules for every task:** run a single test file with `pnpm --filter @fm/<pkg> test <file>` (no `--`). `pnpm check` must pass before each commit. Commit only the task's files. Never push.

---

## Task S1.0a: Demo screenshots as Canvas2D references (restores phase 8 Task 8.6)

**Wave 1 · Size S · no review**

**Files:**
- Create: `packages/web/e2e/support/demo-driver.ts`, `packages/web/e2e/screenshots.spec.ts`, `docs/reports/screenshots/canvas2d/*.png` (five images)
- Modify: `package.json` (root): add the `screenshots` script

This is phase 8 Task 8.6, adapted to today's code:
- the driver builds on `e2e/support/canvas.ts` (`ZOOM`, `clickAt`, `moveTo`, `toScreen`, `typeLengthAndWait`);
- the images go to `docs/reports/screenshots/<renderer>/`;
- `FM_RENDERER=webgl` adds `&renderer=webgl` to the URLs (the app ignores it until S1.0b);
- the context has a fixed viewport and `deviceScaleFactor: 1`;
- Bob's presence is read from `data-testid="collaborators"`, not `getByText`.

The spec runs only with `FM_SCREENSHOTS=1` against a running `pnpm demo`, so `pnpm e2e` never overwrites committed images. These first images are the **pre-S1 Canvas2D look**: the worktree starts from the wave's base commit, before S1.1's wall edges.

- [x] **Step 1: Pre-flight.** Nothing else may listen on 5173, 8787 or 8788:

```bash
lsof -i :5173 -i :8787 -i :8788
```

Expected: no output. If something is listening, stop and report NEEDS_CONTEXT; do not kill processes you did not start.

- [x] **Step 2: Write `packages/web/e2e/support/demo-driver.ts`**

```ts
import { expect, type Page } from "@playwright/test";
import { ZOOM, clickAt, moveTo, toScreen, typeLengthAndWait, type WorldPoint } from "./canvas";

const HALF_WALL = 0.1; // WALL_THICKNESS / 2
const HELPER_OFFSET_PX = 18; // helperLabelAt: the text centre is 18 px beyond the wall face

export const canvasOf = (page: Page) => page.getByTestId("canvas");

export async function worldToPage(page: Page, p: WorldPoint): Promise<WorldPoint> {
  return toScreen(canvasOf(page), p);
}

/** Server mode: one edit is outstanding at a time (spec §7.4), so wait for it before the next one. */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("project-status")).toHaveText("saved");
}

/** Server mode: open the project by name, creating it first if it does not exist (demo steps 1 and 7). */
export async function openProject(page: Page, name: string): Promise<void> {
  const field = page.getByPlaceholder("Project name");
  await field.waitFor();
  const existing = page.getByRole("button", { name, exact: true });
  if ((await existing.count()) === 0) {
    await field.fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
  } else {
    await existing.click();
  }
  await field.waitFor({ state: "hidden" });
}

/** Demo steps 2–4 on a shared drawing: the 6 × 4 m room, the midpoint divider, and a zone in each room. */
export async function drawDemoApartment(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift"); // digits still type as digits: the input adapter reads the physical key (spec §5.4)
  const legs: [WorldPoint, string][] = [[{ x: 2, y: 0.1 }, "6"], [{ x: 6.1, y: 2 }, "4"], [{ x: 3, y: 4.1 }, "6"]];
  for (const [p, length] of legs) {
    await moveTo(page, canvas, p);
    await typeLengthAndWait(page, length);
  }
  await clickAt(page, canvas, { x: 0.05, y: 0.02 }); // the first joint closes the chain
  await page.keyboard.up("Shift");
  await waitSaved(page);

  await clickAt(page, canvas, { x: 3.07, y: 0.02 }); // midpoint snap → (3, 0)
  await page.keyboard.down("Shift");
  await clickAt(page, canvas, { x: 2.96, y: 3.97 }); // vertical axis + midpoint snap → (3, 4)
  await page.keyboard.up("Shift");
  await waitSaved(page);
  await page.keyboard.press("Enter"); // the chain resumed; an empty Enter finishes it

  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 1.5, y: 2 });
  await waitSaved(page);
  await clickAt(page, canvas, { x: 4.5, y: 2 });
  await waitSaved(page);
}

/** Page position of the helper dimension text of the wall a→b (mirrors helperLabelAt at the default zoom). */
export async function helperLabelPage(page: Page, a: WorldPoint, b: WorldPoint): Promise<WorldPoint> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const left = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const offset = HALF_WALL + HELPER_OFFSET_PX / ZOOM;
  return worldToPage(page, { x: (a.x + b.x) / 2 + left.x * offset, y: (a.y + b.y) / 2 + left.y * offset });
}
```

- [x] **Step 3: Write `packages/web/e2e/screenshots.spec.ts`**

```ts
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { clickAt, moveTo } from "./support/canvas";
import { canvasOf, drawDemoApartment, helperLabelPage, openProject, waitSaved, worldToPage } from "./support/demo-driver";

// Reference images of demo steps 4–7 (restored phase 8 Task 8.6, S1.0). Runs only with FM_SCREENSHOTS=1 against a
// running `pnpm demo`, so `pnpm e2e` never overwrites the committed images. FM_RENDERER=webgl draws with WebGL.
const RENDERER = process.env.FM_RENDERER === "webgl" ? "webgl" : "canvas2d";
const OUT = fileURLToPath(new URL(`../../../docs/reports/screenshots/${RENDERER}/`, import.meta.url));
const APP = process.env.RM_APP_URL ?? "http://localhost:5173";
const CONTEXT = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }; // fixed size and DPR

test.skip(!process.env.FM_SCREENSHOTS, "run with FM_SCREENSHOTS=1 while `pnpm demo` is running");

test("demo screenshots: zones, helper editing, invalid drag, two windows", async ({ browser }) => {
  const project = `Apartment ${Date.now()}`;

  const aliceContext = await browser.newContext(CONTEXT);
  const alice = await aliceContext.newPage();
  await alice.goto(`${APP}/?name=Alice&renderer=${RENDERER}`);
  await openProject(alice, project);

  // Steps 2–4
  await drawDemoApartment(alice);
  await expect(alice.locator('[data-field-id="area"]')).toHaveValue("10.64 m²"); // canvas text is not in the DOM
  await alice.screenshot({ path: `${OUT}room-with-zones.png` });

  // Step 5, before Enter
  await alice.keyboard.press("v");
  await clickAt(alice, canvasOf(alice), { x: 6, y: 2 });
  const helper = await helperLabelPage(alice, { x: 6, y: 0 }, { x: 6, y: 4 });
  await alice.mouse.click(helper.x, helper.y);
  await alice.keyboard.type("3.5");
  await alice.screenshot({ path: `${OUT}helper-editing.png` });
  await alice.keyboard.press("Enter");
  await waitSaved(alice); // the drag below cannot start while the resize is outstanding

  // Step 6, while the pointer is still down
  const joint = await worldToPage(alice, { x: 6, y: 3.5 });
  const through = await worldToPage(alice, { x: 4, y: 2.8 });
  const invalid = await worldToPage(alice, { x: 2, y: 2 });
  await alice.mouse.move(joint.x, joint.y);
  await alice.mouse.down();
  await alice.mouse.move(through.x, through.y, { steps: 5 });
  await alice.mouse.move(invalid.x, invalid.y, { steps: 5 });
  await alice.screenshot({ path: `${OUT}invalid-drag.png` });
  await alice.mouse.up();
  await expect(alice.getByText("Walls can't cross")).toBeVisible();

  // Step 7
  const bobContext = await browser.newContext(CONTEXT);
  const bob = await bobContext.newPage();
  await bob.goto(`${APP}/?name=Bob&renderer=${RENDERER}`);
  await openProject(bob, project);
  await moveTo(bob, canvasOf(bob), { x: 4.5, y: 1 });
  await expect(alice.getByTestId("collaborators")).toContainText("Bob");
  await alice.screenshot({ path: `${OUT}two-windows-alice.png` });
  await bob.screenshot({ path: `${OUT}two-windows-bob.png` });

  await aliceContext.close();
  await bobContext.close();
});
```

- [x] **Step 4: Add the root script.** In the root `package.json` `scripts`, after `"e2e"`, add:

```json
"screenshots": "FM_SCREENSHOTS=1 pnpm --filter @fm/web exec playwright test e2e/screenshots.spec.ts"
```

- [x] **Step 5: Run it.**
  1. `mkdir -p docs/reports/screenshots/canvas2d`
  2. In a second terminal: `pnpm demo` (wait for `Alice: http://localhost:5173/?name=Alice`).
  3. `pnpm screenshots`

  Expected: `1 passed`, and five PNGs in `docs/reports/screenshots/canvas2d/`:
  - `room-with-zones.png`
  - `helper-editing.png`
  - `invalid-drag.png`
  - `two-windows-alice.png`
  - `two-windows-bob.png`

  Stop `pnpm demo` (Ctrl+C), then run `pnpm e2e`. Expected: the screenshots test is reported as skipped, and the smoke and collaboration tests pass.

  Open each image. Expected content:
  - step 4: two rooms, each tagged 10.64 m²;
  - helper: "3.5" typed on the right wall;
  - invalid drag: red walls and a red ghost disc at the cursor;
  - two windows: Bob's cursor and name in Alice's window.

  If a selector fails (project list, helper click), align this driver with the app; do not change the app. Report the change.

- [x] **Step 6: Commit**

```bash
pnpm check
git add packages/web/e2e/support/demo-driver.ts packages/web/e2e/screenshots.spec.ts docs/reports/screenshots/canvas2d package.json
git commit -m "web: Playwright demo screenshots (Canvas2D references, restores Task 8.6)"
```

---

## Task S1.0b: Renderer seam and live toggle (Canvas2D only)

**Wave 1 · Size M · no review (shell glue)**

**Files:**
- Modify: `packages/web/src/adapters/effect-runner.ts`, `packages/web/test/effect-runner.test.ts`, `packages/web/src/panels/Toolbar.tsx`, `packages/web/src/app.tsx`, `packages/web/src/main.tsx`, `packages/web/src/styles.css`
- Create: `packages/web/src/renderer-switch.ts`, `packages/web/test/renderer-switch.test.ts`, `packages/web/src/panels/RendererToggle.tsx`, `packages/web/test/renderer-toggle.test.tsx`

After this task:
- the runner no longer takes a renderer in its deps; it is handed one through `setRenderer`, and it redraws the last scene at once;
- `RendererSwitch` holds `{ kind, notice }`, creates renderers through factories, disposes the old one and falls back to Canvas2D;
- the stage has two stacked canvases, and the toolbar has the toggle.

The WebGL factory returns `null` until S1.4, so `?renderer=webgl` shows the "unavailable" notice for now. Do not run `pnpm e2e` or `pnpm demo` in this task (wave 1 ports belong to S1.0a); the controller runs e2e after the merge.

- [x] **Step 1: Write the failing runner tests.** Replace `packages/web/test/effect-runner.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { Camera, Effect, Scene, ViewModel } from "@fm/editor";
import { createEffectRunner, type ServerEffect } from "../src/adapters/effect-runner";
import type { Renderer } from "../src/adapters/renderer";
import type { Timers } from "../src/adapters/timers";
import { cameraFixture, sceneFixture, viewFixture } from "./fixtures";

function harness(withServer: boolean) {
  const log: string[] = [];
  const rendered: { scene: Scene; camera: Camera }[] = [];
  const views: ViewModel[] = [];
  const serverEffects: ServerEffect[] = [];
  const renderer: Renderer = {
    render: (scene, camera) => {
      rendered.push({ scene, camera });
      log.push("render");
    },
    dispose: () => {},
  };
  const timers: Timers = {
    start: (id, ms) => {
      log.push(`start ${id} ${ms}`);
    },
    cancel: (id) => {
      log.push(`cancel ${id}`);
    },
    dispose: () => {},
  };
  const runner = createEffectRunner({
    timers,
    server: withServer
      ? (effect) => {
          serverEffects.push(effect);
          log.push(`server ${effect.type}`);
        }
      : null,
    onView: (view) => {
      views.push(view);
      log.push("view");
    },
  });
  runner.setRenderer(renderer);
  return { run: runner.run, runner, log, rendered, views, serverEffects };
}

const scene = sceneFixture();
const view = viewFixture({ activeTool: "wall" });
const serverEffects: Effect[] = [
  { type: "workspace", op: { type: "list", requestId: "r1" } },
  { type: "submit", projectId: "p1", generation: "g1", changeset: { id: "c1", patch: { puts: [], deletes: [] }, expect: [] } },
  { type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [] },
];

describe("effect runner", () => {
  it("renders the scene with the effect's camera and publishes the view", () => {
    const h = harness(false);
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    expect(h.rendered).toEqual([{ scene, camera: cameraFixture }]);
    expect(h.views).toEqual([view]);
    expect(h.log).toEqual(["render", "view"]);
  });

  it("routes timer effects to the timers adapter", () => {
    const h = harness(false);
    h.run([
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "cancelTimer", timerId: "toast" },
    ]);
    expect(h.log).toEqual(["start toast 3000", "cancel toast"]);
  });

  it("hands workspace, submit and presence effects to the server sink in order", () => {
    const h = harness(true);
    h.run(serverEffects);
    expect(h.serverEffects).toEqual(serverEffects);
    expect(h.log).toEqual(["server workspace", "server submit", "server presence"]);
  });

  it("ignores server effects when there is no server (local mode)", () => {
    const h = harness(false);
    h.run(serverEffects);
    expect(h.log).toEqual([]);
  });

  it("ignores saveSnapshot until local files exist (X1)", () => {
    const h = harness(true);
    h.run([{ type: "saveSnapshot", projectId: "p1", writeId: "w1", content: "{}" }]);
    expect(h.log).toEqual([]);
  });

  it("keeps effect order across kinds", () => {
    const h = harness(true);
    h.run([
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "workspace", op: { type: "list", requestId: "r1" } },
      { type: "render", scene, view, camera: cameraFixture },
    ]);
    expect(h.log).toEqual(["start toast 3000", "server workspace", "render", "view"]);
  });

  it("keeps the last render and hands it to a new renderer at once", () => {
    const h = harness(false);
    const other = sceneFixture();
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    h.run([{ type: "render", scene: other, view, camera: { ...cameraFixture, zoom: 50 } }]);
    const next: { scene: Scene; camera: Camera }[] = [];
    h.runner.setRenderer({ render: (s, c) => next.push({ scene: s, camera: c }), dispose: () => {} });
    expect(next).toEqual([{ scene: other, camera: { ...cameraFixture, zoom: 50 } }]);
    expect(next[0]?.scene).toBe(other);
  });

  it("sends later frames only to the new renderer", () => {
    const h = harness(false);
    const next: Scene[] = [];
    h.runner.setRenderer({ render: (s) => next.push(s), dispose: () => {} });
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    expect(next).toEqual([scene]);
    expect(h.rendered).toEqual([]);
  });

  it("draws nothing before a renderer is set, then the last scene when one is", () => {
    const runner = createEffectRunner({ timers: { start: () => {}, cancel: () => {}, dispose: () => {} }, server: null, onView: () => {} });
    runner.run([{ type: "render", scene, view, camera: cameraFixture }]);
    const drawn: Scene[] = [];
    runner.setRenderer({ render: (s) => drawn.push(s), dispose: () => {} });
    expect(drawn).toEqual([scene]);
  });

  it("gives a new renderer nothing before the first render", () => {
    const h = harness(false);
    const drawn: Scene[] = [];
    h.runner.setRenderer({ render: (s) => drawn.push(s), dispose: () => {} });
    expect(drawn).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/web test test/effect-runner.test.ts`
Expected: FAIL, all 10 tests. Nine fail with `TypeError: runner.setRenderer is not a function`; the one that builds its own runner fails with `TypeError: runner.run is not a function` (today `createEffectRunner` returns a plain function).

- [x] **Step 3: Implement.** Replace `packages/web/src/adapters/effect-runner.ts` with:

```ts
import type { Camera, Effect, Scene, ServerEffect, ViewModel } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import type { Renderer } from "./renderer";
import type { Timers } from "./timers";

export type { ServerEffect };
/** Built from the WebSocket adapter in server mode; local mode passes null. */
export type ServerEffectSink = (effect: ServerEffect) => void;

export type EffectRunnerDeps = {
  timers: Timers;
  server: ServerEffectSink | null;
  onView(view: ViewModel): void;
};

export type EffectRunner = {
  /** Performs effects in order (spec §5.2); results come back later as events. */
  run(effects: Effect[]): void;
  /**
   * Draws with `renderer` from now on and hands it the last rendered scene at once: the editor emits `render`
   * only after events, so a renderer swap (spec §1.4 step 10) would otherwise show nothing until the next one.
   */
  setRenderer(renderer: Renderer): void;
};

export function createEffectRunner(deps: EffectRunnerDeps): EffectRunner {
  let renderer: Renderer | null = null;
  let last: { scene: Scene; camera: Camera } | null = null;
  return {
    run(effects) {
      for (const effect of effects) {
        switch (effect.type) {
          case "render":
            last = { scene: effect.scene, camera: effect.camera };
            renderer?.render(effect.scene, effect.camera);
            deps.onView(effect.view);
            break;
          case "startTimer":
            deps.timers.start(effect.timerId, effect.ms);
            break;
          case "cancelTimer":
            deps.timers.cancel(effect.timerId);
            break;
          case "workspace":
          case "submit":
          case "presence":
            if (deps.server !== null) deps.server(effect);
            break;
          case "saveSnapshot":
            // Local-folder workspace is follow-up X1 (spec §7.8); the initial build never emits it.
            break;
          default:
            assertNever(effect);
        }
      }
    },
    setRenderer(next) {
      renderer = next;
      if (last !== null) next.render(last.scene, last.camera);
    },
  };
}
```

- [x] **Step 4: Run it green**

Run: `pnpm --filter @fm/web test test/effect-runner.test.ts`
Expected: PASS, 10 tests. (`pnpm typecheck` fails until Step 13 updates `main.tsx`; that is expected.)

- [x] **Step 5: Write the failing switch tests.** Create `packages/web/test/renderer-switch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Renderer } from "../src/adapters/renderer";
import {
  WEBGL_LOST,
  WEBGL_UNAVAILABLE,
  createRendererSwitch,
  rendererFrom,
  type RendererFactories,
  type RendererKind,
} from "../src/renderer-switch";

type FakeRenderer = Renderer & { name: string; disposed: boolean };

function fakes(webglAvailable = true) {
  const made: FakeRenderer[] = [];
  const applied: string[] = [];
  let loseContext: (() => void) | null = null;
  const make = (name: string): FakeRenderer => {
    const r: FakeRenderer = {
      name,
      disposed: false,
      render: () => {},
      dispose: () => {
        r.disposed = true;
      },
    };
    made.push(r);
    return r;
  };
  const factories: RendererFactories = {
    canvas2d: () => make(`canvas2d#${made.length}`),
    webgl: (onLost) => {
      if (!webglAvailable) return null;
      loseContext = onLost;
      return make(`webgl#${made.length}`);
    },
  };
  const apply = (r: Renderer): void => {
    const found = made.find((m) => m === r);
    applied.push(found?.name ?? "unknown");
  };
  return { made, applied, factories, apply, lose: () => loseContext?.() };
}

function attached(kind: RendererKind, webglAvailable = true) {
  const f = fakes(webglAvailable);
  const sw = createRendererSwitch(kind);
  let notified = 0;
  sw.subscribe(() => {
    notified += 1;
  });
  const detach = sw.attach(f.factories, f.apply);
  return { ...f, sw, detach, notified: () => notified };
}

describe("rendererFrom", () => {
  it("reads ?renderer=webgl, case-insensitively", () => {
    expect(rendererFrom("?renderer=webgl")).toBe("webgl");
    expect(rendererFrom("?name=Alice&renderer=WebGL")).toBe("webgl");
  });

  it("defaults to Canvas2D for anything else", () => {
    expect(rendererFrom("")).toBe("canvas2d");
    expect(rendererFrom("?renderer=canvas2d")).toBe("canvas2d");
    expect(rendererFrom("?renderer=gl")).toBe("canvas2d");
  });
});

describe("renderer switch", () => {
  it("starts with the chosen renderer and hands it to apply", () => {
    const c = attached("canvas2d");
    expect(c.applied).toEqual(["canvas2d#0"]);
    expect(c.sw.getChoice()).toEqual({ kind: "canvas2d", notice: null });
    const w = attached("webgl");
    expect(w.applied).toEqual(["webgl#0"]);
    expect(w.sw.getChoice()).toEqual({ kind: "webgl", notice: null });
  });

  it("falls back to Canvas2D with a notice when WebGL2 is unavailable", () => {
    const h = attached("webgl", false);
    expect(h.applied).toEqual(["canvas2d#0"]);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_UNAVAILABLE });
  });

  it("toggles: disposes the old renderer, applies the new one and notifies", () => {
    const h = attached("canvas2d");
    const before = h.notified();
    h.sw.toggle();
    expect(h.applied).toEqual(["canvas2d#0", "webgl#1"]);
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.sw.getChoice()).toEqual({ kind: "webgl", notice: null });
    expect(h.notified()).toBe(before + 1);
    h.sw.toggle();
    expect(h.applied).toEqual(["canvas2d#0", "webgl#1", "canvas2d#2"]);
    expect(h.made[1]?.disposed).toBe(true);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: null });
  });

  it("stays on Canvas2D with a notice when a toggle to WebGL fails", () => {
    const h = attached("canvas2d", false);
    h.sw.toggle();
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_UNAVAILABLE });
    expect(h.applied).toEqual(["canvas2d#0", "canvas2d#1"]);
  });

  it("falls back to Canvas2D when the WebGL context is lost", () => {
    const h = attached("webgl");
    h.lose();
    expect(h.applied).toEqual(["webgl#0", "canvas2d#1"]);
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: WEBGL_LOST });
  });

  it("ignores a context loss from a renderer that is no longer drawing", () => {
    const h = attached("webgl");
    h.sw.toggle(); // back to Canvas2D; the WebGL renderer is disposed
    h.lose();
    expect(h.applied).toEqual(["webgl#0", "canvas2d#1"]);
    expect(h.sw.getChoice()).toEqual({ kind: "canvas2d", notice: null });
  });

  it("before attach, a toggle only records the choice", () => {
    const f = fakes();
    const sw = createRendererSwitch("canvas2d");
    sw.toggle();
    expect(sw.getChoice()).toEqual({ kind: "webgl", notice: null });
    sw.attach(f.factories, f.apply);
    expect(f.applied).toEqual(["webgl#0"]);
  });

  it("detach disposes the current renderer; later toggles apply nothing", () => {
    const h = attached("canvas2d");
    h.detach();
    expect(h.made[0]?.disposed).toBe(true);
    h.sw.toggle();
    expect(h.applied).toEqual(["canvas2d#0"]);
    expect(h.sw.getChoice().kind).toBe("webgl");
  });

  it("keeps the same choice object until it changes (useSyncExternalStore)", () => {
    const h = attached("canvas2d");
    expect(h.sw.getChoice()).toBe(h.sw.getChoice());
  });
});
```

- [x] **Step 6: Run it and see it fail**

Run: `pnpm --filter @fm/web test test/renderer-switch.test.ts`
Expected: FAIL. The module `../src/renderer-switch` cannot be resolved.

- [x] **Step 7: Implement.** Create `packages/web/src/renderer-switch.ts`:

```ts
import type { Renderer } from "./adapters/renderer";

// Shell-only renderer choice (spec §1.4 step 10, §6): the editor never knows which renderer draws its Scene.

export type RendererKind = "canvas2d" | "webgl";
export type RendererChoice = { kind: RendererKind; notice: string | null };

export type RendererFactories = {
  canvas2d(): Renderer;
  /** null when WebGL2 is unavailable. `onLost` is called from the context-lost event, never during creation. */
  webgl(onLost: () => void): Renderer | null;
};

export type RendererSwitch = {
  getChoice(): RendererChoice;
  subscribe(fn: () => void): () => void;
  /** Canvas2D ↔ WebGL. While attached, the new renderer replaces the old one at once. */
  toggle(): void;
  /**
   * Creates the chosen renderer (Canvas2D when WebGL fails) and hands it, and every later one, to `apply`.
   * Returns a function that disposes the current renderer and stops.
   */
  attach(factories: RendererFactories, apply: (renderer: Renderer) => void): () => void;
};

export const WEBGL_UNAVAILABLE = "WebGL2 is unavailable: drawing with Canvas2D";
export const WEBGL_LOST = "WebGL context lost: drawing with Canvas2D";

/** `?renderer=webgl` starts with WebGL; anything else starts with Canvas2D, so the demo never depends on WebGL. */
export function rendererFrom(search: string): RendererKind {
  return new URLSearchParams(search).get("renderer")?.trim().toLowerCase() === "webgl" ? "webgl" : "canvas2d";
}

type Created = { renderer: Renderer; choice: RendererChoice };
type Attached = { factories: RendererFactories; apply(renderer: Renderer): void; current: Renderer };

export function createRendererSwitch(initial: RendererKind): RendererSwitch {
  let choice: RendererChoice = { kind: initial, notice: null };
  let attached: Attached | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: RendererChoice): void => {
    choice = next;
    for (const fn of listeners) fn();
  };

  const create = (factories: RendererFactories, kind: RendererKind): Created => {
    if (kind === "webgl") {
      const gl: Renderer | null = factories.webgl(() => lost(gl));
      if (gl !== null) return { renderer: gl, choice: { kind: "webgl", notice: null } };
      return { renderer: factories.canvas2d(), choice: { kind: "canvas2d", notice: WEBGL_UNAVAILABLE } };
    }
    return { renderer: factories.canvas2d(), choice: { kind: "canvas2d", notice: null } };
  };

  const install = (next: Created): void => {
    if (attached === null) return;
    attached.current.dispose();
    attached.current = next.renderer;
    attached.apply(next.renderer);
    publish(next.choice);
  };

  /** Only the renderer currently drawing may trigger the fallback; a stale one was already disposed. */
  const lost = (renderer: Renderer | null): void => {
    if (attached === null || renderer === null || attached.current !== renderer) return;
    install({ renderer: attached.factories.canvas2d(), choice: { kind: "canvas2d", notice: WEBGL_LOST } });
  };

  return {
    getChoice: () => choice,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    toggle() {
      const kind: RendererKind = choice.kind === "webgl" ? "canvas2d" : "webgl";
      if (attached === null) publish({ kind, notice: null });
      else install(create(attached.factories, kind));
    },
    attach(factories, apply) {
      const first = create(factories, choice.kind);
      attached = { factories, apply, current: first.renderer };
      apply(first.renderer);
      publish(first.choice);
      return () => {
        attached?.current.dispose();
        attached = null;
      };
    },
  };
}
```

The WebGL factory's `onLost` closure refers to `gl` inside its own initializer. This is safe because `onLost` only runs from the `webglcontextlost` event, never during creation (the contract on `RendererFactories.webgl`).

- [x] **Step 8: Run it green**

Run: `pnpm --filter @fm/web test test/renderer-switch.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 9: Write the failing toggle tests.** Create `packages/web/test/renderer-toggle.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RendererToggle } from "../src/panels/RendererToggle";
import { Toolbar } from "../src/panels/Toolbar";
import { WEBGL_UNAVAILABLE } from "../src/renderer-switch";
import { viewFixture } from "./fixtures";

const onToggle = (): void => {};

describe("RendererToggle", () => {
  it("names the current renderer and marks WebGL as pressed", () => {
    const canvas = renderToStaticMarkup(<RendererToggle choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} />);
    expect(canvas).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="false"[^>]*>Canvas2D<\/button>/);
    const webgl = renderToStaticMarkup(<RendererToggle choice={{ kind: "webgl", notice: null }} onToggle={onToggle} />);
    expect(webgl).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="true"[^>]*>WebGL<\/button>/);
    expect(webgl).not.toContain("renderer-notice");
  });

  it("shows the fallback notice", () => {
    const html = renderToStaticMarkup(<RendererToggle choice={{ kind: "canvas2d", notice: WEBGL_UNAVAILABLE }} onToggle={onToggle} />);
    expect(html).toContain(`data-testid="renderer-notice">${WEBGL_UNAVAILABLE}<`);
  });
});

describe("Toolbar", () => {
  it("renders extra controls after undo and redo", () => {
    const html = renderToStaticMarkup(
      <Toolbar view={viewFixture()} send={() => {}}>
        <RendererToggle choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} />
      </Toolbar>,
    );
    expect(html.indexOf('data-action="renderer"')).toBeGreaterThan(html.indexOf('data-action="redo"'));
  });
});
```

- [x] **Step 10: Run it and see it fail**

Run: `pnpm --filter @fm/web test test/renderer-toggle.test.tsx`
Expected: FAIL. `../src/panels/RendererToggle` cannot be resolved.

- [x] **Step 11: Implement the toggle and the toolbar slot.** Create `packages/web/src/panels/RendererToggle.tsx`:

```tsx
import type { RendererChoice } from "../renderer-switch";

export type RendererToggleProps = { choice: RendererChoice; onToggle(): void };

/** Shell-only control (spec §1.4 step 10): which renderer draws the canvas, plus the fallback notice. */
export function RendererToggle({ choice, onToggle }: RendererToggleProps) {
  return (
    <div className="renderer-toggle">
      {choice.notice !== null ? (
        <span className="renderer-notice" role="status" data-testid="renderer-notice">
          {choice.notice}
        </span>
      ) : null}
      <button
        type="button"
        data-action="renderer"
        aria-pressed={choice.kind === "webgl"}
        title="Renderer: switch between Canvas2D and WebGL"
        // Keep focus off the button, like the tool buttons: a focused button would also react to Space and Enter.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
      >
        {choice.kind === "webgl" ? "WebGL" : "Canvas2D"}
      </button>
    </div>
  );
}
```

Replace `packages/web/src/panels/Toolbar.tsx` with (only the `ReactNode` import, the `children` prop and `{children}` are new):

```tsx
import type { MouseEvent, ReactNode } from "react";
import type { ToolName } from "@fm/editor";
import type { PanelProps } from "./types";

const TOOLS: readonly { tool: ToolName; label: string; shortcut: string }[] = [
  { tool: "select", label: "Select", shortcut: "V" },
  { tool: "wall", label: "Wall", shortcut: "W" },
  { tool: "zone", label: "Zone", shortcut: "Z" },
];

/** A focused button would also react to Space and Enter, which the editor uses to confirm. */
const keepFocus = (e: MouseEvent): void => {
  e.preventDefault();
};

/** Tool buttons, undo and redo; `children` (the renderer toggle) go at the end. */
export function Toolbar({ view, send, children }: PanelProps & { children?: ReactNode }) {
  return (
    <nav className="toolbar fm-toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          data-tool={t.tool}
          aria-pressed={view.activeTool === t.tool}
          title={`${t.label} (${t.shortcut})`}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "pickTool", tool: t.tool })}
        >
          {t.label} <kbd>{t.shortcut}</kbd>
        </button>
      ))}
      <span className="toolbar-sep" />
      <button type="button" data-action="undo" disabled={!view.canUndo} title="Undo (⌘Z)" onMouseDown={keepFocus} onClick={() => send({ type: "undo" })}>
        Undo
      </button>
      <button type="button" data-action="redo" disabled={!view.canRedo} title="Redo (⇧⌘Z)" onMouseDown={keepFocus} onClick={() => send({ type: "redo" })}>
        Redo
      </button>
      {children}
    </nav>
  );
}
```

- [x] **Step 12: Run it green**

Run: `pnpm --filter @fm/web test test/renderer-toggle.test.tsx`
Expected: PASS, 3 tests. `pnpm --filter @fm/web test test/panels.test.tsx` still passes: the toolbar without children is unchanged.

- [x] **Step 13: Wire the app (two stacked canvases) and the composition root.** Replace `packages/web/src/app.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { UiAction } from "@fm/editor";
import { CommandBar } from "./panels/CommandBar";
import { ProjectList } from "./panels/ProjectList";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { RendererToggle } from "./panels/RendererToggle";
import { StatusBar } from "./panels/StatusBar";
import { Toast } from "./panels/Toast";
import { Toolbar } from "./panels/Toolbar";
import type { RendererSwitch } from "./renderer-switch";
import type { EditorStore } from "./store";

export type AppProps = {
  store: EditorStore;
  renderer: RendererSwitch;
  /** `canvas` takes input and Canvas2D (or, under WebGL, the text overlay); `glCanvas` lies under it for WebGL. */
  mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void;
  serverMode?: boolean;
};

export function App({ store, renderer, mountCanvas, serverMode = false }: AppProps) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const choice = useSyncExternalStore(renderer.subscribe, renderer.getChoice);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (canvas === null || glCanvas === null) return undefined;
    return mountCanvas(canvas, glCanvas);
  }, [mountCanvas]);

  const send = useCallback((action: UiAction) => store.dispatch({ type: "ui", action }), [store]);

  return (
    <div className="app fm-app">
      <Toolbar view={view} send={send}>
        <RendererToggle choice={choice} onToggle={renderer.toggle} />
      </Toolbar>
      <div className="workspace">
        <div className="canvas-host fm-stage">
          <canvas ref={glCanvasRef} className="gl-canvas" data-testid="gl-canvas" aria-hidden="true" />
          <canvas ref={canvasRef} data-testid="canvas" style={{ cursor: view.cursor }} />
          {view.projectList !== null ? <ProjectList list={view.projectList} send={send} /> : null}
          {serverMode && view.project !== null ? (
            <button
              type="button"
              className="projects-button"
              // Keep focus off the button, like the toolbar: a focused button would also react to Space and Enter.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => send({ type: "showProjectList" })}
            >
              Projects
            </button>
          ) : null}
        </div>
        <PropertiesPanel view={view} send={send} />
      </div>
      <CommandBar view={view} />
      <StatusBar view={view} />
      <Toast view={view} />
    </div>
  );
}
```

Replace `packages/web/src/main.tsx` with:

```tsx
import { createRoot } from "react-dom/client";
import { initialState } from "@fm/editor";
import { attachInput } from "./adapters/input";
import { createCanvas2DRenderer } from "./adapters/canvas2d-renderer";
import { createEffectRunner } from "./adapters/effect-runner";
import { createTimers } from "./adapters/timers";
import { createWebHost } from "./adapters/web-host";
import { createWsServer, serverSink } from "./adapters/ws-server";
import { App } from "./app";
import { displayNameFrom, serverUrlFrom, tabClientId } from "./identity";
import { createRendererSwitch, rendererFrom } from "./renderer-switch";
import { createEditorStore } from "./store";
import "./styles.css";

// Composition root. Server mode when a server URL is known (?server= or VITE_SERVER_URL), otherwise
// local mode: one unsaved LocalDocument and no project list (spec §7.0, §10 step 4).
const host = createWebHost();
const clientId = tabClientId(sessionStorage, () => crypto.randomUUID());
const name = displayNameFrom(location.search);
const serverUrl = serverUrlFrom(location.search, import.meta.env.VITE_SERVER_URL);
const initial = initialState(
  {
    mode: serverUrl === null ? "local" : "server",
    me: { clientId, name },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
  },
  host,
);
const store = createEditorStore({ initial, host });
const timers = createTimers(store.dispatch);
// Canvas2D unless ?renderer=webgl (spec §1.4 step 10); the toolbar toggles it live.
const rendererSwitch = createRendererSwitch(rendererFrom(location.search));

function mountCanvas(canvas: HTMLCanvasElement, _glCanvas: HTMLCanvasElement): () => void {
  // The socket opens asynchronously, so the runner below is in place before any server event arrives.
  const server = serverUrl === null ? null : createWsServer({ url: serverUrl, clientId, name, dispatch: store.dispatch });
  const runner = createEffectRunner({
    timers,
    server: server === null ? null : serverSink(server),
    onView: store.publishView,
  });
  store.setRunner(runner.run);
  // No WebGL renderer yet (S1.3): ?renderer=webgl falls back to Canvas2D with a notice.
  const detachRenderer = rendererSwitch.attach({ canvas2d: () => createCanvas2DRenderer(canvas), webgl: () => null }, runner.setRenderer);
  const detach = attachInput(canvas, store.dispatch); // sends viewportResized at once → first frame
  return () => {
    detach();
    server?.close();
    store.setRunner(() => {});
    detachRenderer();
  };
}

// Work that closing the tab would lose (spec §7.0, §7.7): local edits, or a submission whose outcome is unknown.
window.addEventListener("beforeunload", (e) => {
  if (store.getView().project?.dirty === true) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing");
createRoot(root).render(<App store={store} renderer={rendererSwitch} mountCanvas={mountCanvas} serverMode={serverUrl !== null} />);
```

Append to `packages/web/src/styles.css`:

```css
/* S1: stacked canvases and the renderer toggle. The WebGL canvas lies under the input canvas and never takes input. */
.canvas-host .gl-canvas { pointer-events: none; }
.renderer-toggle { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.renderer-notice { color: var(--fm-danger); font-size: 12px; }
```

The existing `.canvas-host canvas` rule already stacks both canvases (`position: absolute; inset: 0`). DOM order puts `canvas` above `gl-canvas`. Under Canvas2D the top canvas is opaque, so the empty `gl-canvas` never shows.

- [x] **Step 14: Check and commit**

```bash
pnpm check
```

Expected: pass; the web suite has 88 tests (70 before, plus 4 runner, 11 switch and 3 toggle tests).

```bash
git add packages/web/src/adapters/effect-runner.ts packages/web/test/effect-runner.test.ts packages/web/src/renderer-switch.ts packages/web/test/renderer-switch.test.ts packages/web/src/panels/RendererToggle.tsx packages/web/test/renderer-toggle.test.tsx packages/web/src/panels/Toolbar.tsx packages/web/src/app.tsx packages/web/src/main.tsx packages/web/src/styles.css
git commit -m "web: renderer switch, live toggle and ?renderer= (Canvas2D only)"
```

**Controller, after merging wave 1:** run `pnpm e2e` (smoke and collaboration green; screenshots skipped). In a browser, `pnpm dev` and `http://localhost:5173/?renderer=webgl`: the toolbar shows "Canvas2D" and the notice "WebGL2 is unavailable: drawing with Canvas2D". Clicking the button keeps Canvas2D, shows the same notice, and leaves the drawing unchanged.

---

## Task S1.1: Walls draw 1 px edge segments over their fills (option A)

**Wave 1 · Size S · reviewed (core)**

**Files:**
- Modify: `packages/editor/src/view/scene.ts` (`drawWalls`, one constant)
- Test: `packages/editor/test/view.test.ts`

Spec §6.2 (polygon row) and `rendering.md` (decision of 2026-09-29): each wall is its filled outline, then segments along every outline edge, in the same colour. Width `{ px: 1 }`, `cap: "round"` (round caps close the outer miter corners), no dash. Push all fills of the layer first, then all edges: this is the order the WebGL renderer draws a layer in, so both renderers match.

**Existing assertions that change on purpose.** Each counted every primitive in the `walls` layer, and now counts fills only. All are in `packages/editor/test/view.test.ts`:

| Test | Old assertion | New assertion |
|------|---------------|---------------|
| `buildScene` › "draws one wall outline per wall" | `walls` length 4, all polygons | rewritten: 4 outlines, then one edge per outline vertex (Step 1) |
| "draws an ok drag attempt's document normally" | `walls` length 7 | `fills(walls)` length 7 |
| "draws the walls at an invalid drag's joints red…" | `colored(walls, invalid)` length 3 | `colored(fills(walls), invalid)` length 3 |
| "draws the wall tool's valid preview…" | `walls` length 5; `colored(walls, preview)` length 1 | `fills(...)` length 5; `colored(fills(...), preview)` length 1 |
| "draws an invalid wall preview red…" | `walls` length 4 | `fills(...)` length 4 |

These stay green unchanged, because they already filter on `kind === "polygon"` or use `.some(polygon && …)`:
- `view.test.ts`: selected, hover and the `wallSelected` length-0 check;
- `select-tool.test.ts` (`wallsLayer`);
- `wall-tool.test.ts` (preview `.some`);
- `scenarios/demo.test.ts` and `scenarios/demo-narrated.test.ts` (`hasRedWall`).

- [x] **Step 1: Write the failing tests.** In `packages/editor/test/view.test.ts`, add this helper after the `layer` function:

```ts
/** Wall fills only: since S1 the walls layer also holds 1 px edge segments over each fill. */
function fills(primitives: Primitive[]): Primitive[] {
  return primitives.filter((p) => p.kind === "polygon");
}
```

Replace the test `it("draws one wall outline per wall", …)` with these two tests:

```ts
  it("draws one wall outline per wall, then a 1 px edge segment along every outline edge (§6.2)", () => {
    const walls = layer(buildScene(stateWith(roomDoc()), host), "walls");
    const outlines = walls.flatMap((p) => (p.kind === "polygon" ? [p] : []));
    const edges = walls.flatMap((p) => (p.kind === "segment" ? [p] : []));
    expect(outlines).toHaveLength(4);
    expect(outlines.every((p) => p.color === COLORS.wall)).toBe(true);
    expect(walls.slice(0, 4)).toEqual(outlines); // all fills first, then all edges
    expect(edges).toHaveLength(outlines.reduce((n, p) => n + p.points.length, 0));
    expect(edges.every((e) => "px" in e.width && e.width.px === 1 && e.cap === "round" && e.color === COLORS.wall && e.dash === undefined)).toBe(true);
    const first = outlines[0];
    if (!first) throw new Error("no outline");
    expect(edges.slice(0, first.points.length).map((e) => [e.a, e.b])).toEqual(
      first.points.map((a, i) => [a, first.points[(i + 1) % first.points.length]]),
    );
  });

  it("draws a wall's edges in its fill colour", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const walls = layer(buildScene(stateWith(doc, { selection: [{ table: "walls", id: right }] }), host), "walls");
    const selectedFill = walls.find((p) => p.kind === "polygon" && p.color === COLORS.wallSelected);
    const selectedEdges = walls.filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected);
    expect(selectedFill?.kind === "polygon" && selectedEdges.length === selectedFill.points.length).toBe(true);
  });
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/view.test.ts`
Expected: FAIL, 2 tests:
- "draws one wall outline per wall, then a 1 px edge segment…" fails with `expected [] to have a length of 16 but got +0`;
- "draws a wall's edges in its fill colour" fails with `expected false to be true`.

- [x] **Step 3: Implement.** In `packages/editor/src/view/scene.ts`, add the constant after `PREVIEW_WALL`:

```ts
const WALL_EDGE_PX = 1; // width of the outline segments drawn over each wall fill
```

and replace `drawWalls` with:

```ts
/**
 * Each wall is its filled outline, then 1 px segments along the outline's edges in the same colour (spec §6.2):
 * under WebGL the segments give wall edges analytic antialiasing. All fills come before all edges, the order
 * the WebGL renderer draws a layer in (polygons, then segments).
 */
function drawWalls(state: EditorState, doc: Document, out: Primitive[]): void {
  const selected = new Set(state.selection.filter((r) => r.table === "walls").map((r) => r.id));
  const hovered = state.hover?.table === "walls" ? state.hover.id : null;
  const invalid = invalidWalls(state, doc);
  const edges: Primitive[] = [];
  for (const [id, points] of wallOutlines(doc)) {
    const color = invalid.has(id)
      ? COLORS.invalid
      : id === PREVIEW_WALL
        ? COLORS.preview
        : selected.has(id)
          ? COLORS.wallSelected
          : id === hovered
            ? COLORS.wallHover
            : COLORS.wall;
    out.push({ kind: "polygon", points, color });
    points.forEach((a, i) => {
      edges.push({ kind: "segment", a, b: points[(i + 1) % points.length] ?? a, width: { px: WALL_EDGE_PX }, color, cap: "round" });
    });
  }
  out.push(...edges);
}
```

- [x] **Step 4: Run it; see the five old counts fail**

Run: `pnpm --filter @fm/editor test test/view.test.ts`
Expected: the two new tests pass. Five old tests fail, because they counted every walls-layer primitive (for example `expected [ … ] to have a length of 4 but got 20`).

- [x] **Step 5: Update the five counts deliberately.** In `packages/editor/test/view.test.ts`, make exactly these replacements:

```ts
// "draws an ok drag attempt's document normally"
    expect(fills(walls)).toHaveLength(7); // the attempt's document, not the visible one
// "draws the walls at an invalid drag's joints red, …"
    expect(colored(fills(layer(scene, "walls")), COLORS.invalid)).toHaveLength(3); // the wall and its two neighbours
// "draws the wall tool's valid preview from its document, …"
    expect(fills(layer(scene, "walls"))).toHaveLength(5);
    expect(colored(fills(layer(scene, "walls")), COLORS.preview)).toHaveLength(1);
// "draws an invalid wall preview red, …"
    expect(fills(layer(scene, "walls"))).toHaveLength(4);
```

(The old lines were `expect(walls).toHaveLength(7)`, `expect(colored(layer(scene, "walls"), COLORS.invalid)).toHaveLength(3)`, `expect(layer(scene, "walls")).toHaveLength(5)`, `expect(colored(layer(scene, "walls"), COLORS.preview)).toHaveLength(1)` and `expect(layer(scene, "walls")).toHaveLength(4)`.)

- [x] **Step 6: Run the editor suite green**

Run: `pnpm --filter @fm/editor test`
Expected: PASS, one more test than before (two new tests replace one): 373 at `bbfd448`.

- [x] **Step 7: Check and commit**

```bash
pnpm check
git add packages/editor/src/view/scene.ts packages/editor/test/view.test.ts
git commit -m "editor: walls draw 1 px edge segments over their fills (S1 option A)"
```

**Review focus (wave 1 review, S1.1 only):**
- edges follow each outline's vertices cyclically;
- the edge colour equals the fill colour in every state (invalid, preview, selected, hover);
- all fills come before all edges;
- no `as` or `!`;
- no change to hit-testing (the editor hit-tests geometry, not primitives).

---

## Task S1.2: Pure instance builder (Scene → typed arrays)

**Wave 2 · Size M · reviewed (pure logic)**

**Files:**
- Modify: `packages/web/package.json`, `pnpm-lock.yaml` (dependency `earcut`)
- Create: `packages/web/src/adapters/webgl/instances.ts`
- Test: `packages/web/test/webgl/instances.test.ts`

`buildFrame(scene)` is pure: no GL, no camera. It returns:
- one `Batch` per non-empty (layer × kind), in layer order and then `KIND_ORDER` (polygon, segment, arc, disc);
- every `text` primitive in scene order, for the overlay.

Positions stay in world metres and widths keep their unit, so the camera is purely uniforms. Instance layouts (floats, in order; the shaders in S1.3 read them this way):

| Kind | Floats | Layout |
|------|-------:|--------|
| polygon (per vertex, earcut triangles) | 6 | x y · r g b a |
| segment | 13 | ax ay bx by · width unit cap · dashOn dashOff · r g b a |
| arc | 11 | cx cy · radius start span · width unit · r g b a |
| disc | 8 | cx cy · radius unit · r g b a |

`unit`: 0 = metres (`UNIT_M`), 1 = CSS px (`UNIT_PX`). `cap`: 0 butt, 1 round. Colours are straight RGBA in 0..1.

The demo-drawing tests import `@fm/editor/testing` (`FakeShell`, `dividedRoomDoc`), which the depcruise rule `only-through-package-index` allows. They expect S1.1's edge segments, which is why this task runs in wave 2.

- [x] **Step 1: Add earcut**

```bash
pnpm --filter @fm/web add 'earcut@^3.2.4'
```

Expected: `packages/web/package.json` gains `"earcut": "^3.2.4"` under `dependencies`, and `pnpm-lock.yaml` changes. No `@types/earcut` is needed: the package ships `src/earcut.d.ts` with `export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[]`.

- [x] **Step 2: Write the failing tests.** Create `packages/web/test/webgl/instances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLORS, type LayerName, type Primitive, type Scene } from "@fm/editor";
import { FakeShell, dividedRoomDoc } from "@fm/editor/testing";
import type { Point } from "@fm/protocol";
import {
  ARC_FLOATS,
  CAP_BUTT,
  CAP_ROUND,
  DISC_FLOATS,
  POLYGON_VERTEX_FLOATS,
  SEGMENT_FLOATS,
  UNIT_M,
  UNIT_PX,
  arcSpan,
  buildFrame,
  dashPair,
  parseColor,
  type Batch,
} from "../../src/adapters/webgl/instances";
import { sceneFixture } from "../fixtures";

const f32 = (values: number[]): number[] => Array.from(new Float32Array(values));
const c = (hex: number): number => hex / 255;

function sceneWith(byLayer: Partial<Record<LayerName, Primitive[]>>): Scene {
  return { layers: sceneFixture().layers.map((l) => ({ ...l, primitives: byLayer[l.name] ?? [] })) };
}

const names = (batches: Batch[]): string[] => batches.map((b) => `${b.layer}/${b.kind}`);

/** Sum of the triangle areas of a polygon batch (x, y are the first two floats of each vertex). */
function triangleArea(batch: Batch): number {
  let sum = 0;
  for (let t = 0; t < batch.count; t += 3) {
    const v = (i: number): Point => ({ x: batch.data[(t + i) * POLYGON_VERTEX_FLOATS] ?? NaN, y: batch.data[(t + i) * POLYGON_VERTEX_FLOATS + 1] ?? NaN });
    const [a, b, d] = [v(0), v(1), v(2)];
    sum += Math.abs((b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y)) / 2;
  }
  return sum;
}

function ringArea(points: readonly Point[]): number {
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twice) / 2;
}

describe("parseColor", () => {
  it("parses #rrggbb and #rrggbbaa as straight RGBA", () => {
    expect(parseColor("#1d1d1f")).toEqual([c(0x1d), c(0x1d), c(0x1f), 1]);
    expect(parseColor("#2563eb99")).toEqual([c(0x25), c(0x63), c(0xeb), c(0x99)]);
  });

  it("parses the short forms", () => {
    expect(parseColor("#e67")).toEqual([c(0xee), c(0x66), c(0x77), 1]);
    expect(parseColor("#e678")).toEqual([c(0xee), c(0x66), c(0x77), c(0x88)]);
  });

  it("draws anything else magenta instead of throwing mid-frame", () => {
    expect(parseColor("red")).toEqual([1, 0, 1, 1]);
    expect(parseColor("#12345")).toEqual([1, 0, 1, 1]);
  });

  it("parses every palette colour", () => {
    for (const value of Object.values(COLORS)) expect(parseColor(value)).not.toEqual([1, 0, 1, 1]);
  });
});

describe("dashPair", () => {
  it("follows Canvas2D setLineDash for the first on/off pair", () => {
    expect(dashPair(undefined)).toEqual([0, 0]);
    expect(dashPair([])).toEqual([0, 0]);
    expect(dashPair([4, 2])).toEqual([4, 2]);
    expect(dashPair([3])).toEqual([3, 3]); // an odd list repeats
    expect(dashPair([4, 2, 1, 1])).toEqual([4, 2]); // longer patterns keep their first pair
  });

  it("treats invalid or empty patterns as solid", () => {
    expect(dashPair([4, -1])).toEqual([0, 0]);
    expect(dashPair([4, Number.NaN])).toEqual([0, 0]);
    expect(dashPair([0, 0])).toEqual([0, 0]);
    expect(dashPair([4, 0])).toEqual([0, 0]);
  });
});

describe("arcSpan", () => {
  it("sweeps counter-clockwise from `from` to `to`", () => {
    expect(arcSpan(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcSpan(Math.PI / 2, 0)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(arcSpan(1, 1)).toBe(0);
  });

  it("is a full circle for a sweep of 2π or more", () => {
    expect(arcSpan(0, 2 * Math.PI)).toBe(2 * Math.PI);
    expect(arcSpan(0, 5 * Math.PI)).toBe(2 * Math.PI);
  });
});

describe("buildFrame", () => {
  it("has no batches and no text for an empty scene", () => {
    expect(buildFrame(sceneFixture())).toEqual({ batches: [], texts: [] });
  });

  it("encodes a segment: ends in metres, width and unit, cap, dash, colour", () => {
    const frame = buildFrame(
      sceneWith({
        walls: [
          { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0.5 }, width: { m: 0.2 }, color: "#111111", cap: "butt" },
          { kind: "segment", a: { x: 2, y: 0 }, b: { x: 2, y: 1 }, width: { px: 1.5 }, color: "#2563eb99", cap: "round", dash: [4, 2] },
        ],
      }),
    );
    expect(frame.batches).toHaveLength(1);
    const batch = frame.batches[0];
    expect(batch?.count).toBe(2);
    expect(Array.from(batch?.data ?? [])).toEqual(
      f32([
        0, 0, 1, 0.5, 0.2, UNIT_M, CAP_BUTT, 0, 0, c(0x11), c(0x11), c(0x11), 1,
        2, 0, 2, 1, 1.5, UNIT_PX, CAP_ROUND, 4, 2, c(0x25), c(0x63), c(0xeb), c(0x99),
      ]),
    );
    expect(batch?.data.length).toBe(2 * SEGMENT_FLOATS);
  });

  it("skips a zero-length butt segment but keeps a zero-length round one (a dot, as in Canvas2D)", () => {
    const p = { x: 1, y: 1 };
    const frame = buildFrame(
      sceneWith({
        overlays: [
          { kind: "segment", a: p, b: p, width: { px: 2 }, color: "#000000", cap: "butt" },
          { kind: "segment", a: p, b: p, width: { px: 2 }, color: "#000000", cap: "round" },
        ],
      }),
    );
    expect(frame.batches.map((b) => b.count)).toEqual([1]);
  });

  it("encodes a disc and an arc", () => {
    const frame = buildFrame(
      sceneWith({
        overlays: [
          { kind: "disc", center: { x: 1, y: 2 }, radius: { px: 5 }, color: "#ffffff" },
          { kind: "arc", center: { x: 0, y: 0 }, radius: 0.5, from: Math.PI / 2, to: 0, width: { px: 1 }, color: "#444444" },
        ],
      }),
    );
    expect(names(frame.batches)).toEqual(["overlays/arc", "overlays/disc"]);
    expect(Array.from(frame.batches[0]?.data ?? [])).toEqual(
      f32([0, 0, 0.5, Math.PI / 2, (3 * Math.PI) / 2, 1, UNIT_PX, c(0x44), c(0x44), c(0x44), 1]),
    );
    expect(frame.batches[0]?.data.length).toBe(ARC_FLOATS);
    expect(Array.from(frame.batches[1]?.data ?? [])).toEqual(f32([1, 2, 5, UNIT_PX, 1, 1, 1, 1]));
    expect(frame.batches[1]?.data.length).toBe(DISC_FLOATS);
  });

  it("skips an empty arc", () => {
    const arc: Primitive = { kind: "arc", center: { x: 0, y: 0 }, radius: 1, from: 1, to: 1, width: { px: 1 }, color: "#000000" };
    expect(buildFrame(sceneWith({ overlays: [arc] })).batches).toEqual([]);
  });

  it("triangulates a polygon into coloured vertices covering its area, and skips degenerate ones", () => {
    const square: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], color: "#dce8f7aa" };
    const line: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: "#000000" };
    const frame = buildFrame(sceneWith({ zoneFills: [square, line] }));
    const batch = frame.batches[0];
    if (!batch) throw new Error("no batch");
    expect(batch.count).toBe(6); // two triangles
    expect(batch.data.length).toBe(6 * POLYGON_VERTEX_FLOATS);
    expect(triangleArea(batch)).toBeCloseTo(4, 9);
    expect(Array.from(batch.data.slice(2, 6))).toEqual(f32([c(0xdc), c(0xe8), c(0xf7), c(0xaa)]));
  });

  it("makes one batch per non-empty (layer × kind): layers in scene order, kinds polygon, segment, arc, disc", () => {
    const seg: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt" };
    const poly: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], color: "#000000" };
    const disc: Primitive = { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 3 }, color: "#000000" };
    const frame = buildFrame(sceneWith({ presence: [disc], walls: [disc, seg, poly, seg], grid: [seg] }));
    expect(names(frame.batches)).toEqual(["grid/segment", "walls/polygon", "walls/segment", "walls/disc", "presence/disc"]);
    expect(frame.batches.map((b) => b.count)).toEqual([1, 3, 2, 1, 1]);
  });

  it("passes text through for the overlay, in scene order, and makes no batch for it", () => {
    const tag: Primitive = { kind: "text", text: "Kitchen", at: { x: 1, y: 1 }, size: 12, color: "#1d1d1f", align: "center", rotation: 0 };
    const name: Primitive = { kind: "text", text: "Bob", at: { x: 2, y: 2 }, size: 11, color: "#0090ff", align: "left", rotation: 0 };
    const frame = buildFrame(sceneWith({ presence: [name], annotations: [tag] }));
    expect(frame.batches).toEqual([]);
    expect(frame.texts).toEqual([tag, name]);
  });
});

describe("buildFrame on the demo drawing", () => {
  /** Demo step 4: the divided room with a zone in each half; the pointer rests away from the drawing. */
  function step4(): FakeShell {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    shell.click({ x: 4.5, y: 2 });
    shell.key("v");
    shell.moveTo({ x: 3, y: -2 });
    return shell;
  }

  it("draws step 4 in 5 draw calls, and the edge segments are the walls' outline edges", () => {
    const scene = step4().scene();
    const frame = buildFrame(scene);
    expect(names(frame.batches)).toEqual(["grid/segment", "zoneFills/polygon", "walls/polygon", "walls/segment", "annotations/polygon"]);
    const walls = scene.layers.find((l) => l.name === "walls")?.primitives ?? [];
    const outlines = walls.flatMap((p) => (p.kind === "polygon" ? [p] : []));
    expect(frame.batches[3]?.count).toBe(outlines.reduce((n, p) => n + p.points.length, 0));
    expect(frame.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["10.64 m²"]));
  });

  it("triangulates every wall outline of the demo drawing, T-junctions included, without losing area", () => {
    const scene = step4().scene();
    const walls = scene.layers.find((l) => l.name === "walls")?.primitives ?? [];
    const outlines = walls.flatMap((p) => (p.kind === "polygon" ? [p] : []));
    const batch = buildFrame(scene).batches.find((b) => b.layer === "walls" && b.kind === "polygon");
    if (!batch) throw new Error("no wall batch");
    expect(outlines).toHaveLength(7);
    expect(triangleArea(batch)).toBeCloseTo(outlines.reduce((a, p) => a + ringArea(p.points), 0), 4); // float32 vertices
  });

  it("draws step 5 (a selected wall with its helper) in 7 draw calls", () => {
    const shell = step4();
    shell.click({ x: 6, y: 1 });
    expect(names(buildFrame(shell.scene()).batches)).toEqual([
      "grid/segment",
      "zoneFills/polygon",
      "walls/polygon",
      "walls/segment",
      "annotations/polygon",
      "annotations/segment",
      "overlays/disc",
    ]);
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/web test test/webgl/instances.test.ts`
Expected: FAIL. `../../src/adapters/webgl/instances` cannot be resolved.

- [x] **Step 4: Implement.** Create `packages/web/src/adapters/webgl/instances.ts`:

```ts
import earcut from "earcut";
import type { LayerName, Primitive, Scene, Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";

// Scene → GPU-ready typed arrays, one batch per non-empty (layer × kind), in draw order. Pure: no GL, no camera.
// Positions stay in world metres and widths keep their unit, so pan and zoom are shader uniforms (spec §6.2).

/** Straight (not premultiplied) RGBA, 0..1. */
export type Rgba = [number, number, number, number];
export type GeometryKind = "polygon" | "segment" | "arc" | "disc";
export type TextPrimitive = Extract<Primitive, { kind: "text" }>;
/** `count` is the number of instances, or of vertices for polygons (drawn as plain triangles). */
export type Batch = { layer: LayerName; kind: GeometryKind; data: Float32Array; count: number };
/** `batches` in draw order (one draw call each); `texts` for the Canvas2D overlay, in scene order. */
export type Frame = { batches: Batch[]; texts: TextPrimitive[] };

/** Within one layer the WebGL renderer draws kinds in this order; Canvas2D draws in scene order. */
export const KIND_ORDER: readonly GeometryKind[] = ["polygon", "segment", "arc", "disc"];

// Floats per instance (per vertex for polygons). The shaders read them in this order.
export const POLYGON_VERTEX_FLOATS = 6; // x y | r g b a
export const SEGMENT_FLOATS = 13; // ax ay bx by | width unit cap | dashOn dashOff | r g b a
export const ARC_FLOATS = 11; // cx cy | radius start span | width unit | r g b a
export const DISC_FLOATS = 8; // cx cy | radius unit | r g b a
const STRIDE: Record<GeometryKind, number> = {
  polygon: POLYGON_VERTEX_FLOATS,
  segment: SEGMENT_FLOATS,
  arc: ARC_FLOATS,
  disc: DISC_FLOATS,
};

export const UNIT_M = 0; // world metres, scaled by zoom
export const UNIT_PX = 1; // CSS pixels, screen-constant
export const CAP_BUTT = 0;
export const CAP_ROUND = 1;

const TAU = 2 * Math.PI;
/** A colour the palette should never produce: drawn loudly instead of throwing inside a frame. */
const BAD_COLOR: Rgba = [1, 0, 1, 1];

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the palette is hex-only, rendering.md); anything else is magenta. */
export function parseColor(color: string): Rgba {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (hex === undefined) return BAD_COLOR;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const channel = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return [channel(0), channel(1), channel(2), full.length === 8 ? channel(3) : 1];
}

function width(w: Width): [number, number] {
  return "px" in w ? [w.px, UNIT_PX] : [w.m, UNIT_M];
}

/**
 * Canvas2D `setLineDash` semantics for the first on/off pair: an odd list repeats, a list with a negative or
 * non-finite entry is ignored (solid), and [0, 0] means solid. Longer patterns keep only their first pair
 * (the editor emits no dashes today).
 */
export function dashPair(dash: readonly number[] | undefined): [number, number] {
  if (dash === undefined || dash.length === 0) return [0, 0];
  if (dash.some((d) => !Number.isFinite(d) || d < 0)) return [0, 0];
  const list = dash.length % 2 === 1 ? [...dash, ...dash] : dash;
  const on = list[0] ?? 0;
  const off = list[1] ?? 0;
  return on > 0 && off > 0 ? [on, off] : [0, 0];
}

/** Counter-clockwise sweep from `from` to `to` in [0, 2π], as Canvas2D draws `arc(-from, -to, anticlockwise)`. */
export function arcSpan(from: number, to: number): number {
  const sweep = to - from;
  if (sweep >= TAU) return TAU;
  return ((sweep % TAU) + TAU) % TAU;
}

function pushPolygon(out: number[], p: Extract<Primitive, { kind: "polygon" }>): void {
  if (p.points.length < 3) return; // Canvas2D skips these too
  const coords = p.points.flatMap((q) => [q.x, q.y]);
  const color = parseColor(p.color);
  for (const i of earcut(coords)) {
    const q = p.points[i];
    if (q) out.push(q.x, q.y, ...color);
  }
}

function pushSegment(out: number[], p: Extract<Primitive, { kind: "segment" }>): void {
  // A zero-length butt segment covers nothing in Canvas2D; a round one is a dot, so it stays.
  if (p.cap === "butt" && p.a.x === p.b.x && p.a.y === p.b.y) return;
  out.push(p.a.x, p.a.y, p.b.x, p.b.y, ...width(p.width), p.cap === "round" ? CAP_ROUND : CAP_BUTT, ...dashPair(p.dash), ...parseColor(p.color));
}

function pushArc(out: number[], p: Extract<Primitive, { kind: "arc" }>): void {
  const span = arcSpan(p.from, p.to);
  if (span === 0) return;
  out.push(p.center.x, p.center.y, p.radius, p.from, span, ...width(p.width), ...parseColor(p.color));
}

function pushDisc(out: number[], p: Extract<Primitive, { kind: "disc" }>): void {
  out.push(p.center.x, p.center.y, ...width(p.radius), ...parseColor(p.color));
}

export function buildFrame(scene: Scene): Frame {
  const batches: Batch[] = [];
  const texts: TextPrimitive[] = [];
  for (const layer of scene.layers) {
    const values: Record<GeometryKind, number[]> = { polygon: [], segment: [], arc: [], disc: [] };
    for (const p of layer.primitives) {
      switch (p.kind) {
        case "polygon":
          pushPolygon(values.polygon, p);
          break;
        case "segment":
          pushSegment(values.segment, p);
          break;
        case "arc":
          pushArc(values.arc, p);
          break;
        case "disc":
          pushDisc(values.disc, p);
          break;
        case "text":
          texts.push(p);
          break;
        default:
          assertNever(p);
      }
    }
    for (const kind of KIND_ORDER) {
      const v = values[kind];
      if (v.length > 0) batches.push({ layer: layer.name, kind, data: new Float32Array(v), count: v.length / STRIDE[kind] });
    }
  }
  return { batches, texts };
}
```

- [x] **Step 5: Run it green**

Run: `pnpm --filter @fm/web test test/webgl/instances.test.ts`
Expected: PASS, 19 tests. The demo tests pin the draw calls: 5 at step 4 and 7 at step 5. The wall-area test compares with 4 decimals, because vertices are float32.

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/web/package.json pnpm-lock.yaml packages/web/src/adapters/webgl/instances.ts packages/web/test/webgl/instances.test.ts
git commit -m "web: WebGL instance builder (Scene to typed arrays per layer and kind, earcut)"
```

**Review focus (wave 2 review):**
- layouts match the table above, and the batch order is correct;
- Canvas2D parity rules: skip polygons under 3 points and zero-length butt segments; the arc sweep matches `ctx.arc(-from, -to, true)`; the dash rules match `setLineDash`;
- `parseColor` never throws;
- `assertNever` in the switch;
- nothing claims more than the tests show.

---

## Task S1.3: WebGL2 backend with a Canvas2D text overlay

**Wave 3 · Size M · no review (GL glue; S1.4's Playwright probes test it)**

**Files:**
- Create: `packages/web/src/adapters/webgl/shaders.ts`, `packages/web/src/adapters/webgl-renderer.ts`
- Modify: `packages/web/src/adapters/canvas2d-renderer.ts`, `packages/web/test/canvas2d-renderer.test.ts`

Vitest runs in Node, where WebGL does not exist. The GL code stays thin, and only `drawTextOverlay` gets a unit test. S1.4 checks the renderer in Chromium.

How it draws:
- **Coordinates.** Each vertex shader maps world metres to local CSS px, `(world − centre) · zoom` (y up), then to clip space, `local / (viewport / 2)`.
- **Coverage.** Fragment shaders compute an exact distance `d` in CSS px, and coverage is `clamp(0.5 − d · dpr, 0, 1)`.
- **Blending.** Output is premultiplied, with `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`.
- **Polygons** are flat triangles, antialiased by MSAA only (`antialias: true`).
- **Draw calls.** One per batch (`drawArraysInstanced` over a 4-vertex strip; `drawArrays(TRIANGLES)` for polygons), with the instance buffer re-uploaded (`bufferData`, `DYNAMIC_DRAW`).
- **Frames.** Latest scene wins, at most one draw per animation frame, like Canvas2D. `buildFrame` reruns only for a new Scene object.
- **Context loss.** `webglcontextlost` calls `onLost` and stops drawing. There is no restore.
- **`dispose`** deletes programs and buffers but never calls `loseContext`: toggling back must be able to reuse the canvas's context.

- [x] **Step 1: Write the failing overlay test.** In `packages/web/test/canvas2d-renderer.test.ts`:

Change the import line to:

```ts
import { backingSize, drawPrimitive, drawScene, drawTextOverlay, type DrawContext } from "../src/adapters/canvas2d-renderer";
```

Add this method to `RecordingContext`, after `fillRect`:

```ts
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`clearRect ${f(x)} ${f(y)} ${f(w)} ${f(h)}`);
  }
```

Add this block before `describe("backingSize", …)`:

```ts
describe("drawTextOverlay", () => {
  it("scales by dpr, clears to transparent, then draws the texts in order", () => {
    const ctx = new RecordingContext();
    const texts: Primitive[] = [
      { kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "center", rotation: 0 },
      { kind: "text", text: "Bob", at: { x: 0, y: 0 }, size: 11, color: "#0090ff", align: "left", rotation: 0 },
    ];
    drawTextOverlay(ctx, texts, cameraFixture);
    expect(ctx.calls.slice(0, 3)).toEqual(["save", "scale 2.00 2.00", "clearRect 0.00 0.00 200.00 100.00"]);
    const fills = ctx.calls.filter((c) => c.startsWith("fillText"));
    expect(fills).toHaveLength(2);
    expect(fills[0]).toContain('"Kitchen" 0.00 0.00');
    expect(fills[1]).toContain('"Bob" 0.00 0.00');
    expect(ctx.calls.indexOf("translate 200.00 50.00")).toBeLessThan(ctx.calls.indexOf("translate 100.00 50.00"));
    expect(ctx.calls.at(-1)).toBe("restore");
    expect(ctx.calls.some((c) => c.startsWith("fillRect"))).toBe(false);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/web test test/canvas2d-renderer.test.ts`
Expected: FAIL in "drawTextOverlay › scales by dpr, clears to transparent…", with `drawTextOverlay is not a function` (or a missing-export error). The other tests pass.

- [x] **Step 3: Implement the overlay helper and the canvas attribute change.** In `packages/web/src/adapters/canvas2d-renderer.ts`:

Add to the `DrawContext` interface, after `fillRect`:

```ts
  clearRect(x: number, y: number, w: number, h: number): void;
```

Add before `backingSize`:

```ts
/**
 * WebGL mode: the Canvas2D canvas becomes a transparent overlay that shows only text, above all geometry
 * (spec §6.1). Clears it, then draws the text primitives in scene order.
 */
export function drawTextOverlay(ctx: DrawContext, texts: readonly Primitive[], camera: Camera): void {
  ctx.save();
  ctx.scale(camera.dpr, camera.dpr);
  ctx.clearRect(0, 0, camera.viewport.width, camera.viewport.height);
  for (const p of texts) drawPrimitive(ctx, p, camera);
  ctx.restore();
}
```

In `createCanvas2DRenderer`, replace `const ctx = canvas.getContext("2d", { alpha: false });` with:

```ts
  // Not `alpha: false`: under WebGL the same canvas is the transparent text overlay, and a canvas keeps the
  // attributes of its first getContext call. drawScene paints an opaque background, so nothing shows through.
  const ctx = canvas.getContext("2d");
```

- [x] **Step 4: Run it green**

Run: `pnpm --filter @fm/web test test/canvas2d-renderer.test.ts`
Expected: PASS, 13 tests.

- [x] **Step 5: Write the shaders.** Create `packages/web/src/adapters/webgl/shaders.ts`:

```ts
// GLSL ES 3.00 sources for the WebGL2 renderer (spec §6.2). Instance layouts match instances.ts.
//
// Spaces: world metres (y up) → "local" CSS px = (world − centre) · zoom, still y up, origin at the viewport
// centre → clip = local / (viewport / 2). Distances in the fragment shaders are local CSS px, so one device pixel
// is 1 / dpr of them: coverage = clamp(0.5 − d · dpr, 0, 1) is the spec's 0.5 − d / fwidth(d) for these exact
// distance fields, without derivatives. Colours come in straight; outputs are premultiplied (blend ONE,
// ONE_MINUS_SRC_ALPHA).

const CAMERA = `
uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_half;
vec2 toLocal(vec2 world) { return (world - u_center) * u_zoom; }
vec4 toClip(vec2 local) { return vec4(local / u_half, 0.0, 1.0); }
float toPx(float value, float unit) { return unit > 0.5 ? value : value * u_zoom; }
`;

const COVERAGE = `
uniform float u_dpr;
out vec4 outColor;
void shade(float d, vec4 color) {
  float coverage = clamp(0.5 - d * u_dpr, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  outColor = vec4(color.rgb * color.a * coverage, color.a * coverage);
}
`;

/** 1 CSS px of margin around every quad, so the antialiased fringe is never clipped. */
const PAD = "1.0";

export const POLYGON_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec4 a_color;
${CAMERA}
out vec4 v_color;
void main() {
  gl_Position = toClip(toLocal(a_position));
  v_color = a_color;
}
`;

export const POLYGON_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}
`;

export const SEGMENT_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_ends;
layout(location = 2) in vec3 i_style;
layout(location = 3) in vec2 i_dash;
layout(location = 4) in vec4 i_color;
${CAMERA}
out vec2 v_p;
flat out float v_length;
flat out float v_halfWidth;
flat out float v_round;
flat out vec2 v_dash;
flat out vec4 v_color;
void main() {
  vec2 a = toLocal(i_ends.xy);
  vec2 b = toLocal(i_ends.zw);
  float len = length(b - a);
  vec2 dir = len > 0.0 ? (b - a) / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = 0.5 * toPx(i_style.x, i_style.y);
  float pad = hw + ${PAD};
  vec2 p = vec2(mix(-pad, len + pad, a_corner.x * 0.5 + 0.5), a_corner.y * pad);
  gl_Position = toClip(a + dir * p.x + nrm * p.y);
  v_p = p;
  v_length = len;
  v_halfWidth = hw;
  v_round = i_style.z;
  v_dash = i_dash;
  v_color = i_color;
}
`;

export const SEGMENT_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_length;
flat in float v_halfWidth;
flat in float v_round;
flat in vec2 v_dash;
flat in vec4 v_color;
${COVERAGE}
void main() {
  // v_p: x along the segment from a, y across it, in CSS px.
  float along = clamp(v_p.x, 0.0, v_length);
  float roundD = length(v_p - vec2(along, 0.0)) - v_halfWidth;
  vec2 q = vec2(abs(v_p.x - 0.5 * v_length) - 0.5 * v_length, abs(v_p.y) - v_halfWidth);
  float buttD = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float d = v_round > 0.5 ? roundD : buttD;
  // Dashes start at a, like Canvas2D; their ends are cut without antialiasing.
  if (v_dash.x > 0.0 && mod(max(v_p.x, 0.0), v_dash.x + v_dash.y) > v_dash.x) discard;
  shade(d, v_color);
}
`;

export const ARC_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 i_center;
layout(location = 2) in vec3 i_shape;
layout(location = 3) in vec2 i_width;
layout(location = 4) in vec4 i_color;
${CAMERA}
out vec2 v_p;
flat out float v_radius;
flat out float v_halfWidth;
flat out float v_start;
flat out float v_span;
flat out vec4 v_color;
void main() {
  float radius = i_shape.x * u_zoom;
  float hw = 0.5 * toPx(i_width.x, i_width.y);
  vec2 p = a_corner * (radius + hw + ${PAD});
  gl_Position = toClip(toLocal(i_center) + p);
  v_p = p;
  v_radius = radius;
  v_halfWidth = hw;
  v_start = i_shape.y;
  v_span = i_shape.z;
  v_color = i_color;
}
`;

export const ARC_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_radius;
flat in float v_halfWidth;
flat in float v_start;
flat in float v_span;
flat in vec4 v_color;
${COVERAGE}
void main() {
  float ring = abs(length(v_p) - v_radius) - v_halfWidth;
  // Butt ends: the ring cut by the wedge from v_start, counter-clockwise by v_span (world y up, like v_p).
  vec2 s = vec2(cos(v_start), sin(v_start));
  vec2 e = vec2(cos(v_start + v_span), sin(v_start + v_span));
  float afterStart = dot(v_p, vec2(s.y, -s.x));
  float beforeEnd = dot(v_p, vec2(-e.y, e.x));
  float wedge = v_span >= 6.2831 ? -1e6 : (v_span <= 3.14159265 ? max(afterStart, beforeEnd) : min(afterStart, beforeEnd));
  shade(max(ring, wedge), v_color);
}
`;

export const DISC_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 i_center;
layout(location = 2) in vec2 i_radius;
layout(location = 3) in vec4 i_color;
${CAMERA}
out vec2 v_p;
flat out float v_radius;
flat out vec4 v_color;
void main() {
  float radius = toPx(i_radius.x, i_radius.y);
  vec2 p = a_corner * (radius + ${PAD});
  gl_Position = toClip(toLocal(i_center) + p);
  v_p = p;
  v_radius = radius;
  v_color = i_color;
}
`;

export const DISC_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_radius;
flat in vec4 v_color;
${COVERAGE}
void main() {
  shade(length(v_p) - v_radius, v_color);
}
`;
```

Each source must start with `#version 300 es` on its first line; the template literals open directly on it.

- [x] **Step 6: Write the renderer.** Create `packages/web/src/adapters/webgl-renderer.ts`:

```ts
import { COLORS, type Camera, type Scene } from "@fm/editor";
import { backingSize, drawTextOverlay } from "./canvas2d-renderer";
import type { Renderer } from "./renderer";
import {
  ARC_FLOATS,
  DISC_FLOATS,
  KIND_ORDER,
  POLYGON_VERTEX_FLOATS,
  SEGMENT_FLOATS,
  buildFrame,
  parseColor,
  type Frame,
  type GeometryKind,
} from "./webgl/instances";
import { ARC_FS, ARC_VS, DISC_FS, DISC_VS, POLYGON_FS, POLYGON_VS, SEGMENT_FS, SEGMENT_VS } from "./webgl/shaders";

// WebGL2 renderer (spec §6.2): geometry on `glCanvas`, text on the Canvas2D `overlay` stacked above it (spec §6.1).
// Thin glue over the pure `buildFrame`; it is exercised in Playwright (e2e/renderers.spec.ts), not in Vitest.

type Uniforms = { center: WebGLUniformLocation | null; zoom: WebGLUniformLocation | null; half: WebGLUniformLocation | null; dpr: WebGLUniformLocation | null };
type Program = { program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer; uniforms: Uniforms };
type Programs = Record<GeometryKind, Program>;
/** One attribute: its shader location, float count and float offset inside the instance (or vertex). */
type Attribute = [location: number, size: number, offset: number];

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]); // triangle strip, corners in [-1, 1]²

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader) ?? "no log"}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? "no log"}`);
  }
  return program;
}

/** A program with its VAO: instanced kinds read the shared quad at location 0 and one instance per quad. */
function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string, stride: number, attributes: Attribute[], quad: WebGLBuffer | null): Program {
  const program = link(gl, vs, fs);
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  if (quad !== null) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [location, size, offset] of attributes) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    if (quad !== null) gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  return { program, vao, buffer, uniforms: { center: at("u_center"), zoom: at("u_zoom"), half: at("u_half"), dpr: at("u_dpr") } };
}

function createPrograms(gl: WebGL2RenderingContext): { programs: Programs; quad: WebGLBuffer } {
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  const programs: Programs = {
    polygon: makeProgram(gl, POLYGON_VS, POLYGON_FS, POLYGON_VERTEX_FLOATS, [[0, 2, 0], [1, 4, 2]], null),
    segment: makeProgram(gl, SEGMENT_VS, SEGMENT_FS, SEGMENT_FLOATS, [[1, 4, 0], [2, 3, 4], [3, 2, 7], [4, 4, 9]], quad),
    arc: makeProgram(gl, ARC_VS, ARC_FS, ARC_FLOATS, [[1, 2, 0], [2, 3, 2], [3, 2, 5], [4, 4, 7]], quad),
    disc: makeProgram(gl, DISC_VS, DISC_FS, DISC_FLOATS, [[1, 2, 0], [2, 2, 2], [3, 4, 4]], quad),
  };
  return { programs, quad };
}

function deletePrograms(gl: WebGL2RenderingContext, programs: Programs, quad: WebGLBuffer): void {
  for (const kind of KIND_ORDER) {
    const p = programs[kind];
    gl.deleteProgram(p.program);
    gl.deleteVertexArray(p.vao);
    gl.deleteBuffer(p.buffer);
  }
  gl.deleteBuffer(quad);
}

/** One draw call per batch, in the frame's order (layers, then kinds within a layer). */
function drawGeometry(gl: WebGL2RenderingContext, programs: Programs, frame: Frame, camera: Camera, size: { width: number; height: number }): void {
  const [r, g, b] = parseColor(COLORS.background);
  gl.viewport(0, 0, size.width, size.height);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const batch of frame.batches) {
    const p = programs[batch.kind];
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.center, camera.center.x, camera.center.y);
    gl.uniform1f(p.uniforms.zoom, camera.zoom);
    gl.uniform2f(p.uniforms.half, camera.viewport.width / 2, camera.viewport.height / 2);
    gl.uniform1f(p.uniforms.dpr, camera.dpr);
    gl.bindVertexArray(p.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.DYNAMIC_DRAW);
    if (batch.kind === "polygon") gl.drawArrays(gl.TRIANGLES, 0, batch.count);
    else gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
  }
  gl.bindVertexArray(null);
}

function fit(canvas: HTMLCanvasElement, size: { width: number; height: number }): void {
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
}

/**
 * The WebGL2 renderer, or null when WebGL2 (or a shader) is unavailable: the caller then keeps Canvas2D.
 * `onLost` runs on `webglcontextlost`; there is no restore (the switch falls back to Canvas2D).
 * Like Canvas2D it draws at most once per animation frame, the latest scene winning; the frame's buffers are
 * rebuilt only for a new Scene object, which in practice is every editor event (the editor rebuilds its Scene).
 */
export function createWebGLRenderer(glCanvas: HTMLCanvasElement, overlay: HTMLCanvasElement, onLost: () => void): Renderer | null {
  const gl = glCanvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: true });
  const text = overlay.getContext("2d");
  if (gl === null || gl.isContextLost() || text === null) return null;
  let made: { programs: Programs; quad: WebGLBuffer };
  try {
    made = createPrograms(gl);
  } catch (error) {
    console.error(error);
    return null;
  }
  const { programs, quad } = made;
  let pending: { scene: Scene; camera: Camera } | null = null;
  let frame: number | null = null;
  let built: { scene: Scene; frame: Frame } | null = null;
  let lost = false;

  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };
  const onContextLost = (): void => {
    lost = true;
    cancel();
    onLost();
  };
  glCanvas.addEventListener("webglcontextlost", onContextLost);

  const draw = (): void => {
    frame = null;
    if (pending === null || lost) return;
    const { scene, camera } = pending;
    pending = null;
    if (built === null || built.scene !== scene) built = { scene, frame: buildFrame(scene) };
    const size = backingSize(camera);
    fit(glCanvas, size);
    fit(overlay, size);
    drawGeometry(gl, programs, built.frame, camera, size);
    drawTextOverlay(text, built.frame.texts, camera);
  };

  return {
    render(scene, camera) {
      if (lost) return;
      pending = { scene, camera };
      if (frame === null) frame = requestAnimationFrame(draw);
    },
    dispose() {
      cancel();
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      if (!gl.isContextLost()) deletePrograms(gl, programs, quad);
      built = null;
    },
  };
}
```

The attribute tables in `createPrograms` follow the layouts in `instances.ts`. For example, segment `[[1, 4, 0], [2, 3, 4], [3, 2, 7], [4, 4, 9]]` means `i_ends` (4 floats at offset 0), `i_style` (3 at 4), `i_dash` (2 at 7) and `i_color` (4 at 9), within a 13-float stride. Location 0 is the shared unit quad.

- [x] **Step 7: Check and commit**

```bash
pnpm check
```

Expected: pass. Nothing imports `webgl-renderer.ts` yet; `pnpm typecheck` covers it, and S1.4 wires and tests it.

```bash
git add packages/web/src/adapters/webgl/shaders.ts packages/web/src/adapters/webgl-renderer.ts packages/web/src/adapters/canvas2d-renderer.ts packages/web/test/canvas2d-renderer.test.ts
git commit -m "web: WebGL2 SDF renderer with a Canvas2D text overlay"
```

---

## Task S1.4: Wire WebGL into the toggle; fallback and pixel probes

**Wave 4 · Size S · no review**

**Files:**
- Modify: `packages/web/src/main.tsx`
- Create: `packages/web/e2e/support/pixels.ts`, `packages/web/e2e/renderers.spec.ts`

Each probe takes a 1 × 1 page screenshot at a world point and decodes it in the page. It therefore reads the **composited** pixel, both canvases as the user sees them, and needs no PNG library. The probes check "the right colour is there" with a tolerance of 12 per channel, and they poll, because frames land on the next animation frame. They do not require pixel parity.

- [x] **Step 1: Write the failing probes.** Create `packages/web/e2e/support/pixels.ts`:

```ts
import { expect, type Locator, type Page } from "@playwright/test";
import { toScreen, type WorldPoint } from "./canvas";

/** The composited colour (both canvases, as the user sees them) of the page pixel at a world point, as [r, g, b]. */
export async function pixelAt(page: Page, canvas: Locator, p: WorldPoint): Promise<number[]> {
  const s = await toScreen(canvas, p);
  const png = await page.screenshot({ clip: { x: Math.floor(s.x), y: Math.floor(s.y), width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString("base64"));
}

/** Channel-wise distance to a `#rrggbb` colour. */
export function distance(rgb: number[], hex: string): number {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...want.map((w, i) => Math.abs(w - (rgb[i] ?? -1000))));
}

/** Waits (frames are drawn on the next animation frame) until the pixel is within `tolerance` of `hex`. */
export async function expectPixel(page: Page, canvas: Locator, p: WorldPoint, hex: string, tolerance = 12): Promise<void> {
  await expect.poll(async () => distance(await pixelAt(page, canvas, p), hex), { message: `pixel at (${p.x}, ${p.y}) ≈ ${hex}` }).toBeLessThanOrEqual(tolerance);
}
```

Create `packages/web/e2e/renderers.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRoomWithDivider, moveTo, typeLength } from "./support/canvas";
import { expectPixel } from "./support/pixels";

// S1 (spec §1.4 step 10, §6.2): the WebGL2 renderer and the live toggle. Local mode (`server=off`).
// Probes read composited page pixels; they check "the right colour is there", not pixel parity between renderers.

const WALL_CENTRE = { x: 1.5, y: 0 }; // bottom wall, 16 px thick at the default zoom
const RIGHT_WALL_CENTRE = { x: 6, y: 1 };
const EMPTY_FLOOR = { x: 1.37, y: 2.13 }; // inside the left room, between grid lines; no zone yet

const canvasOf = (page: Page) => page.getByTestId("canvas");
const toggle = (page: Page) => page.locator('[data-action="renderer"]');

async function open(page: Page, renderer: "canvas2d" | "webgl"): Promise<void> {
  await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
  await expect(canvasOf(page)).toBeVisible();
}

for (const renderer of ["canvas2d", "webgl"] as const) {
  test(`${renderer}: walls are wall-coloured and the floor shows the background`, async ({ page }) => {
    await open(page, renderer);
    await expect(toggle(page)).toHaveText(renderer === "webgl" ? "WebGL" : "Canvas2D");
    await expect(page.getByTestId("renderer-notice")).toHaveCount(0);
    await drawRoomWithDivider(page, canvasOf(page));
    await moveTo(page, canvasOf(page), { x: 8, y: -1 }); // keep snap glyphs away from the probes
    await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall);
    await expectPixel(page, canvasOf(page), RIGHT_WALL_CENTRE, COLORS.wall);
    await expectPixel(page, canvasOf(page), EMPTY_FLOOR, COLORS.background);
  });
}

test("toggling mid-drawing keeps the drawing and the wall chain", async ({ page }) => {
  await open(page, "canvas2d");
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 3, y: 0 });
  await typeLength(page, "6");

  await toggle(page).click(); // → WebGL, while the chain waits for its next point
  await expect(toggle(page)).toHaveText("WebGL");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expectPixel(page, canvas, WALL_CENTRE, COLORS.wall);
  await expect(page.getByTestId("command-bar")).toContainText("Next point or length");

  await moveTo(page, canvas, { x: 6, y: 2 });
  await typeLength(page, "4");
  await toggle(page).click(); // → Canvas2D
  await expect(toggle(page)).toHaveText("Canvas2D");
  await expectPixel(page, canvas, RIGHT_WALL_CENTRE, COLORS.wall);
  await page.keyboard.press("Enter"); // an empty Enter ends the chain
  await page.keyboard.up("Shift");

  await page.keyboard.press("v");
  await clickAt(page, canvas, RIGHT_WALL_CENTRE);
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("4.00");
});

test("falls back to Canvas2D with a notice when WebGL2 is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === "webgl2" ? null : Reflect.apply(original, this, [type, ...rest]);
      },
    });
  });
  await open(page, "webgl");
  await expect(page.getByTestId("renderer-notice")).toHaveText("WebGL2 is unavailable: drawing with Canvas2D");
  await expect(toggle(page)).toHaveText("Canvas2D");
  await drawRoomWithDivider(page, canvasOf(page));
  await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall);
});

test("falls back to Canvas2D, keeping the drawing, when the WebGL context is lost", async ({ page }) => {
  await open(page, "webgl");
  await drawRoomWithDivider(page, canvasOf(page));
  await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall);
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gl-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no WebGL canvas");
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByTestId("renderer-notice")).toHaveText("WebGL context lost: drawing with Canvas2D");
  await expect(toggle(page)).toHaveText("Canvas2D");
  await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall); // the last scene, redrawn by Canvas2D
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/web exec playwright test e2e/renderers.spec.ts`
Expected: FAIL, 3 of 5 tests:
- "webgl: walls are wall-coloured…": the toggle reads "Canvas2D", not "WebGL";
- "toggling mid-drawing…": the toggle stays "Canvas2D";
- "…when the WebGL context is lost": no WebGL canvas context yet, so the notice reads "unavailable".

"canvas2d: …" and "falls back … unavailable" already pass.

- [x] **Step 3: Implement.** In `packages/web/src/main.tsx`, add the import after the timers import:

```ts
import { createWebGLRenderer } from "./adapters/webgl-renderer";
```

rename the parameter `_glCanvas` to `glCanvas` in `mountCanvas`, and replace the attach block:

```ts
  // No WebGL renderer yet (S1.3): ?renderer=webgl falls back to Canvas2D with a notice.
  const detachRenderer = rendererSwitch.attach({ canvas2d: () => createCanvas2DRenderer(canvas), webgl: () => null }, runner.setRenderer);
```

with:

```ts
  // Under WebGL, `canvas` (on top, taking input) becomes the transparent text overlay over `glCanvas`.
  const detachRenderer = rendererSwitch.attach(
    { canvas2d: () => createCanvas2DRenderer(canvas), webgl: (onLost) => createWebGLRenderer(glCanvas, canvas, onLost) },
    runner.setRenderer,
  );
```

The resulting `main.tsx`, in full:

```tsx
import { createRoot } from "react-dom/client";
import { initialState } from "@fm/editor";
import { attachInput } from "./adapters/input";
import { createCanvas2DRenderer } from "./adapters/canvas2d-renderer";
import { createEffectRunner } from "./adapters/effect-runner";
import { createTimers } from "./adapters/timers";
import { createWebGLRenderer } from "./adapters/webgl-renderer";
import { createWebHost } from "./adapters/web-host";
import { createWsServer, serverSink } from "./adapters/ws-server";
import { App } from "./app";
import { displayNameFrom, serverUrlFrom, tabClientId } from "./identity";
import { createRendererSwitch, rendererFrom } from "./renderer-switch";
import { createEditorStore } from "./store";
import "./styles.css";

// Composition root. Server mode when a server URL is known (?server= or VITE_SERVER_URL), otherwise
// local mode: one unsaved LocalDocument and no project list (spec §7.0, §10 step 4).
const host = createWebHost();
const clientId = tabClientId(sessionStorage, () => crypto.randomUUID());
const name = displayNameFrom(location.search);
const serverUrl = serverUrlFrom(location.search, import.meta.env.VITE_SERVER_URL);
const initial = initialState(
  {
    mode: serverUrl === null ? "local" : "server",
    me: { clientId, name },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
  },
  host,
);
const store = createEditorStore({ initial, host });
const timers = createTimers(store.dispatch);
// Canvas2D unless ?renderer=webgl (spec §1.4 step 10); the toolbar toggles it live.
const rendererSwitch = createRendererSwitch(rendererFrom(location.search));

function mountCanvas(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement): () => void {
  // The socket opens asynchronously, so the runner below is in place before any server event arrives.
  const server = serverUrl === null ? null : createWsServer({ url: serverUrl, clientId, name, dispatch: store.dispatch });
  const runner = createEffectRunner({
    timers,
    server: server === null ? null : serverSink(server),
    onView: store.publishView,
  });
  store.setRunner(runner.run);
  // Under WebGL, `canvas` (on top, taking input) becomes the transparent text overlay over `glCanvas`.
  const detachRenderer = rendererSwitch.attach(
    { canvas2d: () => createCanvas2DRenderer(canvas), webgl: (onLost) => createWebGLRenderer(glCanvas, canvas, onLost) },
    runner.setRenderer,
  );
  const detach = attachInput(canvas, store.dispatch); // sends viewportResized at once → first frame
  return () => {
    detach();
    server?.close();
    store.setRunner(() => {});
    detachRenderer();
  };
}

// Work that closing the tab would lose (spec §7.0, §7.7): local edits, or a submission whose outcome is unknown.
window.addEventListener("beforeunload", (e) => {
  if (store.getView().project?.dirty === true) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing");
createRoot(root).render(<App store={store} renderer={rendererSwitch} mountCanvas={mountCanvas} serverMode={serverUrl !== null} />);
```

- [x] **Step 4: Run it green**

Run: `pnpm --filter @fm/web exec playwright test e2e/renderers.spec.ts`
Expected: PASS, 5 tests. If "webgl: …" fails with the "unavailable" notice, headless Chromium has no WebGL2. Check it with `chrome://gpu`, or with `document.createElement("canvas").getContext("webgl2")` in a Playwright page. If needed, add `launchOptions: { args: ["--enable-unsafe-swiftshader"] }` to the Chromium project in `playwright.config.ts`, and log it in the sprint log. Planning needed no flags with Playwright 1.63.

- [x] **Step 5: Full e2e and check**

```bash
pnpm check
pnpm e2e
```

Expected: `pnpm check` passes. `pnpm e2e` gives 7 passed (smoke 1, collaboration 1, renderers 5) and 1 skipped (screenshots).

- [ ] **Step 6: Hand check (2 minutes).** (moved to the gate: the user's live toggle check)
  1. `pnpm demo`, then open `http://localhost:5173/?name=Alice`.
  2. Draw the room.
  3. Click the toolbar button: it reads "WebGL" and the drawing looks the same.
  4. Draw a wall under WebGL, then toggle back.
  5. Reload with `&renderer=webgl`: it starts in WebGL.

  Note anything odd for the sprint log.

- [x] **Step 7: Commit**

```bash
git add packages/web/src/main.tsx packages/web/e2e/support/pixels.ts packages/web/e2e/renderers.spec.ts
git commit -m "web: WebGL renderer behind the toggle, with fallback and pixel probes"
```

---

## Task S1.5: References for both renderers, rehearsal step 10, honest docs

**Wave 4 (after S1.4) · Size S · no review · docs**

**Files:**
- Create/replace: `docs/reports/screenshots/canvas2d/*.png`, `docs/reports/screenshots/webgl/*.png`
- Modify:
  - `docs/reports/demo-rehearsal.md`, `README.md`;
  - `docs/specs/flatmate-design.md` (§11 item 2 marker; §6.2 only if the code differs);
  - `docs/design-memory/rendering.md`, `docs/design-memory/implementation.md`, `docs/design-memory/INDEX.md`;
  - `docs/plans/flatmate-s1/README.md` (progress, sprint log)

M1 may have edited the same documents. Re-read each file first and keep M1's lines.

- [ ] **Step 1: Shoot both sets.** With `pnpm demo` running in a second terminal:

```bash
pnpm screenshots
FM_RENDERER=webgl pnpm screenshots
ls docs/reports/screenshots/canvas2d docs/reports/screenshots/webgl
```

Expected: each run prints `1 passed`, and each folder has the same five file names. The `canvas2d/` set now includes S1.1's wall edges; git history keeps the S1.0a originals for comparison. Open the pairs side by side and note visible differences for gate question 1.

- [ ] **Step 2: Rehearsal step 10.** In `docs/reports/demo-rehearsal.md`:

In the pre-flight list, add:

```markdown
- [ ] the renderer button (toolbar, right) reads "Canvas2D"; no renderer notice is shown
```

In the Steps table, add after row 9 (keep any row M1 added for its part of step 10):

```markdown
| 10 (S1) | Alice: click the renderer button (toolbar, right); drag a joint; click it again | button reads "WebGL", drawing unchanged, the drag works; back to "Canvas2D" | a notice "WebGL2 is unavailable" or "context lost": stay on Canvas2D and say WebGL is not available on this machine | 0:20 | | |
```

Run steps 1–10 once as a dry run and fill the Run 1 column for row 10 (or add a "Run 3 (S1 dry run)" note under Notes).

- [ ] **Step 3: README.** In `README.md`:

Under "Run it", after the Alice/Bob links, add:

```markdown
The toolbar's renderer button switches between Canvas2D (the default) and a WebGL2 renderer live; `?renderer=webgl` starts with WebGL. If WebGL2 is missing or its context is lost, the app falls back to Canvas2D and says so.
```

In the command table, add:

```markdown
| `pnpm screenshots` | while `pnpm demo` runs: five demo screenshots into `docs/reports/screenshots/canvas2d/` (`FM_RENDERER=webgl` for `webgl/`) |
```

In the Testing table, replace the Web row's "What is tested" text with:

```markdown
Vitest for the adapters, panels, renderer switch and the WebGL instance builder; Playwright in Chromium: draw the demo room with typed lengths, two windows editing one project, and pixel probes of both renderers (toggle mid-drawing, fallback on missing WebGL2 or a lost context)
```

Replace the Limits sentence `Rendering is Canvas2D only; there is no WebGL renderer yet.` with:

```markdown
The WebGL2 renderer draws segments, arcs and discs with signed-distance antialiasing and polygons with MSAA; wall edges are antialiased by 1 px edge segments. Text stays on a Canvas2D overlay, so under WebGL all text sits above all geometry. It is compared with Canvas2D by eye and by a few pixel probes, not pixel for pixel, and its speed has not been measured.
```

Update the next sentence about §11: WebGL is done, and follow the current §11 order. For example: `Of the spec's follow-up list (§11), the WebGL2 renderer is implemented; the others are not.` If M1 is also done, say so.

If a frame time was measured (gate question 3), add it with its method; otherwise add nothing about speed.

- [ ] **Step 4: Spec.** The §6.2 design, the §5.2 tree line and the draw-call counts were written into the spec before implementation (commit `bbfd448`). In `docs/specs/flatmate-design.md`:
  - §11 item 2: append ` Done (gate S1).`
  - If the implementation differs from §6.2 (coverage, draw-call counts, kind order, canvases, toggle, fallback), change §6.2 to match and list the difference in the gate report.

- [ ] **Step 5: Design memory.**

In `docs/design-memory/rendering.md` → Decisions, replace the row "S1 design fixed in the spec before coding (2026-09-29 …)" with these rows (date = commit date):

```markdown
| Renderer choice is shell-only: `RendererSwitch` (toolbar button, `?renderer=webgl|canvas2d`), default Canvas2D; WebGL2 missing or context lost → Canvas2D plus a toolbar notice, no restore; the effect runner's `setRenderer` redraws the last scene at once (S1) | The editor never knows which renderer draws; the demo never depends on WebGL | §1.4, §6.2 |
| Two stacked canvases: `gl-canvas` (WebGL2, no input) under `canvas` (input; Canvas2D, or the transparent text overlay under WebGL). The 2D context has no `alpha: false` (S1) | A canvas keeps the context type and attributes of its first `getContext` call | §6.1, §6.2 |
| WebGL draws one call per non-empty (layer × kind), kinds polygon → segment → arc → disc within a layer; 5 draw calls at demo step 4, 7 at step 5, at most 9 pairs today (S1, builder tests) | Computed, not estimated | §6.2 |
| SDF coverage is `clamp(0.5 − d·dpr, 0, 1)` with `d` in CSS px (S1) | Exact distances make it equal to `d / fwidth(d)` without derivatives in branches | §6.2 |
| Wall edges: `{ px: 1 }`, round caps, fill colour; translucent walls (preview) get a slightly darker rim from the overlap (S1) | Round caps close outer miter corners; the rim is accepted | §6.2 |
```

In Don't, the draw-call line was already corrected (`bbfd448`); keep it and add the other three lines below:

```markdown
- Don't quote a draw-call estimate: it is one per non-empty (layer × kind), computed as 5 (demo step 4) and 7 (step 5), at most 9 today; "about 10–15" was wrong (S1).
- Don't call `loseContext()` when disposing the WebGL renderer: the canvas keeps that lost context, and toggling back could never get a working one.
- Don't give the input canvas `alpha: false`: under WebGL it is the transparent text overlay.
- Don't claim pixel parity or speed for WebGL: it is compared by eye and by pixel probes; speed is not measured unless the gate report says how.
```

In `docs/design-memory/implementation.md` → Decisions, add:

```markdown
| `earcut` ^3.2.4 is a dependency of `@fm/web` only (bundled types, no `@types`); `buildFrame` is pure and tested in Vitest, GL code is exercised only in Playwright (S1) | Vitest runs in Node, which has no WebGL | S1 plan |
| Playwright pixel probes read the composited page (1 × 1 screenshot decoded in the page), with a tolerance and `expect.poll`; headless Chromium (Playwright 1.63) runs WebGL2 on SwiftShader without launch flags (verified 2026-09-29) | Both canvases are checked as the user sees them; no PNG library | S1 plan |
| Screenshots: `pnpm screenshots` (needs `pnpm demo`), `FM_RENDERER=webgl` for the WebGL set; images in `docs/reports/screenshots/<renderer>/` (S1, restores Task 8.6) | Visual references for the renderer comparison | S1 plan |
```

In `docs/design-memory/INDEX.md`, replace the Rendering row summary with `Scene port with fixed units; render effect carries the camera; Canvas2D is the default and demo-critical; WebGL2 SDF renderer behind a shell-only live toggle with Canvas2D fallback; text always on a Canvas2D overlay; walls draw 1 px edge segments`, and set "Last updated" to the commit date.

- [ ] **Step 6: Plan bookkeeping.** Tick the S1 README progress lines for the waves, add sprint-log rows for every real finding and deviation, then commit:

```bash
pnpm check
git add docs/reports/screenshots docs/reports/demo-rehearsal.md README.md docs/specs/flatmate-design.md docs/design-memory/rendering.md docs/design-memory/implementation.md docs/design-memory/INDEX.md docs/plans/flatmate-s1
git commit -m "docs: S1 references for both renderers, rehearsal step 10, README, spec and memory"
```

Then write the gate report (see [README.md](README.md) → "Gate protocol") and stop.

---

## Task S1.6: SDF debug view `?sdf=debug` (added 2026-09-30)

**Size S · no review (shell glue) · after gate S1, at the user's request** ("How can I verify the webgl is really working via SDF? switching does not show any difference!"). Design: spec §6.2, "SDF debug view"; `rendering.md`.

**Files:** `packages/web/src/adapters/webgl/shaders.ts`, `packages/web/src/adapters/webgl-renderer.ts`, `packages/web/src/renderer-switch.ts` (or a small `sdf-debug.ts`: `sdfDebugFrom(search)`), `packages/web/src/main.tsx`, `packages/web/test/renderer-switch.test.ts` (or `test/sdf-debug.test.ts`), `packages/web/e2e/renderers.spec.ts`.

- [x] **Step 1: Parse.** `sdfDebugFrom(search): boolean` is true only for `sdf=debug` (trimmed, case-insensitive). Vitest: `?sdf=debug` true; missing, `sdf=`, `sdf=on`, `sdf=DEBUG ` → only the last is true.
- [x] **Step 2: Shaders.** The segment, arc and disc sources take a debug flag (compile-time, e.g. a function returning the sources or a `#define`): quad padding 16 px instead of the normal pad; `shade(d, color)` draws `color` for `d ≤ 0` and, for `0 < d < 16`, alternating 4 px bands (`step(0.5, fract(d / 8.0))`) of `color` with alpha fading linearly to 0 at 16 px; normal mode is byte-for-byte unchanged in behaviour. Polygons unchanged.
- [x] **Step 3: Wiring.** `createWebGLRenderer(glCanvas, overlay, onLost, { sdfDebug })`; `main.tsx` passes `sdfDebugFrom(location.search)`. Canvas2D ignores it.
- [x] **Step 4: e2e.** In `renderers.spec.ts`, one test: `?server=off&renderer=webgl&sdf=debug`, draw one wall (as the existing probes do); a pixel 6 px outside the wall's outer face is not the background colour (tolerance as the other probes), and the same pixel with `sdf` off is the background. Run `pnpm e2e` 3 times.
- [x] **Step 5:** `pnpm check`; commit `web: SDF debug view (?sdf=debug) shows the distance field under WebGL (S1.6)`.
