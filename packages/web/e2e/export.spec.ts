import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom } from "./support/canvas";

// Export (spec "The sheets view"; AC-04, AC-05, AC-07, AC-12): the floating bar's Export opens the full-screen sheets
// view, whose Save PDF and small menu save files.

async function drawRoom(page: Page): Promise<void> {
  const canvas = page.getByTestId("canvas");
  await drawRectRoom(page, canvas, 5, 4);
}

/** Pixels of the active layout pill's blue on screen, where the pill dock lies. */
async function pillBlue(page: Page): Promise<number> {
  const box = await page.locator(".pill-dock").boundingBox();
  if (!box) throw new Error("no pill dock");
  const shot = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.abs((data[i] ?? 0) - 0x25) + Math.abs((data[i + 1] ?? 0) - 0x63) + Math.abs((data[i + 2] ?? 0) - 0xeb) < 12) blue++;
    return blue;
  }, shot.toString("base64"));
}

test("Export is disabled on an empty drawing, then downloads an SVG of the plan", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  const exportButton = page.getByTestId("export-button");
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toHaveAttribute("title", "Draw some walls first");

  await drawRoom(page);
  await expect(exportButton).toBeEnabled();
  expect(await pillBlue(page)).toBeGreaterThan(50); // the control: the active layout's pill, before the view opens
  await exportButton.click();
  await expect(page.getByTestId("sheets-view")).toBeVisible();
  expect(await pillBlue(page)).toBe(0); // it covers the whole app, the floating pills too; hit tests can't tell, as they skip what's inert
  await page.getByTestId("images-button").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-format="svg"]').click()]);
  expect(download.suggestedFilename()).toBe("Untitled.svg");
  const path = await download.path();
  const text = await readFile(path, "utf8");
  expect(text.startsWith("<svg")).toBe(true);
  expect(text).toContain("<path");
  expect(text).toContain('width="'); // sized in millimetres
  await expect(page.getByTestId("sheets-view")).toBeVisible(); // saving leaves it open
  await page.getByTestId("sheets-close").click();
  await expect(page.getByTestId("sheets-view")).toBeHidden();
});

test("Export downloads a PDF with one page per layout, A4 at fit by default", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await drawRoom(page);
  await page.getByTestId("state-add").click(); // a second layout
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheets-paper")).toHaveValue("A4");
  await expect(page.getByTestId("sheets-scale").locator("option").first()).toHaveText("Fit (1:50)");
  await expect(page.getByTestId("sheets-status")).toHaveText("Whole plans on every sheet");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  expect(download.suggestedFilename()).toBe("Untitled.pdf");
  const bytes = await readFile(await download.path());
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(text).toContain("/MediaBox [0 0 841.89 595.28]"); // A4 landscape
});

test("Export downloads a PNG of the plan, 3,000 px on its long side, white at the corners", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await drawRoom(page);
  await page.getByTestId("export-button").click();
  await page.getByTestId("images-button").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-format="png"]').click()]);
  expect(download.suggestedFilename()).toBe("Untitled.png");
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(Math.max(width, height)).toBe(3000);
  // Decode it in the page and read the four corner pixels.
  const corners = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0);
    return [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]].map(([x, y]) => [...ctx.getImageData(x ?? 0, y ?? 0, 1, 1).data]);
  }, bytes.toString("base64"));
  expect(corners).toEqual([[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]]);
});

/** Marks every sheet's canvas by how often it's been drawn: none until it's on screen. */
const draws = (page: Page) => page.getByTestId("sheet-canvas").evaluateAll((canvases) => canvases.map((c) => (c instanceof HTMLElement ? Number(c.dataset["draws"] ?? 0) : -1)));

test("only pages on screen draw", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await drawRoom(page);
  for (let i = 0; i < 3; i++) await page.getByTestId("state-add").click(); // four layouts, four sheets
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-canvas")).toHaveCount(4);
  await expect.poll(async () => (await draws(page))[0]).toBe(1);
  const first = await draws(page);
  expect(first[3]).toBe(0); // far below the desk's fold
  await page.getByTestId("sheets-desk").evaluate((desk) => desk.scrollTo(0, desk.scrollHeight));
  await expect.poll(async () => (await draws(page))[3]).toBe(1);
  // Scrolling back to an unchanged page doesn't draw it again.
  await page.getByTestId("sheets-desk").evaluate((desk) => desk.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.getByTestId("sheets-desk").evaluate((desk) => desk.scrollTo(0, desk.scrollHeight));
  await page.waitForTimeout(100);
  expect((await draws(page))[3]).toBe(1);
  expect((await draws(page))[0]).toBe(1);
  // A change redraws what's on screen, once it's looked at; what's scrolled away waits.
  const before = await draws(page);
  await page.getByTestId("sheets-paper").selectOption("A3");
  await expect.poll(async () => (await draws(page))[3]).toBeGreaterThan(before[3] ?? 0);
  expect((await draws(page))[0]).toBe(before[0]);
  // A real picture on the page: dark ink in the canvas, not only its white paper.
  const ink = await page.getByTestId("sheet-canvas").nth(3).evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) return 0;
    const data = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 90) dark++;
    return dark;
  });
  expect(ink).toBeGreaterThan(500);
});

test("in the view, ⌘Z undoes from the paper list, keys don't reach the plan, and Escape leaves", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await drawRoom(page);
  await clickAt(page, page.getByTestId("canvas"), { x: 2.5, y: 0 }); // a wall selected under the view
  const wallField = page.locator('[data-field-id="length"], [data-field-id="wall.length"]').first();
  await expect(wallField).toBeVisible();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheets-view")).toBeVisible();
  await expect(page.getByTestId("sheets-view")).toBeFocused();

  const paper = page.getByTestId("sheets-paper");
  await paper.focus();
  await paper.selectOption("A3");
  await expect(paper).toHaveValue("A3");
  await expect(paper).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(paper).toHaveValue("A4");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(paper).toHaveValue("A3");
  await page.locator('[data-action="sheets-undo"]').click();
  await expect(paper).toHaveValue("A4");
  await page.locator('[data-action="sheets-redo"]').click();
  await expect(paper).toHaveValue("A3");

  // From the view's own surface and from the body: none of these reach the plan or the tool.
  await page.getByTestId("sheets-desk").click({ position: { x: 4, y: 4 } });
  for (const key of ["Delete", "Backspace", "v", "w", "ArrowLeft"]) await page.keyboard.press(key);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (const key of ["Delete", "Backspace", "w", "ArrowLeft"]) await page.keyboard.press(key);
  await expect(page.getByTestId("sheets-view")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sheets-view")).toBeHidden();
  // The wall is still there and still selected, in the same tool; the same key reaches the plan now.
  await expect(wallField).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(wallField).toBeHidden();
});

test("opening the view with a wall being drawn doesn't close it, and the wall waits underneath", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await drawRoom(page);
  await page.keyboard.press("w");
  await clickAt(page, page.getByTestId("canvas"), { x: 1, y: 1 });
  await expect(page.getByTestId("value-input")).toBeFocused();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheets-view")).toBeVisible();
  await page.waitForTimeout(100); // a focus loss is read a tick later, and would close the view by an Escape
  await expect(page.getByTestId("sheets-view")).toBeVisible();
  await expect(page.getByTestId("sheets-view")).toBeFocused();
  await page.keyboard.type("3");
  await page.getByTestId("sheets-close").click();
  await expect(page.getByTestId("value-input")).toBeFocused(); // the drawing resumes, with the typed 3 kept out of it
  await expect(page.getByTestId("value-input")).toHaveValue("");
});

test("the zoom changes the pages on screen and nothing stored", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await drawRoom(page);
  await page.getByTestId("export-button").click();
  const canvas = page.getByTestId("sheet-canvas").first();
  await expect.poll(async () => (await draws(page))[0]).toBe(1);
  const width = async (): Promise<number> => (await canvas.boundingBox())?.width ?? 0;
  await page.getByTestId("sheets-zoom-out").click(); // from the fit it opens at to the 100% below it, on this window
  await expect(page.getByTestId("sheets-zoom")).toHaveText("100%");
  await expect.poll(width).toBe(594);
  await expect.poll(async () => (await draws(page))[0]).toBe(2);
  await page.getByTestId("sheets-zoom-in").click();
  await expect(page.getByTestId("sheets-zoom")).toHaveText("125%");
  await expect.poll(width).toBe(743);
  await expect.poll(async () => (await draws(page))[0]).toBe(3);
  await expect(page.locator('[data-action="sheets-redo"]')).toBeDisabled();
});
