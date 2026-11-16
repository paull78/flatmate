import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, dragFromTo, moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { canvasOf, waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { pickCard } from "./support/palette";
import { pieces } from "./support/pieces";
import { distance } from "./support/pixels";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Standing warnings in a real browser (clarity.02, .04), in Canvas2D and in WebGL: the outline and the mark on the plan,
// the count, its list, and the one blink. A run acts like a user: the pointer moves along a path, and each edit waits for
// its acknowledgement.

const AWAY: WorldPoint = { x: 8, y: -1 };
const CLEAR: WorldPoint = { x: 5, y: 1 };
const IN_ZONE: WorldPoint = { x: 3, y: 3 }; // the wardrobe's x 2.4–3.6, y 3.3–3.9; its front zone x 2.4–3.6, y 2.7–3.3
const IN_LEFT_ZONE: WorldPoint = { x: 1, y: 3 }; // the other wardrobe's front zone: x 0.4–1.6, y 2.7–3.3

// Off the nightstand, which stays near x 3: the bottom edge of the zone, and the mark, as view/warnings.ts places it:
// 14 px from the corner (3.6, 3.3) toward the zone's middle (3, 3).
const ON_OUTLINE: WorldPoint = { x: 2.6, y: 2.7 };
const MARK: WorldPoint = { x: 3.6 - (0.175 * 0.6) / Math.hypot(0.6, 0.3), y: 3.3 - (0.175 * 0.3) / Math.hypot(0.6, 0.3) };
const INSIDE_DISC_PX = 6; // left of the glyph, inside the 9.5 px disc
const NEAR = 24; // a pixel reads as this colour, whichever the renderer's antialiasing

const BLINK_MS = 600;
const PAST_BLINK_MS = BLINK_MS + 300;

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

const pill = (page: Page): Locator => page.getByTestId("warnings-pill");
const count = (page: Page): Locator => page.getByTestId("warnings-button");

const field = (value: unknown, name: string): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined);

/** Another client places a nightstand, over MCP. */
async function collaboratorPlaces(project: string, at: WorldPoint): Promise<void> {
  const claude = await startMcp(SERVER);
  try {
    const listed = field(await claude.call("list_projects"), "projects");
    const row = (Array.isArray(listed) ? listed : []).find((p: unknown) => field(p, "name") === project);
    await claude.call("open_project", { id: field(row, "id") });
    await claude.call("place_object", { layout: "s0", kind: "nightstand", centre: at });
  } finally {
    claude.close();
  }
}

/** A 6 × 4 room with two wardrobes on its top wall, opened by Alice in `renderer`. */
async function opened(browser: Browser, { renderer, label }: Renderer): Promise<{ page: Page; project: string }> {
  const project = `zz-warnings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("place_object", { layout: "s0", kind: "wardrobe", centre: { x: 3, y: 3.6 } });
    await claude.call("place_object", { layout: "s0", kind: "wardrobe", centre: { x: 1, y: 3.6 } });
  } finally {
    claude.close();
  }
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.addInitScript(logBlinks);
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}&renderer=${renderer}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await expect(page.locator('[data-action="renderer"]')).toHaveText(label);
  return { page, project };
}

/** Places a nightstand with the Object tool, and goes back to Select. */
async function placeNightstand(page: Page, at: WorldPoint): Promise<void> {
  await pickCard(page, "nightstand");
  await clickAt(page, canvasOf(page), at);
  await waitSaved(page);
  await page.keyboard.press("v");
}

/** The middle of the one nightstand, from the stored drawing: `at` is the middle of its 0.40 deep back edge. */
async function nightstandMiddle(project: string): Promise<WorldPoint> {
  const stand = (await pieces(project)).find((p) => p.kind === "nightstand");
  if (stand === undefined) throw new Error("no nightstand");
  return { x: stand.at.x, y: stand.at.y - stand.d / 2 };
}

async function dragNightstand(page: Page, project: string, to: WorldPoint): Promise<void> {
  await expect.poll(() => pieces(project).then((all) => all.some((p) => p.kind === "nightstand"))).toBe(true);
  await dragFromTo(page, canvasOf(page), await nightstandMiddle(project), to);
  await waitSaved(page);
}

/** How near the colour comes in a small square around a world point, its centre `dx` page pixels off: 0 is exact. */
async function nearest(page: Page, at: WorldPoint, hex: string, dx = 0, half = 2): Promise<number> {
  const s = await toScreen(canvasOf(page), at);
  const png = await page.screenshot({ clip: { x: Math.floor(s.x + dx - half), y: Math.floor(s.y - half), width: 2 * half + 1, height: 2 * half + 1 } });
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    return Array.from({ length: data.length / 4 }, (_, i) => Array.from(data.slice(i * 4, i * 4 + 3)));
  }, png.toString("base64"));
  return Math.min(...pixels.map((rgb) => distance(rgb, hex)));
}

/** Logs each start of the blink in the page, with the timing `getAnimations()` gives at that moment: a poll could miss it. */
const logBlinks = (): void => {
  document.addEventListener("animationstart", (e) => {
    if (e.animationName !== "warnings-blink" || !(e.target instanceof Element)) return;
    const timings = e.target.getAnimations().map((a) => {
      const { iterations, duration } = a.effect?.getTiming() ?? {};
      return { iterations, duration };
    });
    const root = document.documentElement;
    root.dataset.blinks = JSON.stringify([...JSON.parse(root.dataset.blinks ?? "[]"), ...timings]);
  });
};

const blinks = (page: Page): Promise<number> => page.evaluate(() => JSON.parse(document.documentElement.dataset.blinks ?? "[]").length);
const blinkTimings = (page: Page): Promise<unknown> => page.evaluate(() => JSON.parse(document.documentElement.dataset.blinks ?? "[]"));
const running = (page: Page): Promise<number> => pill(page).evaluate((el) => el.getAnimations({ subtree: true }).length);

/** Long enough for a blink that was going to start to have started, and to have ended. */
const pastBlink = (page: Page): Promise<void> => page.waitForTimeout(PAST_BLINK_MS);

test("the focus ring follows the row clicked, as the arrows move it", async ({ browser }) => {
  const { page } = await opened(browser, RENDERERS[0] ?? { renderer: "canvas2d", label: "Canvas2D" });
  await placeNightstand(page, IN_ZONE);
  await placeNightstand(page, IN_LEFT_ZONE);
  await count(page).click();
  const rows = page.getByTestId("warnings-list").getByRole("menuitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toBeFocused();
  await rows.nth(1).click();
  await expect(rows.nth(1)).toBeFocused();
  await rows.nth(0).click();
  await expect(rows.nth(0)).toBeFocused();
});

for (const r of RENDERERS) {
  test.describe(r.label, () => {
    test("a blocked zone has an outline and a mark, the pill says 1 warning, the list names the blocker, a row selects the piece, and Esc closes the list and keeps the selection", async ({ browser }) => {
      const { page } = await opened(browser, r);
      await expect(pill(page)).toBeHidden();
      await placeNightstand(page, IN_ZONE);
      await moveTo(page, canvasOf(page), AWAY);

      await expect.poll(() => nearest(page, ON_OUTLINE, COLORS.warningLine)).toBeLessThanOrEqual(NEAR);
      await expect.poll(() => nearest(page, MARK, COLORS.warningMark, -INSIDE_DISC_PX, 1)).toBeLessThanOrEqual(NEAR);

      await expect(count(page)).toHaveText("!1 warning");
      await expect(page.getByTestId("warnings-list")).toBeHidden();
      await count(page).click();
      const rows = page.getByTestId("warnings-list").getByRole("menuitem");
      await expect(rows).toHaveText(["Wardrobe's front is blocked by Nightstand"]);

      await expect(page.getByTestId("prop-duplicate")).toBeHidden();
      await rows.first().click();
      await expect(page.getByTestId("prop-duplicate")).toBeVisible();
      await expect(page.getByTestId("warnings-list")).toBeVisible(); // a row leaves it open (clarity.28)

      await page.keyboard.press("Escape");
      await expect(page.getByTestId("warnings-list")).toBeHidden();
      await expect(count(page)).toBeFocused();
      await expect(page.getByTestId("prop-duplicate")).toBeVisible(); // at the window, Esc would have cleared it
    });

    test("moving the piece away hides the pill", async ({ browser }) => {
      const { page, project } = await opened(browser, r);
      await placeNightstand(page, IN_ZONE);
      await expect(count(page)).toHaveText("!1 warning");
      await moveTo(page, canvasOf(page), AWAY);
      await expect.poll(() => nearest(page, ON_OUTLINE, COLORS.warningLine)).toBeLessThanOrEqual(NEAR);

      await dragNightstand(page, project, CLEAR);
      await expect(pill(page)).toBeHidden();
      await moveTo(page, canvasOf(page), AWAY);
      await expect.poll(() => nearest(page, ON_OUTLINE, COLORS.warningLine)).toBeGreaterThan(NEAR);
      await expect.poll(() => nearest(page, MARK, COLORS.warningMark, -INSIDE_DISC_PX, 1)).toBeGreaterThan(NEAR);
    });

    test("the animation runs once, and not under reducedMotion", async ({ browser }) => {
      const { page, project } = await opened(browser, r);
      await pastBlink(page);
      expect(await blinks(page)).toBe(0); // no blink on load

      await placeNightstand(page, IN_ZONE);
      await expect(count(page)).toHaveText("!1 warning");
      await expect.poll(() => blinks(page)).toBe(1);
      expect(await blinkTimings(page)).toEqual([{ iterations: 1, duration: BLINK_MS }]);
      await expect.poll(() => running(page)).toBe(0); // it ends: no loop
      await pastBlink(page);
      expect(await blinks(page)).toBe(1);

      await dragNightstand(page, project, CLEAR); // lowering the count doesn't blink
      await expect(pill(page)).toBeHidden();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await dragNightstand(page, project, IN_ZONE);
      await expect(count(page)).toHaveText("!1 warning");
      expect(await running(page)).toBe(0);
      await pastBlink(page);
      expect(await blinks(page)).toBe(1);

      await dragNightstand(page, project, CLEAR); // the same edit does blink with the preference gone
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await dragNightstand(page, project, IN_ZONE);
      await expect.poll(() => blinks(page)).toBe(2);
      await expect.poll(() => running(page)).toBe(0);

      await placeNightstand(page, IN_LEFT_ZONE); // from one warning to two: the pill stays, and its span starts over
      await expect(count(page)).toHaveText("!2 warnings");
      await expect.poll(() => blinks(page)).toBe(3);
    });

    test("the blink waits for the release, and an undo, a redo or a collaborator's edit doesn't play it again", async ({ browser }) => {
      const { page, project } = await opened(browser, r);
      await placeNightstand(page, IN_ZONE);
      await expect.poll(() => blinks(page)).toBe(1);
      await dragNightstand(page, project, CLEAR);
      await expect(pill(page)).toBeHidden();

      await moveTo(page, canvasOf(page), await nightstandMiddle(project));
      await page.mouse.down();
      await moveTo(page, canvasOf(page), IN_ZONE);
      await expect(count(page)).toHaveText("!1 warning"); // the drag's preview already counts
      await pastBlink(page);
      expect(await blinks(page)).toBe(1);
      await page.mouse.up();
      await waitSaved(page);
      await expect.poll(() => blinks(page)).toBe(2);

      // The pill leaves and comes back on the tick it has already played.
      await page.keyboard.press("ControlOrMeta+z");
      await waitSaved(page);
      await expect(pill(page)).toBeHidden();
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await waitSaved(page);
      await expect(count(page)).toHaveText("!1 warning");
      await pastBlink(page);
      expect(await blinks(page)).toBe(2);

      await dragNightstand(page, project, CLEAR);
      await expect(pill(page)).toBeHidden();
      await collaboratorPlaces(project, IN_ZONE);
      await expect(count(page)).toHaveText("!1 warning");
      await pastBlink(page);
      expect(await blinks(page)).toBe(2);

      // A project that opens with a warning doesn't blink either.
      await page.reload();
      await page.getByRole("button", { name: project, exact: true }).click();
      await expect(count(page)).toHaveText("!1 warning");
      await pastBlink(page);
      expect(await blinks(page)).toBe(0);
    });
  });
}
