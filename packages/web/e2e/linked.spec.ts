import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, dragFromTo, drawRectRoom, moveTo } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { pickCard } from "./support/palette";

// Layouts linked by default (review.05, .07, AC-01, AC-06): a chair placed by Day is there at Night; switched off at
// Night and moved, it moves at Night only.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 7, y: -1 };

async function nameLayout(page: Page, name: string): Promise<void> {
  await page.getByTestId("state-name").fill(name);
  await page.getByTestId("state-name").press("Enter");
}

test("a piece placed by Day is there at Night; switched off and moved at Night, Day keeps it in place", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 5, 4);
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 0.6, y: 0.6 }); // label the room
  await nameLayout(page, "Day");
  await page.getByTestId("state-add").click();
  await nameLayout(page, "Night");
  await page.getByRole("button", { name: "Day", exact: true }).click();

  const here = { x: 2, y: 1.5 };
  const there = { x: 3.5, y: 1.5 };
  await pickCard(page, "chair");
  await clickAt(page, canvas, here);
  await page.keyboard.press("Escape");

  // Night has it too, linked.
  await page.getByRole("button", { name: "Night", exact: true }).click();
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, here, COLORS.object);
  await page.keyboard.press("v");
  await clickAt(page, canvas, here);
  const linked = page.locator('[data-field-id="linked"]');
  await expect(linked).toHaveAttribute("aria-checked", "true");

  // Switched off and moved at Night: Day keeps its chair where it was.
  await linked.click();
  await expect(linked).toHaveAttribute("aria-checked", "false");
  await dragFromTo(page, canvas, here, there);
  await page.keyboard.press("Escape"); // deselect, so the chair draws in its own colour
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, there, COLORS.object);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, here, COLORS.object);
  await expect.poll(async () => distance(await pixelAt(page, canvas, there), COLORS.object), { timeout: 2000 }).toBeGreaterThan(12);
});
