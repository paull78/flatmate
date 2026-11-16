import { expect, test, type Locator, type Page } from "@playwright/test";
import { clickAt, drawRectRoom } from "./support/canvas";
import { pickCard } from "./support/palette";

// Every native dropdown gives stray keys back to the plan (snags.06, AC-01). The surroundings menu's own tests are in
// surroundings.spec.ts; these are the size picker and Properties' dropdowns, which share its guard. A focused, closed
// list is reached with focus(), as headless Chromium's popup ignores a pressed Escape (surroundings.29).

const canvasOf = (page: Page): Locator => page.getByTestId("canvas");
const focused = (el: Locator): Promise<boolean> => el.evaluate((node) => node === document.activeElement);

/** A local 6 × 4 room with the Object tool armed on the bed, whose presets include Single and Super king. */
async function bedArmed(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await pickCard(page, "bed");
}

test("the size picker gives a typed letter back: the preset stays and the next key reaches the plan (AC-01)", async ({ page }) => {
  await bedArmed(page);
  const picker = page.getByTestId("size-picker-select");
  await expect(picker).toHaveValue("King 170 × 210");
  await picker.focus();
  await page.keyboard.press("s"); // by type-ahead: Single, or Super king
  expect(await focused(picker)).toBe(false);
  await expect(picker).toHaveValue("King 170 × 210");
  await page.keyboard.press("v"); // the plan has the keys again
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
});

test("a Properties dropdown lets go after a pick, so Cmd+Z undoes it at once, and gives a typed letter back (AC-01)", async ({ page }) => {
  await bedArmed(page);
  await clickAt(page, canvasOf(page), { x: 3, y: 2 }); // a 1.70 × 2.10 King
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: 3, y: 2 });
  const preset = page.locator('[data-field-id="preset"]');
  const width = page.locator('[data-field-id="width"]');
  await expect(preset).toHaveValue("King");
  await expect(width).toHaveValue("1.70");

  await preset.focus(); // as a pick with the mouse leaves it
  await preset.selectOption({ label: "Double 150 × 210" });
  await expect(width).toHaveValue("1.50");
  expect(await focused(preset)).toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(width).toHaveValue("1.70");
  await expect(preset).toHaveValue("King");

  await preset.focus();
  await page.keyboard.press("s"); // by type-ahead: Single, or Super king, a shared edit
  expect(await focused(preset)).toBe(false);
  await expect(preset).toHaveValue("King");
  await expect(width).toHaveValue("1.70");
});
