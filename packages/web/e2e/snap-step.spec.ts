import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, dragFromTo, moveTo } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { pickCard } from "./support/palette";

// The snap step in the floating bar (direct.14, AC-14): with 25 cm chosen, a wall drawn to (5.12, 0.04) ends at 5 m and
// a bed dragged 0.37 m moves 0.25 m; Auto would give 5.20 m and 0.40 m. The step lasts for the session only.

const canvasOf = (page: Page) => page.getByTestId("canvas");

test("the snap step: 25 cm walls and furniture drags, back to Auto after a reload (AC-14)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();
  await page.locator('[data-snap-step="0.25"]').click();
  await expect(page.locator('[data-snap-step="0.25"]')).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("w");
  for (const p of [{ x: 0, y: 0 }, { x: 5.12, y: 0.04 }, { x: 5, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }]) await clickAt(page, canvas, p);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 2.5, y: 0 });
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("5.00");

  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 0.6, y: 0.6 }); // label the room
  await pickCard(page, "bed");
  await clickAt(page, canvas, { x: 2, y: 2 }); // x 1.15–2.85, y 0.95–3.05
  await page.keyboard.press("v");
  await dragFromTo(page, canvas, { x: 2, y: 1.6 }, { x: 2.37, y: 1.6 });
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, { x: 7, y: -1 }); // keep the cursor away from the probes

  // The bed now spans x 1.40–3.10; Auto's 0.40 m would put it at 1.55–3.25, over (3.18, 1.3).
  await expectPixel(page, canvas, { x: 2.95, y: 1.3 }, COLORS.object);
  await expect.poll(async () => distance(await pixelAt(page, canvas, { x: 3.18, y: 1.3 }), COLORS.object)).toBeGreaterThan(12);
  await expect.poll(async () => distance(await pixelAt(page, canvas, { x: 1.3, y: 1.3 }), COLORS.object)).toBeGreaterThan(12);

  await page.reload();
  await expect(canvas).toBeVisible();
  await expect(page.locator('[data-snap-step="auto"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-snap-step="0.25"]')).toHaveAttribute("aria-pressed", "false");
});
