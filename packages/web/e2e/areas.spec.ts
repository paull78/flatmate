import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { dragFromTo, drawRectRoom, moveTo, toScreen, type WorldPoint } from "./support/canvas";

// Named areas in the browser (areas step 08; AC-02, AC-05, AC-06), Canvas2D only (headless has no WebGL2, direct.30):
// Z and a drag draw "Area 1", selected; typing in Properties renames it; its tag draws inside its rectangle, and its
// outline only while selected. Room 6 × 4 (faces x 0.1–5.9, y 0.1–3.9); the area 1–3 × 1–3.

type Box = { x: number; y: number; width: number; height: number };

/** The page box over the world rectangle with corners `a` and `b`. */
async function worldBox(page: Page, a: WorldPoint, b: WorldPoint): Promise<Box> {
  const canvas = page.getByTestId("canvas");
  const p = await toScreen(canvas, a);
  const q = await toScreen(canvas, b);
  const x = Math.round(Math.min(p.x, q.x));
  const y = Math.round(Math.min(p.y, q.y));
  return { x, y, width: Math.max(1, Math.round(Math.abs(q.x - p.x))), height: Math.max(1, Math.round(Math.abs(q.y - p.y))) };
}

/** How many pixels of a page box are within 40 of `hex`, or darker than 120 on every channel with `hex` null. */
async function countIn(page: Page, box: Box, hex: string | null): Promise<number> {
  const png = await page.screenshot({ clip: box });
  const want = hex === null ? null : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return page.evaluate(async ([base64, rgb]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${String(base64)}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const px = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      const hit = rgb === null ? px.every((c) => c < 120) : px.every((c, k) => Math.abs(c - Number((rgb as number[])[k])) <= 40);
      if (hit) n += 1;
    }
    return n;
  }, [png.toString("base64"), want] as const);
}

test("Z and a drag draw a named area; renamed in Properties, its tag shows and its outline only while selected (AC-02, AC-05, AC-06)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 6, 4);
  // The strip along the area's left side before the area exists: with nothing selected it must look the same again.
  await page.keyboard.press("v");
  await moveTo(page, canvas, { x: 5, y: 3.5 });
  const side = await worldBox(page, { x: 0.9, y: 1.5 }, { x: 1.1, y: 2.5 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const before = (await page.screenshot({ clip: side })).toString("base64");

  await page.keyboard.press("z");
  await page.keyboard.down("Control"); // the cm only: the corners land where asked
  await dragFromTo(page, canvas, { x: 1, y: 1 }, { x: 3, y: 3 });
  await page.keyboard.up("Control");
  const name = page.locator('[data-field-id="name"]');
  await expect(name).toHaveValue("Area 1");
  await expect(page.locator('[data-field-id="area"]')).toHaveValue("4.00 m²");
  await name.click();
  await name.fill("Kitchen");
  await name.press("Enter");
  await expect(name).toHaveValue("Kitchen");

  // Selected: its left side (x = 1) draws in the selection blue, in the Zone tool and in Select.
  await page.keyboard.press("v");
  await moveTo(page, canvas, { x: 5, y: 3.5 });
  await expect.poll(() => countIn(page, side, COLORS.wallSelected)).toBeGreaterThan(20);
  // The tag's dark text sits inside the rectangle.
  const inside = await worldBox(page, { x: 1.2, y: 1.2 }, { x: 2.8, y: 2.8 });
  await expect.poll(() => countIn(page, inside, null)).toBeGreaterThan(20);

  // Nothing selected: the strip along the side is as it was before the area, the tag still there.
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await page.screenshot({ clip: side })).toString("base64") === before).toBe(true);
  await expect.poll(() => countIn(page, inside, null)).toBeGreaterThan(20);
});
