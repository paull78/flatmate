import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom } from "./support/canvas";

// The colour picker (picker): a finish's Custom row is the browser's colour picker as a swatch beside the typed hex. A
// pick commits once, when the picker closes: one edit, one undo step; typing a hex still works.

const canvasOf = (page: Page) => page.getByTestId("canvas");

test("a floor's colour picked in the picker sets the finish once; one undo returns it; a typed hex still sets it", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("z"); // label the room, which selects it
  await clickAt(page, canvasOf(page), { x: 3, y: 2 });

  const row = page.locator('[data-finish-id="row:floor"]');
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await page.locator('select[data-field-id="floor"]').selectOption("plain");
  const hex = page.locator('[data-field-id="hex"]');
  const before = await hex.inputValue();
  const swatch = page.locator('input[type="color"][data-colour-for="Custom"]');
  await expect(swatch).toHaveValue(before);

  await swatch.fill("#3366aa"); // the picker closing on a colour: input, then change
  await expect(hex).toHaveValue("#3366aa");
  await expect(row).toContainText("#3366aa");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(hex).toHaveValue(before);
  await expect(swatch).toHaveValue(before);

  await hex.fill("#aa5533");
  await hex.press("Enter");
  await expect(swatch).toHaveValue("#aa5533");
});
