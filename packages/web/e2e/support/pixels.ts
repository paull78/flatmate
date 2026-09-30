import { expect, type Locator, type Page } from "@playwright/test";
import { toScreen, type WorldPoint } from "./canvas";

/** The composited colour (both canvases, as the user sees them) of the page pixel at a world point, as [r, g, b]. */
export async function pixelAt(page: Page, canvas: Locator, p: WorldPoint): Promise<number[]> {
  const s = await toScreen(canvas, p);
  const png = await page.screenshot({ clip: { x: Math.floor(s.x), y: Math.floor(s.y), width: 1, height: 1 } });
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
export async function expectPixel(page: Page, canvas: Locator, p: WorldPoint, hex: string, tolerance = 12): Promise<void> {
  await expect.poll(async () => distance(await pixelAt(page, canvas, p), hex), { message: `pixel at (${p.x}, ${p.y}) ≈ ${hex}` }).toBeLessThanOrEqual(tolerance);
}
