import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRectRoom } from "./support/canvas";
import { openProject } from "./support/app-driver";
import { angles3d, drag3d, meanY3d, panelPixels } from "./support/probe3d";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";
import { pickCard } from "./support/palette";

// Orbiting the 3D view (real3d.04, .26, AC-01 to AC-04): a primary-button drag in the panel turns it, 0.4° a pixel,
// right lowering the yaw so the model's near side follows the hand, down raising the tilt within 10°…90°; [ and ] and
// the header turn 90°; a double-click resets. Drags are many small moves, as a hand makes them (stairdraw lesson).

const canvasOf = (page: Page) => page.getByTestId("canvas");

let projects: string[] = [];
let contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

/** A local 6 × 4 room with the 3D view open in split. */
async function room(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
}

/** The mean page x of the panel's pixels in `hex` (null when none): where a colour sits. */
async function meanX3d(page: Page, hex: string): Promise<number | null> {
  const { x, width, rgb } = await panelPixels(page);
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let [sum, n] = [0, 0];
  for (let k = 0; k * 3 < rgb.length; k++) {
    if (want.every((w, c) => Math.abs((rgb[k * 3 + c] ?? 0) - w) <= 6)) {
      sum += x + (k % width);
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

test("a 100 px drag right turns the yaw by 40° and keeps the tilt; 100 px down raises the tilt by 40° (AC-01)", async ({ page }) => {
  await room(page);
  await drag3d(page, 100, 0);
  let a = await angles3d(page);
  expect(Math.abs(a.yaw - 185)).toBeLessThanOrEqual(1);
  expect(a.tilt).toBe(35);
  await drag3d(page, 0, 100);
  a = await angles3d(page);
  expect(Math.abs(a.yaw - 185)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.tilt - 75)).toBeLessThanOrEqual(1);
});

test("a long drag up stops the tilt at 10°, a long drag down at 90° (AC-01)", async ({ page }) => {
  await room(page);
  await drag3d(page, 0, -300);
  expect((await angles3d(page)).tilt).toBe(10);
  await drag3d(page, 0, 400);
  expect((await angles3d(page)).tilt).toBe(90);
});

test("the model follows the hand: a piece by the near corner moves right on screen with a drag right", async ({ page }) => {
  await room(page);
  await pickCard(page, "wardrobe");
  await clickAt(page, canvasOf(page), { x: 1, y: 1 }); // near the south-west corner, toward the camera
  await page.keyboard.press("Escape");
  await clickAt(page, canvasOf(page), { x: 1, y: 1 }); // select it: it draws in the selection blue
  await expect.poll(() => meanX3d(page, COLORS.objectSelected)).not.toBeNull();
  const before = (await meanX3d(page, COLORS.objectSelected)) ?? 0;
  await drag3d(page, 25, 0); // 10°
  await expect.poll(async () => ((await meanX3d(page, COLORS.objectSelected)) ?? 0) - before).toBeGreaterThan(3);
});

test("] and [ and the header buttons turn the yaw by 90° from an orbited angle, keeping the tilt (AC-02)", async ({ page }) => {
  await room(page);
  await drag3d(page, 30, 20); // yaw 213, tilt 43
  const a = await angles3d(page);
  await page.keyboard.press("]");
  await expect.poll(async () => (await angles3d(page)).yaw).toBeCloseTo((a.yaw + 90) % 360, 6);
  await page.keyboard.press("[");
  await page.locator('[data-action="turn3d-left"]').click();
  await expect.poll(async () => (await angles3d(page)).yaw).toBeCloseTo((a.yaw - 90 + 360) % 360, 6);
  await page.locator('[data-action="turn3d-right"]').click();
  const b = await angles3d(page);
  expect(b.yaw).toBeCloseTo(a.yaw, 6);
  expect(b.tilt).toBe(a.tilt);
});

test("a double-click resets to yaw 225°, tilt 35° (AC-03)", async ({ page }) => {
  await room(page);
  await drag3d(page, 70, 45);
  expect(await angles3d(page)).not.toEqual({ yaw: 225, tilt: 35 });
  await page.getByTestId("view3d").dblclick();
  await expect.poll(() => angles3d(page)).toEqual({ yaw: 225, tilt: 35 });
});

test("the cursor is a grab hand over the panel and a closed one during a drag", async ({ page }) => {
  await room(page);
  const host = page.getByTestId("view3d");
  await expect(host).toHaveCSS("cursor", "grab");
  const box = await host.boundingBox();
  if (box === null) throw new Error("no 3D host");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 4 });
  await expect(host).toHaveCSS("cursor", "grabbing");
  await page.mouse.up();
  await expect(host).toHaveCSS("cursor", "grab");
});

test("orbiting in one window leaves the other's view and the drawing alone (AC-04)", async ({ browser }) => {
  const project = `zz-orbit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const open = async (name: string): Promise<Page> => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
    await expect(page.getByTestId("project-list")).toBeVisible();
    await openProject(page, project);
    return page;
  };
  const alice = await open("Alice");
  await drawRectRoom(alice, canvasOf(alice), 6, 4);
  const bob = await open("Bob");
  for (const p of [alice, bob]) {
    await p.keyboard.press("3");
    await p.keyboard.press("Shift+Digit3");
  }
  const bobBefore = await meanY3d(bob, "#4a4a4a");
  await drag3d(alice, 80, 30);
  expect((await angles3d(alice)).yaw).not.toBe(225);
  await alice.waitForTimeout(300);
  expect(await angles3d(bob)).toEqual({ yaw: 225, tilt: 35 });
  expect(await meanY3d(bob, "#4a4a4a")).toBe(bobBefore);
});
