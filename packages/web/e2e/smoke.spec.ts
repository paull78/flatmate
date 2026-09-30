import { expect, test, type Locator, type Page } from "@playwright/test";

// Mirrors the editor's initial camera (README contracts): centre (3, 2), 80 px per metre, world y up.
const CENTER = { x: 3, y: 2 };
const ZOOM = 80;

type WorldPoint = { x: number; y: number };

async function toScreen(canvas: Locator, p: WorldPoint): Promise<WorldPoint> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  return {
    x: box.x + box.width / 2 + (p.x - CENTER.x) * ZOOM,
    y: box.y + box.height / 2 - (p.y - CENTER.y) * ZOOM,
  };
}

async function moveTo(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  const s = await toScreen(canvas, p);
  await page.mouse.move(s.x, s.y, { steps: 4 });
}

async function clickAt(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  await moveTo(page, canvas, p);
  await page.mouse.down();
  await page.mouse.up();
}

async function typeLength(page: Page, value: string): Promise<void> {
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

test("draws the demo room with typed lengths and shows a wall's length", async ({ page }) => {
  // `server=off` keeps local mode even when Playwright reuses a dev server started with VITE_SERVER_URL
  // (phase 7 reads it; until then it is ignored).
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("project-status")).toHaveText("not saved");

  // Demo step 2 (spec §1.4): W, Shift held, typed lengths along the cursor direction, click the first joint.
  await page.keyboard.press("w");
  await expect(page.locator('[data-tool="wall"]')).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 3, y: 0 });
  await typeLength(page, "6");
  await moveTo(page, canvas, { x: 6, y: 2 });
  await typeLength(page, "4");
  await moveTo(page, canvas, { x: 3, y: 4 });
  await typeLength(page, "6");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.up("Shift");

  // Select the bottom wall and read its length from the properties panel.
  await page.keyboard.press("v");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, canvas, { x: 3, y: 0 });
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("6.00");
});
