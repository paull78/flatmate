import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom, moveTo } from "./support/canvas";
import { canvasOf, helperLabelPage } from "./support/app-driver";
import { toast } from "./support/toasts";

// Typed values on the real keyboard path (spec typed-input): physical keys through the input adapter to the hint line.

async function openLocal(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  await expect(canvasOf(page)).toBeVisible();
}

const hint = (page: Page) => page.getByTestId("command-value");
const unit = (page: Page) => page.locator(".command-unit");
const field = (page: Page, id: string) => page.locator(`[data-field-id="${id}"]`);

async function startWall(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await moveTo(page, canvas, { x: 1, y: 0 });
}

async function commit(page: Page, id: string, value: string): Promise<void> {
  await field(page, id).fill(value);
  await field(page, id).press("Enter");
}

test("with Shift held, digit keys stay digits and a sum still reads: 3m-60cm is a 2.40 m wall (AC-01, AC-08)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await startWall(page);
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 1, y: 0.05 });
  for (const key of ["Digit2", "Period", "Digit8"]) await page.keyboard.press(key);
  await expect(hint(page)).toHaveText("2.8");
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Backspace");
  for (const key of ["Digit3", "KeyM", "Minus", "Digit6", "Digit0", "KeyC", "KeyM"]) await page.keyboard.press(key);
  await expect(hint(page)).toHaveText("3m-60cm = 2.40");
  await expect(unit(page)).toHaveText("m");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.press("Enter"); // an empty Enter ends the chain
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 1.2, y: 0 });
  await expect(field(page, "length")).toHaveValue("2.40");
});

test("a comma survives Shift, and the numpad's operators type (AC-01)", async ({ page }) => {
  await openLocal(page);
  await startWall(page);
  await page.keyboard.down("Shift");
  for (const key of ["Digit2", "Comma", "Digit8"]) await page.keyboard.press(key);
  await page.keyboard.up("Shift");
  await expect(hint(page)).toHaveText("2,8");
  await page.keyboard.press("NumpadDivide");
  await page.keyboard.press("Digit2");
  await expect(hint(page)).toHaveText("2,8/2 = 1.40");
  await page.keyboard.press("NumpadMultiply");
  await page.keyboard.press("Digit2");
  await expect(hint(page)).toHaveText("2,8/2*2 = 2.80");
});

test("Space types into the value and only Enter commits (AC-02)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await startWall(page);
  await page.keyboard.press("Space"); // on an empty value: nothing, the chain goes on
  await expect(page.getByTestId("command-bar")).toContainText("Next point or length");
  await page.keyboard.type("2 - 1");
  await expect(hint(page)).toHaveText("2 - 1 = 1.00");
  await page.keyboard.press("Enter");
  await expect(hint(page)).toHaveText("");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-bar")).toContainText("First point");
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 0.5, y: 0 });
  await expect(field(page, "length")).toHaveValue("1.00");
});

test("an unreadable value is never red, and Enter is refused with the reason (AC-03, AC-06)", async ({ page }) => {
  await openLocal(page);
  await startWall(page);
  const colour = async () => hint(page).evaluate((el) => getComputedStyle(el).color);
  await page.keyboard.type("2.80");
  const calm = await colour();
  await page.keyboard.type("-");
  await expect(hint(page)).toHaveText("2.80-");
  await expect(unit(page)).toHaveCount(0);
  expect(await colour()).toBe(calm);
  await page.keyboard.press("Enter");
  await expect(toast(page)).toHaveText("Can't read 2.80-");
  await expect(hint(page)).toHaveText("2.80-");
  await page.keyboard.type("0.6");
  await expect(hint(page)).toHaveText("2.80-0.6 = 2.20");
});

test("M picks Dimension with nothing typed, and types a unit after a digit (AC-05)", async ({ page }) => {
  await openLocal(page);
  await startWall(page);
  await page.keyboard.press("2");
  await page.keyboard.press("m");
  await expect(hint(page)).toHaveText("2m = 2.00");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("m");
  await expect(page.getByTestId("value-input")).toHaveCount(0);
  await expect(page.getByTestId("command-bar")).not.toContainText("Next point or length");
});

test("a helper takes a typed sum (AC-08)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 6, 4);
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 6, y: 2 });
  const helper = await helperLabelPage(page, { x: 6, y: 0 }, { x: 6, y: 4 });
  await page.mouse.click(helper.x, helper.y);
  await page.keyboard.type("4m-50cm");
  await expect(hint(page)).toHaveText("4m-50cm = 3.50");
  await page.keyboard.press("Enter");
  await expect(hint(page)).toHaveText("");
  await expect(field(page, "length")).not.toHaveValue("4.00");
  await expect(toast(page)).toHaveCount(0);
});

test("a length in feet and inches: 8'6\" on the real keys draws a 2.59 m wall (spec feet, AC-05)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await startWall(page);
  for (const key of ["Digit8", "Quote", "Digit6"]) await page.keyboard.press(key);
  await expect(hint(page)).toHaveText("8'6 = 2.591");
  await page.keyboard.press("Shift+Quote"); // the inch mark, where it needs no digit key (feet.02)
  await expect(hint(page)).toHaveText("8'6\" = 2.591");
  await expect(unit(page)).toHaveText("m");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // an empty Enter ends the chain
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 1.2, y: 0 });
  await expect(field(page, "length")).toHaveValue("2.59");
});

test("Properties: fields in metres take units and sums, others sums only; an unreadable value restores the field (AC-07)", async ({ page }) => {
  await openLocal(page);
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 6, 4);
  await page.keyboard.press("v");
  await page.keyboard.press("Escape");
  await commit(page, "ceiling.height", "270cm");
  await expect(field(page, "ceiling.height")).toHaveValue("2.70");

  await clickAt(page, canvas, { x: 6, y: 2 });
  await commit(page, "thickness", "0.2+10cm");
  await expect(field(page, "thickness")).toHaveValue("0.30");
  await commit(page, "thickness", "2.8-");
  await expect(toast(page)).toHaveText("Can't read 2.8-");
  await expect(field(page, "thickness")).toHaveValue("0.30");

  await page.keyboard.press("k");
  await clickAt(page, canvas, { x: 3, y: 2 });
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 3, y: 2 });
  await commit(page, "rotation", "10+5");
  await expect(field(page, "rotation")).toHaveValue("15");
  await commit(page, "rotation", "15cm");
  await expect(toast(page)).toHaveText("Can't read 15cm");
  await expect(field(page, "rotation")).toHaveValue("15");
});

test("the floating bar's fields take typed values (AC-09)", async ({ page }) => {
  await openLocal(page);
  const thickness = page.getByTestId("wall-thickness");
  await page.keyboard.press("w");
  for (const [typed, shown] of [["30cm", "0.30"], ["0,20", "0.20"], ["0.2+0.1", "0.30"]] as const) {
    await thickness.fill(typed);
    await thickness.press("Enter");
    await expect(thickness).toHaveValue(shown);
  }
  await thickness.fill("2.8-");
  await thickness.press("Enter");
  await expect(toast(page)).toHaveText("Can't read 2.8-");
  await expect(thickness).toHaveValue("0.30");

  await page.keyboard.press("c");
  const width = page.getByTestId("column-width");
  await width.fill("0,4");
  await width.press("Enter");
  await expect(width).toHaveValue("0.40");
  await width.fill("20cm+10cm");
  await width.press("Enter");
  await expect(width).toHaveValue("0.30");
});
