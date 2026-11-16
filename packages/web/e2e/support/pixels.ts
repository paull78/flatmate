import { expect, type Locator, type Page } from "@playwright/test";
import { INITIAL_VIEW, toScreenIn, type View, type WorldPoint } from "./canvas";

/**
 * The composited colour (both canvases, as the user sees them) of the page pixel at a world point, as [r, g, b], seen
 * through `view` (default: the initial camera).
 */
export async function pixelAt(page: Page, canvas: Locator, p: WorldPoint, view: View = INITIAL_VIEW): Promise<number[]> {
  const s = await toScreenIn(canvas, view, p);
  return screenPixel(page, s.x, s.y);
}

/** The colour on screen at a page point, whatever is drawn there (an overlay, a panel, the canvas). */
export async function screenPixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString("base64"));
}

/** Channel-wise distance to a `#rrggbb` colour. */
export function distance(rgb: number[], hex: string): number {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...want.map((w, i) => Math.abs(w - (rgb[i] ?? -1000))));
}

/** Waits (frames are drawn on the next animation frame) until the pixel is within `tolerance` of `hex`. */
export async function expectPixel(
  page: Page,
  canvas: Locator,
  p: WorldPoint,
  hex: string,
  tolerance = 12,
  view: View = INITIAL_VIEW,
): Promise<void> {
  await expect.poll(async () => distance(await pixelAt(page, canvas, p, view), hex), { message: `pixel at (${p.x}, ${p.y}) ≈ ${hex}` }).toBeLessThanOrEqual(tolerance);
}

/** How many page pixels of an element lie within `tolerance` of a `#rrggbb` colour, read from a screenshot. */
export async function countPixels(page: Page, element: Locator, hex: string, tolerance = 12): Promise<number> {
  const png = await element.screenshot();
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // Counted in the page: copying a whole canvas's channels back as an array took most of a poll's 5 s (openings3d.20).
  return page.evaluate(async ([base64, r, g, b, off]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${String(base64)}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    const near = (at: number, channel: unknown): boolean => Math.abs((data[at] ?? -1000) - Number(channel)) <= Number(off);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (near(i, r) && near(i + 1, g) && near(i + 2, b)) count += 1;
    return count;
  }, [png.toString("base64"), want[0], want[1], want[2], tolerance]);
}
