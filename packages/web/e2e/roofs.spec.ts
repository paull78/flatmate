import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom } from "./support/canvas";
import { pickCard } from "./support/palette";
import { expectNoToast } from "./support/toasts";

// Roofs in the browser (spec roofs, AC-02, AC-04, AC-09, AC-11): a Tiny house shed picked from the Ceiling section's
// presets shows its high wall; a typed low wall moves the high wall by as much; a tall pantry dropped by the low wall is
// lowered to fit, and keeps its height by the high one; the 3D panel's Roof switch turns on. drawRectRoom's 6 × 4 m room: inner faces x 0.1–5.9,
// y 0.1–3.9, the low side at the bottom (−y).

const canvasOf = (page: Page) => page.getByTestId("canvas");
const field = (page: Page, id: string) => page.locator(`[data-field-id="${id}"]`);

async function room(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("v");
  await page.keyboard.press("Escape");
}

async function type(page: Page, id: string, value: string): Promise<void> {
  await field(page, id).fill(value);
  await field(page, id).press("Enter");
}

test("a Tiny house shed from the presets shows its high wall, and a typed low wall raises it by as much (AC-02, AC-11)", async ({ page }) => {
  await room(page);
  await field(page, "ceiling.preset").selectOption("tinyShed");
  await expect(field(page, "ceiling.height")).toHaveValue("2.75");
  await expect(field(page, "ceiling.pitch")).toHaveValue("10.0");
  const high = Number(await field(page, "ceiling.highSide").inputValue());
  expect(high).toBeGreaterThan(3.4); // 2.75 + tan 10° × the box's depth of about 4.2 m
  await type(page, "ceiling.height", "2.85");
  await expect(field(page, "ceiling.highSide")).toHaveValue((high + 0.1).toFixed(2));
  await expect(field(page, "ceiling.preset")).toHaveValue("custom");
});

test("a tall pantry dropped by a low wall of 2.00 is lowered to fit the slope, and keeps 2.10 by the high one (AC-04)", async ({ page }) => {
  await room(page);
  await field(page, "ceiling.shape").locator('[data-value="shed"]').click();
  await type(page, "ceiling.height", "2");
  await pickCard(page, "tallPantry");
  await clickAt(page, canvasOf(page), { x: 1.5, y: 0.45 }); // against the low wall: the ceiling over it is about 2.04
  await expectNoToast(page);
  await clickAt(page, canvasOf(page), { x: 4.5, y: 3.55 }); // against the high wall: the ceiling there is about 2.65
  await expectNoToast(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const heightOf = async (x: number, y: number): Promise<number> => {
    await clickAt(page, canvasOf(page), { x, y });
    return Number(await page.locator('[data-field-id^="height."]').first().inputValue());
  };
  expect(await heightOf(1.5, 0.45)).toBeLessThan(2.1); // lowered under the slope (clarity.34): 2.04 where it stands
  expect(await heightOf(4.5, 3.55)).toBe(2.1);
});

test("the 3D panel's Roof switch turns on and off (AC-09)", async ({ page }) => {
  await room(page);
  await field(page, "ceiling.preset").selectOption("tinyGable");
  await page.keyboard.press("3");
  const roof = page.locator('[data-action="roof3d"]');
  await expect(roof).toHaveAttribute("aria-pressed", "false");
  await roof.click();
  await expect(roof).toHaveAttribute("aria-pressed", "true");
  await roof.click();
  await expect(roof).toHaveAttribute("aria-pressed", "false");
});
