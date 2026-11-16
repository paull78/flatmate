import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { pickCard } from "./support/palette";
import { pieces } from "./support/pieces";
import { bandUnder, decode, pixelsNear, plateBox, plateFaults, shot, withSlack, type Pixels } from "./support/plate";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";
import { toast } from "./support/toasts";

// The reason at the pointer in a real browser (clarity.02, .07), in Canvas2D and in WebGL. The plate is canvas text, so
// the page can't read its words: its box is worked out from the toast's words, and found by its pixels: red text, a
// white box whose sides no ghost line crosses, a red border where those words' width puts it. A run acts like a user:
// the pointer moves along a path, and each edit waits for its acknowledgement.

const AWAY: WorldPoint = { x: 8, y: -1 };
const SOFA_SPOT: WorldPoint = { x: 3, y: 2.6 }; // on the sofa, MCP's `at` being its centre
const FREE_SPOT: WorldPoint = { x: 3, y: 1 };
const WORDS = "Wardrobe (0.00–2.05) and Sofa (0.00–0.90) overlap in Layout"; // the names' order may change; the width doesn't, to a pixel (clarity.13)

const REST_MS = 150;

type Renderer = { renderer: "canvas2d" | "webgl"; label: string };
const RENDERERS: readonly Renderer[] = [{ renderer: "canvas2d", label: "Canvas2D" }, { renderer: "webgl", label: "WebGL" }];

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const canvasOf = (page: Page): Locator => page.getByTestId("canvas");

/** A 6 × 4 room with a sofa in it, opened by Alice in `renderer`, a wardrobe armed and the pointer off the drawing. */
async function wardrobeArmed(browser: Browser, { renderer, label }: Renderer): Promise<{ page: Page; project: string }> {
  const project = `zz-plate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("place_object", { layout: "s0", kind: "sofa", centre: { x: 3, y: 2.5 } });
  } finally {
    claude.close();
  }
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}&renderer=${renderer}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await expect(page.locator('[data-action="renderer"]')).toHaveText(label);
  await pickCard(page, "wardrobe");
  await moveTo(page, canvasOf(page), AWAY);
  return { page, project };
}

/** The pointer glides to `to` from where it is, in small moves, and stops there; returns the page point it stopped at. */
async function glideTo(page: Page, to: WorldPoint): Promise<WorldPoint> {
  const s = await toScreen(canvasOf(page), to);
  await page.mouse.move(s.x, s.y, { steps: 12 });
  return s;
}

const REFUSAL = { line: COLORS.invalid, text: COLORS.refusalText };
const textPixels = (p: Pixels): number => pixelsNear(p, COLORS.refusalText);

/** Retries until the plate stands whole under the pointer, at these words' width. */
async function expectPlate(page: Page, pointer: WorldPoint, words: string, advice?: string): Promise<void> {
  const box = withSlack(plateBox(pointer, words, advice));
  await expect.poll(async () => plateFaults(await decode(page, await shot(page, box)), REFUSAL), { message: `the plate reading "${words}"` }).toEqual([]);
}

for (const look of RENDERERS) {
  test.describe(look.label, () => {
    test("the reason appears after a rest over a sofa", async ({ browser }) => {
      const { page } = await wardrobeArmed(browser, look);
      const a = await toScreen(canvasOf(page), { x: 1.5, y: SOFA_SPOT.y });
      const b = await toScreen(canvasOf(page), { x: 4.5, y: SOFA_SPOT.y });
      await page.mouse.move(a.x, a.y, { steps: 8 });

      // While moving: a read counts only if it was over within a rest of the move before it, and of the one before that,
      // so no rest can have fired (the timer starts after the move starts). Decoding waits for the end of the path.
      const moving: Buffer[] = [];
      let fastBefore = false;
      const band = await bandUnder(page, { x: a.x, y: a.y });
      for (let i = 1; i <= 24; i++) {
        const started = Date.now();
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 24, a.y);
        const png = await shot(page, band);
        const fast = Date.now() - started < REST_MS;
        if (fast && fastBefore) moving.push(png);
        fastBefore = fast;
      }
      expect(moving.length, "reads taken while the pointer moved").toBeGreaterThan(0);
      for (const png of moving) expect(textPixels(await decode(page, png)), "no words while moving").toBe(0);

      const pointer = await glideTo(page, SOFA_SPOT);
      await expectPlate(page, pointer, WORDS, "Drag to draw it to size"); // a rest's plate advises a drag (sizing.09)
      await expect(toast(page)).toHaveCount(0); // a rest raises no toast

      // Moving on takes it away at once, with a piece still red under the pointer (a positive transition, so it may retry).
      const below = await bandUnder(page, pointer);
      await page.mouse.move(pointer.x, pointer.y - 60, { steps: 4 });
      await expect.poll(async () => textPixels(await decode(page, await shot(page, below))), { message: "the plate gone from where it was" }).toBe(0);
    });

    test("a refused click keeps the plate until the pointer moves 24 px, and the toast holds the same words", async ({ browser }) => {
      const { page, project } = await wardrobeArmed(browser, look);
      const pointer = await glideTo(page, SOFA_SPOT);
      await page.mouse.down();
      await page.mouse.up();
      await expect(toast(page)).toBeVisible();
      const words = (await toast(page).textContent()) ?? "";
      expect(words).toContain("Wardrobe");
      expect(words).toContain("Sofa");
      await expectPlate(page, pointer, words);

      // 20 px on: still over the sofa and still red, and a rest doesn't move the plate. Waited out, then read once.
      await page.mouse.move(pointer.x, pointer.y - 20, { steps: 4 });
      await page.waitForTimeout(REST_MS * 3);
      const box = withSlack(plateBox(pointer, words));
      expect(plateFaults(await decode(page, await shot(page, box)), REFUSAL)).toEqual([]);

      // Past 24 px it goes.
      const band = await bandUnder(page, pointer);
      await page.mouse.move(pointer.x, pointer.y - 30, { steps: 2 });
      await expect.poll(async () => textPixels(await decode(page, await shot(page, band))), { message: "the plate gone from the click" }).toBe(0);
      await expect(toast(page)).toHaveText(words); // the toast stays as the echo

      expect(await pieces(project)).toHaveLength(1);
      await glideTo(page, FREE_SPOT); // the tool stays armed, and the next click places
      await page.mouse.down();
      await page.mouse.up();
      await expect.poll(async () => (await pieces(project)).length).toBe(2);
      await waitSaved(page);
    });
  });
}
