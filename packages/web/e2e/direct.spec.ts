import { expect, test, type Page } from "@playwright/test";
import { clickAt, dragFromTo, drawRectRoom } from "./support/canvas";
import { pickCard } from "./support/palette";

// Direct manipulation in the browser (spec: tools). Object Properties has no position field, so a move is checked by
// clicking a piece's old and new centres and reading whether the Kind field shows up.

const canvasOf = (page: Page) => page.getByTestId("canvas");

/** A 5 × 4 room with corners (0,0) and (5,4): inner faces at x 0.1/4.9 and y 0.1/3.9. */
async function drawStudio(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 5, 4);
}

test("box select two desks, Shift-click toggles one, drag the group, one undo restores it; Delete in Properties removes both (AC-06, AC-07, AC-08, AC-09)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();
  await drawStudio(page);
  for (const at of [{ x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }]) {
    await pickCard(page, "desk");
    await clickAt(page, canvas, at); // a 1.2 × 0.6 desk centred on the click
  }
  await page.keyboard.press("v");
  const group = page.getByTestId("properties-group");
  const kind = page.locator('[data-field-id="kind"]');
  const box = async () => dragFromTo(page, canvas, { x: 0.6, y: 0.6 }, { x: 4.4, y: 2.4 });

  await box(); // from the unlabelled floor, around both desks
  await expect(group).toContainText("2 objects");

  await page.keyboard.down("Shift");
  await clickAt(page, canvas, { x: 3.5, y: 1.5 });
  await page.keyboard.up("Shift");
  await expect(kind).toHaveValue("desk");
  await expect(group).toHaveCount(0);
  await page.keyboard.down("Shift");
  await clickAt(page, canvas, { x: 3.5, y: 1.5 });
  await page.keyboard.up("Shift");
  await expect(group).toContainText("2 objects");

  await dragFromTo(page, canvas, { x: 1.5, y: 1.5 }, { x: 1.5, y: 2.5 }); // +1.0 m, a multiple of the 0.2 m grid
  await expect(group).toContainText("2 objects");
  await page.keyboard.press("Escape");
  for (const at of [{ x: 1.5, y: 2.5 }, { x: 3.5, y: 2.5 }]) {
    await clickAt(page, canvas, at);
    await expect(kind).toHaveValue("desk");
  }
  await clickAt(page, canvas, { x: 1.5, y: 1.5 });
  await expect(kind).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z"); // one undo moves both back
  await clickAt(page, canvas, { x: 1.5, y: 1.5 });
  await expect(kind).toHaveValue("desk");
  await clickAt(page, canvas, { x: 3.5, y: 2.5 });
  await expect(kind).toHaveCount(0);

  await box();
  await page.getByTestId("group-delete").click();
  for (const at of [{ x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }]) {
    await clickAt(page, canvas, at);
    await expect(kind).toHaveCount(0);
  }
  await page.keyboard.press("ControlOrMeta+z");
  await clickAt(page, canvas, { x: 3.5, y: 1.5 });
  await expect(kind).toHaveValue("desk");
});
