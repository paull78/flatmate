import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom } from "./support/canvas";
import { pickCard } from "./support/palette";
import { expectNoToast } from "./support/toasts";

// The pieces for small homes in the browser (spec pieces, AC-01, AC-09): a range from the Kitchen group placed against
// a wall, and a stool tucked wholly under a bar table, accepted with no warning; a second click in the overlap selects
// the stool (seating.28). drawRectRoom's 6 × 4 m room: inner faces x 0.1–5.9, y 0.1–3.9.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const name = (page: Page) => page.locator('[data-field-id="name"]');

async function room(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("v");
}

test("a range from the Kitchen group lands against the top wall, and Properties names it (AC-01)", async ({ page }) => {
  await room(page);
  await pickCard(page, "range");
  await clickAt(page, canvasOf(page), { x: 3, y: 3.55 });
  await expectNoToast(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: 3, y: 3.6 });
  await expect(name(page)).toHaveValue("Range");
});

test("a stool placed wholly under a bar table is accepted with no warning, and a second click selects it (AC-09)", async ({ page }) => {
  await room(page);
  await pickCard(page, "barTable");
  await clickAt(page, canvasOf(page), { x: 3, y: 2 }); // x 2.4–3.6, y 1.7–2.3
  await pickCard(page, "stool");
  await clickAt(page, canvasOf(page), { x: 3.3, y: 2 }); // x 3.1–3.5, y 1.8–2.2: wholly under
  await expectNoToast(page);
  await expect(page.getByTestId("warnings-pill")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: 3.3, y: 2 });
  await expect(name(page)).toHaveValue("Bar table");
  await clickAt(page, canvasOf(page), { x: 3.3, y: 2 });
  await expect(name(page)).toHaveValue("Stool");
});
