import { expect, test, type Page } from "@playwright/test";
import { clickAt, moveTo, type WorldPoint } from "./support/canvas";
import { canvasOf } from "./support/app-driver";
import { expectPixel } from "./support/pixels";

// A full wall takes the joint (spec mitres, AC-08): at an L and a T the corner is solid in both renderers. Each probe point
// is empty in the drawing before this cycle: the half wall's mitred tip at the L, the bar's far half at the T.

const WALL = "#8a8c93";

async function open(page: Page, renderer: string): Promise<void> {
  await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
  await expect(canvasOf(page)).toBeVisible();
}

async function draw(page: Page, chain: WorldPoint[]): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  for (const p of chain) await clickAt(page, canvas, p);
  await page.keyboard.press("Enter");
}

async function lower(page: Page, at: WorldPoint): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("v");
  await clickAt(page, canvas, at);
  await page.locator('[data-field-id="toCeiling"]').click();
  const top = page.locator('[data-field-id="top"]');
  await top.fill("1");
  await top.press("Enter");
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, { x: 0.3, y: 0.3 }); // nothing hovered
}

for (const renderer of ["canvas2d", "webgl"]) {
  test(`an L's outer corner is solid, in ${renderer}`, async ({ page }) => {
    await open(page, renderer);
    await draw(page, [{ x: 1, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 1 }]);
    await lower(page, { x: 4, y: 2 });
    const canvas = canvasOf(page);
    await expectPixel(page, canvas, { x: 4.06, y: 2.94 }, WALL); // the half wall's tip, outlined before
    await expectPixel(page, canvas, { x: 4, y: 2 }, "#ffffff", 40); // the half wall itself stays an outline
  });

  test(`a T's full stem runs to the bar's far face, in ${renderer}`, async ({ page }) => {
    await open(page, renderer);
    await draw(page, [{ x: 1, y: 1 }, { x: 5, y: 1 }]);
    await draw(page, [{ x: 3, y: 3 }, { x: 3, y: 1 }]);
    await lower(page, { x: 2, y: 1 });
    await lower(page, { x: 4, y: 1 });
    const canvas = canvasOf(page);
    await expectPixel(page, canvas, { x: 2.94, y: 0.94 }, WALL); // beside the old point, at the far face
    await expectPixel(page, canvas, { x: 3.06, y: 0.94 }, WALL);
    await expectPixel(page, canvas, { x: 2.7, y: 1 }, "#ffffff", 40); // the bar stays an outline
  });
}
