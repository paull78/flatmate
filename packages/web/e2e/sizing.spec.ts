import { expect, test, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, dragFromTo, drawRectRoom, moveTo, toScreen } from "./support/canvas";
import { decode, plateBox, plateFaults, shot, withSlack } from "./support/plate";
import { pickCard } from "./support/palette";

// The sizing cycle in a real browser (spec "The typed size", sizing.06, .12): Width and Depth typed in the hint line
// size the next piece; Enter, Tab and leaving a field commit; the keys go back to the plan after Enter. Local mode, a
// 6 × 4 room drawn with the Wall tool (inner faces x 0.1–5.9, y 0.1–3.9).

const canvasOf = (page: Page): Locator => page.getByTestId("canvas");
const width = (page: Page): Locator => page.getByTestId("size-width");
const depth = (page: Page): Locator => page.getByTestId("size-depth");
const height = (page: Page): Locator => page.getByTestId("size-height");
const focused = (el: Locator): Promise<boolean> => el.evaluate((node) => node === document.activeElement);
const MIDDLE = { x: 3, y: 2 };

async function armed(page: Page, kind: string): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await pickCard(page, kind);
}

/** Properties' field for the piece at `at`, selected with the Select tool. */
async function propertyAt(page: Page, at: { x: number; y: number }, id: string): Promise<Locator> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), at);
  return page.locator(`[data-field-id="${id}"]`);
}

test("AC-01: Width 0.83 and Depth 0.55 typed in the hint line size the wardrobe a click places", async ({ page }) => {
  await armed(page, "wardrobe");
  await width(page).fill("0.83");
  await width(page).press("Enter");
  await depth(page).fill("0.55");
  await depth(page).press("Enter");
  await expect(page.getByTestId("size-picker-select")).toHaveValue("Custom");
  await moveTo(page, canvasOf(page), { x: 2.9, y: 2 }); // the pointer left the canvas while typing: no ghost until it's back
  await clickAt(page, canvasOf(page), MIDDLE);
  await expect(await propertyAt(page, MIDDLE, "width")).toHaveValue("0.83");
  await expect(page.locator('[data-field-id="depth"]')).toHaveValue("0.55");
});

test("AC-12: after Enter in Width, R turns the ghost and Esc returns to Select, with no click on the canvas", async ({ page }) => {
  await armed(page, "wardrobe");
  await width(page).fill("0.83");
  await width(page).press("Enter");
  expect(await focused(width(page))).toBe(false);
  await moveTo(page, canvasOf(page), { x: 2.9, y: 2 });
  await moveTo(page, canvasOf(page), MIDDLE);
  await page.keyboard.press("r");
  await clickAt(page, canvasOf(page), MIDDLE);
  await expect(await propertyAt(page, MIDDLE, "angle")).toHaveValue("90");
  await pickCard(page, "wardrobe");
  await width(page).fill("0.9");
  await width(page).press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
});

test("a letter typed in Width stays in the field: the ghost doesn't turn and the field is marked invalid", async ({ page }) => {
  await armed(page, "wardrobe");
  await width(page).fill("");
  await page.keyboard.type("1.2r"); // real key presses aimed at the field: the plan's R must not see them
  await expect(width(page)).toHaveValue("1.2r");
  await width(page).press("Enter");
  await expect(width(page)).toHaveAttribute("aria-invalid", "true");
  await expect(width(page)).toHaveValue("1.2r");
  await moveTo(page, canvasOf(page), { x: 2.9, y: 2 });
  await clickAt(page, canvasOf(page), MIDDLE); // the last good size, 1.20 × 0.60, not turned
  await expect(await propertyAt(page, MIDDLE, "angle")).toHaveValue("0");
  await expect(page.locator('[data-field-id="width"]')).toHaveValue("1.20");
});

test("Tab in Width commits it and moves to Depth; a click on the plan commits Depth", async ({ page }) => {
  await armed(page, "wardrobe");
  await width(page).fill("0.9");
  await width(page).press("Tab");
  expect(await focused(depth(page))).toBe(true);
  await expect(width(page)).toHaveValue("0.90");
  await depth(page).fill("0.5");
  await clickAt(page, canvasOf(page), { x: 1, y: 1 });
  await expect(depth(page)).toHaveValue("0.50");
  await expect(page.getByTestId("size-picker-select")).toHaveValue("Custom");
});

// At 1000 px, with the palette and Properties open, the hint line is about 376 px wide: the narrowest where the list
// and the fields fit beside a cut prompt. Narrower stages clip the bar's controls, as they already clip the floating
// bar (tidy.35, sizing.25).
test("in a 1000 px window the fields stay whole inside the hint line and the prompt gives way", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await armed(page, "wardrobe");
  const bar = await page.getByTestId("command-bar").boundingBox();
  const fields = await page.getByTestId("size-fields").boundingBox();
  if (!bar || !fields) throw new Error("no hint line");
  expect(fields.x).toBeGreaterThanOrEqual(bar.x);
  expect(fields.x + fields.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
  const cut = await page.locator(".hint-line .command-prompt").evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(cut).toBe(true);
});

test("Height 1.40 typed in the hint line is the height a click places (sizing step 06)", async ({ page }) => {
  await armed(page, "wardrobe");
  await expect(height(page)).toHaveValue("2.05");
  await height(page).fill("1.40");
  await height(page).press("Enter");
  await moveTo(page, canvasOf(page), { x: 2.9, y: 2 });
  await clickAt(page, canvasOf(page), MIDDLE);
  await expect(await propertyAt(page, MIDDLE, "height.standard")).toHaveValue("1.40");
});

test("AC-09: a bed in a 1.20 m room rests on a two-line plate, and the advised drag places one (sizing step 08)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 1.4, 2.8); // inner faces x 0.1–1.3, y 0.1–2.7
  await pickCard(page, "bed");
  await moveTo(page, canvasOf(page), { x: 0.6, y: 1.3 });
  await moveTo(page, canvasOf(page), { x: 0.7, y: 1.4 });
  const pointer = await toScreen(canvasOf(page), { x: 0.7, y: 1.4 });
  const box = withSlack(plateBox(pointer, "Bed (0.00–1.00) overlaps a wall in Layout", "Drag to draw it to size"));
  await expect.poll(async () => plateFaults(await decode(page, await shot(page, box)), { line: COLORS.invalid, text: COLORS.refusalText }), { message: "the two-line plate" }).toEqual([]);
  await dragFromTo(page, canvasOf(page), { x: 0.13, y: 0.13 }, { x: 1.27, y: 2.27 });
  await expect(await propertyAt(page, { x: 0.7, y: 1.2 }, "width")).toHaveValue("1.20"); // the corners snap to the wall faces
});

/** Presses at `a`, moves to `b` in steps as a hand does, and keeps the button down. */
async function pressAndDraw(page: Page, a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> {
  const from = await toScreen(canvasOf(page), a);
  const to = await toScreen(canvasOf(page), b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test("AC-04: a wardrobe drawn 1.20 × 0.60, turned by R mid-drag, is placed 0.60 × 1.20; one Undo removes it (sizing step 11)", async ({ page }) => {
  await armed(page, "wardrobe");
  await pressAndDraw(page, { x: 2, y: 2.4 }, { x: 3.2, y: 1.8 });
  await page.keyboard.press("r");
  await page.mouse.up();
  await expect(await propertyAt(page, { x: 2.6, y: 2.1 }, "width")).toHaveValue("0.60");
  await expect(page.locator('[data-field-id="depth"]')).toHaveValue("1.20");
  await page.keyboard.press("ControlOrMeta+z");
  await clickAt(page, canvasOf(page), { x: 2.6, y: 2.1 });
  await expect(page.locator('[data-field-id="width"]')).toHaveCount(0);
});

test("a typed size and a drawn one in turn: the click after a drawing places the typed size (sizing step 11)", async ({ page }) => {
  await armed(page, "wardrobe");
  await width(page).fill("0.83");
  await width(page).press("Tab");
  await page.keyboard.type("0.55");
  await page.keyboard.press("Enter");
  await pressAndDraw(page, { x: 1, y: 3 }, { x: 2, y: 2.5 });
  await page.mouse.up();
  await expect(width(page)).toHaveValue("0.83");
  await moveTo(page, canvasOf(page), { x: 4.4, y: 2 });
  await clickAt(page, canvasOf(page), { x: 4.5, y: 2 });
  await expect(await propertyAt(page, { x: 4.5, y: 2 }, "width")).toHaveValue("0.83");
  await expect(page.locator('[data-field-id="depth"]')).toHaveValue("0.55");
  await expect(await propertyAt(page, { x: 1.5, y: 2.75 }, "width")).toHaveValue("1.00");
});

for (const renderer of ["canvas2d", "webgl"]) {
  test(`the same drawn wardrobe in ${renderer} is placed 1.20 × 0.60 at the same angle (sizing step 11)`, async ({ page }) => {
    await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
    await expect(canvasOf(page)).toBeVisible();
    await drawRectRoom(page, canvasOf(page), 6, 4);
    await pickCard(page, "wardrobe");
    await pressAndDraw(page, { x: 2, y: 2.4 }, { x: 3.2, y: 1.8 });
    await page.mouse.up();
    await expect(await propertyAt(page, { x: 2.6, y: 2.1 }, "width")).toHaveValue("1.20");
    await expect(page.locator('[data-field-id="depth"]')).toHaveValue("0.60");
    await expect(page.locator('[data-field-id="angle"]')).toHaveValue("0");
  });
}

test("AC-10: a counter drawn towards a fridge, released 8 cm short, lands flush with it (sizing step 13)", async ({ page }) => {
  await armed(page, "fridge");
  await moveTo(page, canvasOf(page), { x: 4, y: 3.5 });
  await clickAt(page, canvasOf(page), { x: 4, y: 3.6 }); // flush on the back wall: x 3.70–4.30
  await expect(await propertyAt(page, { x: 4, y: 3.6 }, "width")).toHaveValue("0.60");
  await pickCard(page, "counter");
  await pressAndDraw(page, { x: 2.03, y: 3.87 }, { x: 3.62, y: 3.3 });
  await page.mouse.up();
  await expect(await propertyAt(page, { x: 2.8, y: 3.6 }, "width")).toHaveValue("1.67"); // 2.03 to the fridge's side at 3.70
});
