import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS, STYLE_3D, type Point3 } from "@fm/editor";
import { clickAt, drawRectRoom, type WorldPoint } from "./support/canvas";
import { openProject } from "./support/app-driver";
import { distance, expectPixel, screenPixel } from "./support/pixels";
import { meanY3d, panelPixels, screen3d } from "./support/probe3d";
import { deleteProjects } from "./support/stored";
import { SERVER } from "./support/server";
import { expectNoToast } from "./support/toasts";
import { pickCard } from "./support/palette";
import { pickOpeningKind } from "./support/opening-kind";

// The heights cycle's 3D view (heights.18, .19, .29, .34, AC-12–AC-15, AC-17 without the Claude beat), on WebGL2, the
// only 3D renderer since real3d.10: tests probe the panel's pixels placed through the editor's own camera, or find where
// a colour sits (a bed's linen tops, parts.05: the lift bed is the only linen in these rooms).

const LINEN = STYLE_3D.slots.linen.top;

const canvasOf = (page: Page) => page.getByTestId("canvas");
const panel = (page: Page) => page.getByTestId("view3d-panel");

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function local(page: Page, query = ""): Promise<void> {
  await page.goto(`/?name=Alice&server=off${query}`);
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
}

/** Picks a kind in the palette and clicks the plan at `at`, then back to Select. */
async function place(page: Page, kind: string, at: WorldPoint): Promise<void> {
  await pickCard(page, kind);
  await clickAt(page, canvasOf(page), at);
  await page.keyboard.press("Escape");
}

/** The mean page y of the linen in the 3D panel, once it is drawn. */
async function linenY(page: Page): Promise<number> {
  await expect.poll(() => meanY3d(page, LINEN)).not.toBeNull();
  return (await meanY3d(page, LINEN)) ?? 0;
}

// drawRectRoom's 6 × 4 m room: walls 0.20 m thick on the clicked lines, the default 2.50 m ceiling.
const ROOM = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 };

/** The composited colour at the 3D panel's pixel where world point `p` lands, at the angles the panel shows. */
async function probe3d(page: Page, p: Point3): Promise<number[]> {
  const s = await screen3d(page, ROOM, p);
  return screenPixel(page, s.x, s.y);
}

const expect3d = (page: Page, p: Point3, hex: string, what: string) =>
  expect.poll(async () => distance(await probe3d(page, p), hex), { message: what }).toBeLessThanOrEqual(14);

test("3 opens the corner panel; ⇧3 switches to split and the plan still takes a wall (AC-12)", async ({ page }) => {
  await local(page);
  await expect(panel(page)).toBeHidden();
  await expect(page.getByTestId("open3d")).toBeVisible();
  await page.keyboard.press("3");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-size", "corner");
  await expect3d(page, { x: 3, y: 4, z: 2.5 }, STYLE_3D.wall.top, "the far (north) wall's top");
  const before = await canvasOf(page).boundingBox();
  await page.keyboard.press("Shift+Digit3");
  await expect(panel(page)).toHaveAttribute("data-size", "split");
  const after = await canvasOf(page).boundingBox();
  expect(after?.height ?? 0).toBeLessThan((before?.height ?? 0) * 0.7);
  await page.keyboard.press("w");
  // In split the plan is shorter: its top edge sits under the floating bar, the middle of its bottom under the layout pill.
  await clickAt(page, canvasOf(page), { x: 1.5, y: 0 });
  await clickAt(page, canvasOf(page), { x: 1.5, y: 2 });
  await page.keyboard.press("Escape");
  await expect3d(page, { x: 1.5, y: 1, z: 2.5 }, STYLE_3D.wall.top, "the new divider's top, drawn in 3D");
  await page.locator('[data-action="close3d"]').click();
  await expect(panel(page)).toBeHidden();
});

/** The middles of the south, east, north and west walls' tops, and which are hidden at each corner yaw. */
const WALL_MIDDLES: readonly Point3[] = [{ x: 3, y: 0, z: 2.5 }, { x: 6, y: 2, z: 2.5 }, { x: 3, y: 4, z: 2.5 }, { x: 0, y: 2, z: 2.5 }];
const HIDDEN_AT: Readonly<Record<number, readonly number[]>> = { 225: [0, 3], 315: [0, 1], 45: [1, 2], 135: [2, 3] }; // by yaw

test("] four times returns to the first view; two near shell walls are missing at each turn (AC-13)", async ({ page }) => {
  await local(page);
  await place(page, "wardrobe", { x: 5.5, y: 3.5 }); // off centre, so each turn draws another picture of the symmetric room
  await page.keyboard.press("3");
  const pictures: string[] = [];
  for (const yaw of [315, 45, 135, 225]) {
    await page.keyboard.press("]");
    await expect(panel(page)).toHaveAttribute("data-yaw", String(yaw));
    // Each wall's top at its middle: drawn for the two far walls, not for the two hidden near ones.
    for (const [i, p] of WALL_MIDDLES.entries()) {
      if (HIDDEN_AT[yaw]?.includes(i)) await expect.poll(async () => distance(await probe3d(page, p), STYLE_3D.wall.top), { message: `wall ${i} hidden at yaw ${yaw}` }).toBeGreaterThan(14);
      else await expect3d(page, p, STYLE_3D.wall.top, `wall ${i} drawn at yaw ${yaw}`);
    }
    const { rgb } = await panelPixels(page);
    pictures.push(rgb.join(","));
  }
  expect(new Set(pictures).size).toBe(4);
  await page.locator('[data-action="turn3d-left"]').click();
  await expect(panel(page)).toHaveAttribute("data-yaw", "135");
});

test("flipping Day to Night moves the lift bed down over the flip, the plan with it (AC-14)", async ({ page }) => {
  await local(page);
  await place(page, "liftBed", { x: 3, y: 2.85 }); // up at the ceiling in the first layout
  await page.getByTestId("state-add").click();
  await clickAt(page, canvasOf(page), { x: 3, y: 2.5 });
  await page.locator('[data-field-id="config"] [data-value="down"]').click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  const night = await linenY(page);
  await page.locator('[data-testid="state-pill"] button[data-state-id]').first().click(); // back to the first layout: the flip
  await page.waitForTimeout(150); // the flip lasts 500 ms; one screenshot, read once, lands inside it
  const mid = (await meanY3d(page, LINEN)) ?? 0;
  await page.waitForTimeout(700);
  const day = await linenY(page);
  expect(day).toBeLessThan(night - 10); // up is up the screen
  expect(mid).toBeLessThan(night - 1);
  expect(mid).toBeGreaterThan(day + 1);
});

async function openAs(browser: Browser, name: string, project: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await openProject(page, project);
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return page;
}

test("two clients: Bob's 3D view stays closed when Alice opens hers (AC-12)", async ({ browser }) => {
  const project = `zz-heights-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const alice = await openAs(browser, "Alice", project);
  await drawRectRoom(alice, canvasOf(alice), 6, 4);
  const bob = await openAs(browser, "Bob", project);
  await alice.keyboard.press("3");
  await expect(panel(alice)).toBeVisible();
  await expect(panel(bob)).toBeHidden();
  await expect(bob.getByTestId("open3d")).toBeVisible();
});

test("the sample Studio in one browser: a desk under the lift bed, the ceiling to 2.20 brings the bed down, a Murphy bed refused (AC-17 without Claude)", async ({ page }) => {
  await local(page);
  await place(page, "liftBed", { x: 3, y: 2.85 });
  await place(page, "desk", { x: 3, y: 3.6 }); // under the raised bed
  await expectNoToast(page); // read once (levels.55)
  await page.keyboard.press("3");
  const up = await linenY(page); // the desk under it has no linen
  await page.keyboard.press("Escape");
  const ceiling = page.locator('[data-field-id="ceiling.height"]');
  await ceiling.fill("2.2");
  await ceiling.press("Enter");
  await expect(page.getByTestId("cut-height")).toHaveText("Cut +1.10");
  await expect.poll(async () => (await meanY3d(page, LINEN)) ?? 0).toBeGreaterThan(up + 3); // the bed came down with the ceiling
  await pickCard(page, "murphyBed");
  await clickAt(page, canvasOf(page), { x: 1, y: 3.7 });
  await expect(page.locator(".fm-toast")).toHaveText("Murphy bed (Closed) reaches 2.24 m in Layout; the ceiling is 2.20 m");
});

test.describe("the 3D view on WebGL2 (heights.34)", () => {
  test.use({ viewport: { width: 1600, height: 1200 } });

  /** The room, a lift bed up at the ceiling in its west half and selected, the 3D view open in split. */
  async function studio(page: Page, query = ""): Promise<void> {
    await local(page, query);
    await place(page, "liftBed", { x: 1.5, y: 2 });
    await clickAt(page, canvasOf(page), { x: 1.5, y: 2 });
    await page.keyboard.press("3");
    await page.keyboard.press("Shift+Digit3");
    await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
  }

  test("WebGL2 draws the raised bed's colour at its projected centre and the floor where a hidden wall would be, at turns 0 and 2", async ({ page }) => {
    await studio(page);
    await expect3d(page, { x: 1.5, y: 2, z: 2.5 }, COLORS.objectSelected, "the bed's top, turn 0");
    await expect3d(page, { x: 3, y: 4, z: 2.5 }, STYLE_3D.wall.top, "the far (north) wall's top, turn 0");
    await expect3d(page, { x: 3, y: 0, z: 2.5 }, STYLE_3D.floor, "floor where the hidden south wall would be, turn 0");
    await page.keyboard.press("]");
    await page.keyboard.press("]");
    await expect(panel(page)).toHaveAttribute("data-yaw", "45");
    await expect3d(page, { x: 1.5, y: 2, z: 2.5 }, COLORS.objectSelected, "the bed's top, turn 2");
    await expect3d(page, { x: 3, y: 0, z: 2.5 }, STYLE_3D.wall.top, "the far (south) wall's top, turn 2");
    await expect3d(page, { x: 3, y: 4, z: 2.5 }, STYLE_3D.floor, "floor where the hidden north wall would be, turn 2");
  });

  test("WEBGL_lose_context leaves a note in the panel; the plan keeps editing (real3d AC-13)", async ({ page }) => {
    await studio(page);
    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="view3d"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no 3D canvas");
      canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(page.getByTestId("view3d-unavailable")).toHaveText("The 3D view needs WebGL2");
    await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(0);
    await page.keyboard.press("w");
    await clickAt(page, canvasOf(page), { x: 4.5, y: 0 });
    await clickAt(page, canvasOf(page), { x: 4.5, y: 2 });
    await page.keyboard.press("Escape");
    await expectPixel(page, canvasOf(page), { x: 4.5, y: 1 }, COLORS.wall); // the plan took the wall
  });

  {
    test(`a window on the far wall shows its glass pane, and a door the background through its gap (AC-21)`, async ({ page }) => {
      await local(page);
      await page.keyboard.press("d");
      await clickAt(page, canvasOf(page), { x: 2.4, y: 3.95 }); // a 0.80 m door, x 2.0–2.8, on the north wall
      await pickOpeningKind(page, "window");
      await clickAt(page, canvasOf(page), { x: 4, y: 3.95 }); // a 1.00 m window, x 3.5–4.5
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("3");
      await page.keyboard.press("Shift+Digit3");
      await expect(panel(page)).toHaveAttribute("data-size", "split");
      await expect3d(page, { x: 4, y: 4, z: 1.5 }, STYLE_3D.glass, "the window's pane");
      await expect3d(page, { x: 1, y: 4, z: 1.5 }, STYLE_3D.wall.shaded, "the far wall beside the door (its room face looks south, away from the light)");
      await page.keyboard.press("]"); // from the south-west the door's open leaf stands in front of its doorway (openings3d.09)
      await expect3d(page, { x: 2.5, y: 4, z: 1 }, STYLE_3D.background, "the background through the door");
    });
  }

  {
    test(`a sofa's middle seat cushion shows the fabric slot's top shade (parts AC-10)`, async ({ page }) => {
      await local(page);
      await place(page, "sofa", { x: 3, y: 2 }); // 2.10 × 0.90, front to −y: three cushions, the middle one at x 2.7–3.3
      await page.keyboard.press("3");
      await page.keyboard.press("Shift+Digit3");
      await expect(panel(page)).toHaveAttribute("data-size", "split");
      // The cushion's top: legs 0.08 + base 0.20 + cushion 0.15 = 0.43 m, from the front edge (y 1.55) to the back (y 2.23).
      await expect3d(page, { x: 3, y: 1.89, z: 0.43 }, STYLE_3D.slots.fabric.top, "the middle cushion's top");
    });
  }

  test("two GL contexts: the plan with ?renderer=webgl and the 3D panel both draw", async ({ page }) => {
    await studio(page, "&renderer=webgl");
    await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGL");
    await expect3d(page, { x: 1.5, y: 2, z: 2.5 }, COLORS.objectSelected, "the bed's top in 3D");
    await page.keyboard.press("Shift+Digit3"); // back to corner: the plan's camera is the initial one again
    await expectPixel(page, canvasOf(page), { x: 6, y: 1 }, COLORS.wall);
  });
});
