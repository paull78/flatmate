import type { Page } from "@playwright/test";
import { CHROME_FONT, COLORS, textWidth } from "@fm/editor";
import type { WorldPoint } from "./canvas";
import { distance } from "./pixels";

// A plate at the pointer, read from the page's pixels (clarity.02, .21): it's canvas text, so the page can't read its
// words. Its box is worked out from the words' width.

// As view/plate.ts draws it, in page pixels from the pointer.
const BELOW = 16;
const HEIGHT = 22;
const LINE = 16; // a second line, the advice (sizing.09)
const PAD = 8;
const SIZE = 12;
const TEXT_NEAR = 24; // a pixel reads as the words' colour this close: `invalid`, the ghost's, is 44 from the refusal's
const WHITE_NEAR = 6;

export type Box = { x: number; y: number; width: number; height: number };

export const plateBox = (pointer: WorldPoint, words: string, advice?: string): Box => {
  const width = Math.max(textWidth(CHROME_FONT, words, SIZE), advice === undefined ? 0 : textWidth(CHROME_FONT, advice, SIZE)) + 2 * PAD;
  return { x: pointer.x - width / 2, y: pointer.y + BELOW, width, height: HEIGHT + (advice === undefined ? 0 : LINE) };
};

/** The band a plate under this pointer can lie in, whatever its words, with a second line or not: the canvas's whole width. */
export async function bandUnder(page: Page, pointer: WorldPoint): Promise<Box> {
  const canvas = await page.getByTestId("canvas").boundingBox();
  if (canvas === null) throw new Error("canvas is not visible");
  return { x: canvas.x, y: pointer.y + BELOW, width: canvas.width, height: HEIGHT + LINE };
}

/** The plate's box, with a pixel's slack on each side for the border and the rounding. */
export const withSlack = (box: Box): Box => ({ x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 });

export const shot = (page: Page, box: Box): Promise<Buffer> =>
  page.screenshot({ clip: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) } });

/** The pixels of a page region as `rgb(x, y)`, x and y from its corner; a corner off the whole pixel is rounded down. */
export type Pixels = { width: number; height: number; rgb: (x: number, y: number) => number[] };

export async function decode(page: Page, png: Buffer): Promise<Pixels> {
  const { width, height, data } = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) };
  }, png.toString("base64"));
  return { width, height, rgb: (x, y) => data.slice((y * width + x) * 4, (y * width + x) * 4 + 3) };
}

/** How many pixels read as this colour. */
export function pixelsNear(p: Pixels, hex: string, near = TEXT_NEAR): number {
  let n = 0;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (distance(p.rgb(x, y), hex) <= near) n++;
  return n;
}

/** What's missing from a plate read from its box, with `withSlack`: empty when it's all there. */
export function plateFaults(p: Pixels, { line, text }: { line: string; text: string }): string[] {
  const faults: string[] = [];
  // The padding around the words, inside the border: all white, so no line of the ghost crosses the box.
  const whiteAt = (x: number, y: number, where: string): void => {
    const c = p.rgb(x, y);
    if (distance(c, COLORS.field) > WHITE_NEAR) faults.push(`${where} (${x}, ${y}) is ${c.join(",")}`);
  };
  const right = p.width - 1;
  const bottom = p.height - 1;
  for (let x = 2; x <= right - 2; x++) for (const y of [2, 3, bottom - 3, bottom - 2]) whiteAt(x, y, "row");
  for (let y = 2; y <= bottom - 2; y++) for (const x of [3, 4, right - 4, right - 3]) whiteAt(x, y, "column");
  // The border where these words' width puts it: a pixel on each side, at the box's middle.
  const middle = Math.floor(p.height / 2);
  const borderIn = (xs: number[], where: string): void => {
    const seen = xs.map((x) => distance(p.rgb(x, middle), line));
    if (Math.min(...seen) > 90) faults.push(`no border ${where}: ${seen.join(",")}`);
  };
  borderIn([0, 1, 2], "on the left");
  borderIn([right - 2, right - 1, right], "on the right");
  const words = pixelsNear(p, text);
  if (words < 20) faults.push(`only ${words} pixels of the words' colour`);
  return faults;
}
