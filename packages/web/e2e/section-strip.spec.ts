import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CANVAS_STYLE, COLORS } from "@fm/editor";
import { clickAt, drawRectRoom, moveTo } from "./support/canvas";
import { countPixels, expectPixel } from "./support/pixels";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";
import { copyStudio } from "./support/studio-copy";

// The strip under the plan (spec "The strip", AC-09). The studio's copy has two sections: A along it, B across it.
//
//   A ▬▬ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▬▬ A  y 1.25, from x −0.5 to 7.5, looking north
//   B at x 5.75, from y −0.5 to 3.0, looking west

const ALONG = { x: 4, y: 1.25 };
const ACROSS = { x: 5.75, y: 2.75 };
const SECTIONS = {
  A: { id: "A", a: { x: -0.5, y: 1.25 }, b: { x: 7.5, y: 1.25 }, side: 1, depth: null },
  B: { id: "B", a: { x: 5.75, y: -0.5 }, b: { x: 5.75, y: 3 }, side: 1, depth: null },
};

const canvasOf = (page: Page): Locator => page.getByTestId("canvas");
const stripOf = (page: Page): Locator => page.getByTestId("section-strip");
const drawing = (page: Page): Locator => page.getByTestId("section-strip-canvas");
const letter = (page: Page, section: string): Locator => stripOf(page).locator(`button[data-section="${section}"]`);

async function boxOf(element: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await element.boundingBox();
  if (box === null) throw new Error("not visible");
  return box;
}

/** The strip's picture alone. */
const picture = (page: Page): Promise<Buffer> => drawing(page).screenshot();

/** The picture once it has settled: two equal screenshots in a row. */
async function settledPicture(page: Page): Promise<Buffer> {
  let last = await picture(page);
  await expect
    .poll(async () => {
      const next = await picture(page);
      const same = next.equals(last);
      last = next;
      return same;
    })
    .toBe(true);
  return last;
}

let projects: string[] = [];
let contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function studioPage(browser: { newContext(): Promise<BrowserContext> }, name: string, who: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=${who}&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await expect(canvasOf(page)).toBeVisible();
  return page;
}

async function studioCopy(): Promise<string> {
  const name = `Strip ${Math.random().toString(36).slice(2, 8)}`;
  await copyStudio(name, (doc) => ({ ...doc, sections: SECTIONS }));
  projects.push(name);
  return name;
}

const panelOf = (page: Page): Locator => page.getByTestId("view3d-panel");
const properties = (page: Page): Locator => page.getByTestId("properties-column");

/** A 6 × 4 room with section A across it, its frame open. */
async function roomWithSection(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("s");
  await clickAt(page, canvasOf(page), { x: -1, y: 2 });
  await clickAt(page, canvasOf(page), { x: 7, y: 2 });
  await clickAt(page, canvasOf(page), { x: 3, y: 3 });
  await expect(stripOf(page)).toBeVisible();
}

test("the section's frame sits under the plan, 3D's corner floats over the plan, and the plan gets smaller (AC-16)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  const stage = await boxOf(canvasOf(page));
  const wall = { x: 0, y: 2 };
  await expectPixel(page, canvasOf(page), wall, COLORS.wall);
  await expect(stripOf(page)).toHaveCount(0);

  await page.keyboard.press("s");
  await clickAt(page, canvasOf(page), { x: -1, y: 2 });
  await clickAt(page, canvasOf(page), { x: 7, y: 2 });
  await expect(stripOf(page)).toHaveCount(0);
  await clickAt(page, canvasOf(page), { x: 3, y: 3 });
  await expect(stripOf(page)).toBeVisible();
  await page.keyboard.press("3");
  await expect(panelOf(page)).toBeVisible();

  const dock = Math.round(stage.height * 0.46);
  await expect.poll(async () => Math.round((await boxOf(canvasOf(page))).height)).toBe(stage.height - dock - 8);
  const [plan, strip, panel] = await Promise.all([boxOf(canvasOf(page)), boxOf(stripOf(page)), boxOf(panelOf(page))]);
  expect(plan.width).toBe(stage.width);
  expect([strip.x, strip.width]).toEqual([plan.x + 8, plan.width - 16]); // the whole width, inside the floor's margin
  expect(strip.y).toBe(plan.y + plan.height + 8);
  expect(strip.y + strip.height).toBe(stage.y + stage.height - 8);
  expect(panel.y + panel.height).toBeLessThanOrEqual(plan.y + plan.height); // over the plan
  expect(panel.x + panel.width).toBeLessThanOrEqual(plan.x + plan.width);

  // The cut is drawn, with both walls and both bands, and the plan is still centred on its point.
  await expect.poll(() => countPixels(page, drawing(page), CANVAS_STYLE.section.cut)).toBeGreaterThan(4000);
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
  await expectPixel(page, canvasOf(page), wall, COLORS.wall);

  await page.getByTestId("section-strip-close").click();
  await expect(stripOf(page)).toHaveCount(0);
  await expect.poll(async () => (await boxOf(canvasOf(page))).height).toBe(stage.height); // 3D still floats, and the plan is whole
  await expect(panelOf(page)).toBeVisible();
  await expect(page.getByTestId("frames-sash")).toHaveCount(0);
});

test("3D in split sits beside the section, and swap exchanges their places, keeping each one's width and the renderer (AC-15)", async ({ page }) => {
  await roomWithSection(page);
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(panelOf(page)).toHaveAttribute("data-size", "split");
  await expect.poll(async () => (await boxOf(panelOf(page))).y).toBe((await boxOf(stripOf(page))).y);
  const [strip, panel] = await Promise.all([boxOf(stripOf(page)), boxOf(panelOf(page))]);
  expect(panel.height).toBe(strip.height);
  expect(panel.x).toBe(strip.x + strip.width + 8); // the section first, with the gap between
  expect(strip.width / (strip.width + panel.width)).toBeCloseTo(0.56, 1);
  await page.getByTestId("view3d").evaluate((el) => el.setAttribute("data-kept", "yes")); // a new element wouldn't have it

  await stripOf(page).locator('[data-action="swap-frames"]').click();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))); // the short move has begun
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const [strip2, panel2] = await Promise.all([boxOf(stripOf(page)), boxOf(panelOf(page))]);
  expect(panel2.x).toBe(strip.x);
  expect(strip2.x).toBe(strip.x + panel.width + 8);
  expect(strip2.width).toBeCloseTo(strip.width, 0);
  await expect(page.getByTestId("view3d")).toHaveAttribute("data-kept", "yes");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);

  await page.getByTestId("section-strip-close").click();
  await expect.poll(async () => (await boxOf(panelOf(page))).width).toBe(strip.width + panel.width + 8); // alone, it has the dock
});

test("the gap above the dock resizes it, the plan keeps 180 and the dock 200, a double-click resets it, and Larger comes back (AC-15)", async ({ page }) => {
  await roomWithSection(page);
  const stage = (await boxOf(page.getByTestId("palette-column"))).height;
  const dockHeight = async (): Promise<number> => (await boxOf(page.getByTestId("frames-dock"))).height;
  const usual = Math.round(stage * 0.46);
  await expect.poll(async () => Math.round(await dockHeight())).toBe(usual);
  const drawn = (await boxOf(drawing(page))).height;

  const sash = await boxOf(page.getByTestId("frames-sash"));
  const dragTo = async (y: number): Promise<void> => {
    const from = await boxOf(page.getByTestId("frames-sash"));
    await page.mouse.move(from.x + from.width / 2, from.y + 4);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, y, { steps: 4 });
    await page.mouse.up();
  };
  await dragTo(sash.y + 4 - 100);
  await expect.poll(async () => Math.round(await dockHeight())).toBe(usual + 100);
  await expect.poll(async () => (await boxOf(drawing(page))).height).toBe(drawn + 100); // the picture's page follows
  await dragTo(0);
  await expect.poll(async () => (await boxOf(canvasOf(page))).height).toBe(180);
  await dragTo(stage);
  await expect.poll(dockHeight).toBe(200);

  const now = await boxOf(page.getByTestId("frames-sash"));
  await page.mouse.dblclick(now.x + now.width / 2, now.y + 4);
  await expect.poll(async () => Math.round(await dockHeight())).toBe(usual);

  await stripOf(page).locator('[data-action="larger-frames"]').click();
  await expect.poll(async () => Math.abs((await dockHeight()) - stage * 0.74)).toBeLessThan(1);
  await stripOf(page).locator(".frame-head").dblclick({ position: { x: 200, y: 10 } });
  await expect.poll(async () => Math.round(await dockHeight())).toBe(usual);
});

test("the gap between the frames shares the width", async ({ page }) => {
  await roomWithSection(page);
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("frames-share")).toBeVisible();
  const [dock, gap] = await Promise.all([boxOf(page.getByTestId("frames-dock")), boxOf(page.getByTestId("frames-share"))]);
  await page.mouse.move(gap.x + 4, gap.y + 40);
  await page.mouse.down();
  await page.mouse.move(dock.x + dock.width * 0.3, gap.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round(((await boxOf(stripOf(page))).width / dock.width) * 10)).toBe(3);
});

test("closing the frame deselects the section, and clicking it reopens the frame (AC-13)", async ({ page }) => {
  await roomWithSection(page);
  await expect(properties(page)).toContainText("Depth");
  await page.getByTestId("section-strip-close").click();
  await expect(stripOf(page)).toHaveCount(0);
  await expect(properties(page)).not.toContainText("Depth");
  await clickAt(page, canvasOf(page), { x: 3, y: 2 });
  await expect(stripOf(page)).toBeVisible();
  await expect(properties(page)).toContainText("Depth");
});

test("after drawing, the tool is Select: Delete removes the section (AC-14)", async ({ page }) => {
  await roomWithSection(page);
  await expect(page.locator('button[title="Select (V)"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Delete");
  await expect(stripOf(page)).toHaveCount(0);
  await expect(properties(page)).not.toContainText("Depth");
});

test("a mark near the top of the canvas selects like any other", async ({ page }) => {
  await roomWithSection(page); // the dock's open, so the next section doesn't move the plan under it
  const box = await boxOf(canvasOf(page));
  const bar = await boxOf(page.locator(".floating-bar")); // it wraps on a narrow window, so measure it
  const [x, y] = [box.x + box.width * 0.8, bar.y + bar.height + 12]; // beside the bar's hint line, just under the bar
  await page.keyboard.press("s");
  await page.mouse.click(x - 60, y);
  await page.mouse.click(x + 60, y);
  await page.mouse.click(x, y + 60);
  await expect(letter(page, "B")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(properties(page)).not.toContainText("Depth");
  await page.mouse.click(x, y);
  await expect(properties(page)).toContainText("Depth");
});

test("a letter in the frame selects that section: the picture, Properties and the plan all follow (AC-17)", async ({ browser }) => {
  const name = await studioCopy();
  const page = await studioPage(browser, name, "Alice");
  const fields = (): Promise<string[]> => properties(page).locator("input").evaluateAll((els) => els.flatMap((e) => (e instanceof HTMLInputElement ? [e.value] : [])));
  await clickAt(page, canvasOf(page), ALONG);
  await expect.poll(fields).toContain("8.00");
  await letter(page, "B").click();
  await expect(letter(page, "B")).toHaveAttribute("aria-pressed", "true");
  await expect(stripOf(page).locator(".frame-title")).toContainText("B–B");
  await expect.poll(fields).toContain("3.50");
  await letter(page, "A").click();
  await expect.poll(fields).toContain("8.00");
  await expect.poll(fields).toContain("A");
});

test("the corner's switch hides the marks on this viewer's plan, the selected one stays, and S brings them back (AC-20)", async ({ page }) => {
  await roomWithSection(page);
  const toggle = page.locator('[data-action="section-marks"]');
  const marks = (): Promise<number> => countPixels(page, canvasOf(page), CANVAS_STYLE.mark.ink);
  await page.keyboard.press("Escape");
  await expect.poll(marks).toBeGreaterThan(50);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(marks).toBe(0);
  await clickAt(page, canvasOf(page), { x: 3, y: 2 }); // a hidden mark takes no click
  await expect(properties(page)).not.toContainText("Depth");

  await page.keyboard.press("s");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect.poll(marks).toBeGreaterThan(50);
});

test("flipping the layout changes its pixels, and flipping back restores them", async ({ browser }) => {
  const name = await studioCopy();
  const page = await studioPage(browser, name, "Alice");
  await clickAt(page, canvasOf(page), ALONG);
  await expect(letter(page, "A")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => countPixels(page, drawing(page), CANVAS_STYLE.section.cut)).toBeGreaterThan(1000);
  const day = await settledPicture(page);
  const draws = Number(await drawing(page).getAttribute("data-draws"));

  // A pointer over the plan asks for nothing: the same page, not drawn again. The flip below shows the count can move.
  await moveTo(page, canvasOf(page), { x: 3, y: 2 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(Number(await drawing(page).getAttribute("data-draws"))).toBe(draws);

  await page.getByRole("button", { name: "Night", exact: true }).click();
  await expect.poll(async () => (await picture(page)).equals(day)).toBe(false);
  await expect.poll(async () => Number(await drawing(page).getAttribute("data-draws"))).toBeGreaterThan(draws);
  const night = await settledPicture(page);
  expect(night.equals(day)).toBe(false);

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect.poll(async () => (await picture(page)).equals(day)).toBe(true);
});

test("two clients show different sections, and a remote delete closes one", async ({ browser }) => {
  const name = await studioCopy();
  const alice = await studioPage(browser, name, "Alice");
  const bob = await studioPage(browser, name, "Bob");

  await clickAt(alice, canvasOf(alice), ALONG);
  await expect(letter(alice, "A")).toHaveAttribute("aria-pressed", "true");
  await expect(stripOf(bob)).toHaveCount(0);

  await clickAt(bob, canvasOf(bob), ACROSS);
  await expect(letter(bob, "B")).toHaveAttribute("aria-pressed", "true");
  await expect(letter(alice, "A")).toHaveAttribute("aria-pressed", "true");
  await expect(letter(alice, "B")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => countPixels(bob, drawing(bob), CANVAS_STYLE.section.cut)).toBeGreaterThan(1000);
  expect((await settledPicture(alice)).equals(await settledPicture(bob))).toBe(false);

  // Bob's letter selects for him alone, and his delete of the section Alice is looking at closes both frames.
  await letter(bob, "A").click();
  await expect(letter(bob, "A")).toHaveAttribute("aria-pressed", "true");
  await expect(letter(alice, "A")).toHaveAttribute("aria-pressed", "true");
  await bob.keyboard.press("Delete");
  await expect(stripOf(alice)).toHaveCount(0);
  await expect(stripOf(bob)).toHaveCount(0);

  // One section left: its frame has no letters to choose from.
  await clickAt(alice, canvasOf(alice), ACROSS);
  await expect(stripOf(alice).locator(".frame-title")).toContainText("B–B");
  await expect(stripOf(alice).locator("button[data-section]")).toHaveCount(0);
});
