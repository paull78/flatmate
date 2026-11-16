import type { Page } from "@playwright/test";
import { camera3d, type Angles3d, type Bounds3, type Point3 } from "@fm/editor";

// The 3D panel's pixels (real3d steps 04, 07): the WebGL picture fits a centred square of the panel's host, so a world
// point lands where the editor's own camera puts it, at the angles the panel shows (its data-yaw and data-tilt).

/** The camera's angles the 3D panel shows. */
export async function angles3d(page: Page): Promise<Angles3d> {
  const panel = page.getByTestId("view3d-panel");
  const [yaw, tilt] = await Promise.all([panel.getAttribute("data-yaw"), panel.getAttribute("data-tilt")]);
  if (yaw === null || tilt === null) throw new Error("the 3D panel shows no angles");
  return { yaw: Number(yaw), tilt: Number(tilt) };
}

type Box = { x: number; y: number; width: number; height: number };
type Square = { x: number; y: number; side: number };

/** The 3D panel's host in page pixels. */
async function host3d(page: Page): Promise<Box> {
  const box = await page.getByTestId("view3d").boundingBox();
  if (box === null) throw new Error("no 3D host");
  return box;
}

const squareOf = (box: Box): Square => {
  const side = Math.min(box.width, box.height);
  return { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, side };
};

/** The 3D panel's picture square in page pixels (its top left and side): the host's centred square. */
export async function square3d(page: Page): Promise<Square> {
  return squareOf(await host3d(page));
}

/** A drag in the 3D panel from its centre by (dx, dy) pixels in `steps` small moves, as a hand makes them (0.4° a pixel). */
export async function drag3d(page: Page, dx: number, dy: number, steps = 20): Promise<void> {
  const box = await host3d(page);
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
}

/**
 * The 3D panel at the angles it shows now: `at` gives the page point, unrounded, where a world point lands, and `square`
 * the picture's square in page pixels.
 */
export async function projector3d(page: Page, bounds: Bounds3): Promise<{ at: (p: Point3) => { x: number; y: number }; square: Square }> {
  const box = await host3d(page);
  const square = squareOf(box);
  const camera = camera3d(bounds, await angles3d(page));
  const at = (p: Point3): { x: number; y: number } => {
    const q = camera.project(p);
    return { x: box.x + box.width / 2 + (q.x * square.side) / 2, y: box.y + box.height / 2 - (q.y * square.side) / 2 };
  };
  return { at, square };
}

/** The page point where world point `p` lands in the 3D panel, at the angles it shows. */
export async function screen3d(page: Page, bounds: Bounds3, p: Point3): Promise<{ x: number; y: number }> {
  const q = (await projector3d(page, bounds)).at(p);
  return { x: Math.floor(q.x), y: Math.floor(q.y) };
}

/** The panel's pixels as RGB rows, read from a screenshot (the WebGL canvas keeps no drawing buffer to read back). */
export async function panelPixels(page: Page): Promise<{ x: number; y: number; width: number; height: number; rgb: number[] }> {
  const box = await host3d(page);
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width), height: Math.floor(box.height) };
  const png = await page.screenshot({ clip });
  const rgb = await page.evaluate(async ([base64, w, h]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(w, h).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const out: number[] = [];
    for (let i = 0; i < data.length; i += 4) out.push(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    return out;
  }, [png.toString("base64"), clip.width, clip.height] as const);
  return { ...clip, rgb };
}

/** A "#rrggbb" colour as its three bytes. */
export const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * The panel's clear colour: a pixel midway between the host's edge and the picture's square, on its longer side, where
 * only the clear colour lies. The host must be far from square, as the split panel is.
 */
export async function clearColour(page: Page): Promise<number[]> {
  const { width, height, rgb } = await panelPixels(page);
  const square = squareOf({ x: 0, y: 0, width, height }); // in the panel's own pixels
  if (Math.abs(width - height) <= 40) throw new Error(`the host (${width} × ${height}) should be far from square`);
  const [x, y] = width > height ? [Math.floor(square.x / 2), Math.floor(height / 2)] : [Math.floor(width / 2), Math.floor(square.y / 2)];
  const at = (y * width + x) * 3;
  return rgb.slice(at, at + 3);
}

/** How far `read` is from `want`: its largest channel difference. */
export const offBy = (read: readonly number[], want: readonly number[]): number => Math.max(...want.map((w, c) => Math.abs((read[c] ?? -99) - w)));

/** Whether `read` is within 2 per channel of the colour `hex`. */
export const nearColour = (read: number[], hex: string): boolean => offBy(read, rgbOf(hex)) <= 2;

/** The mean page y of the panel's pixels within `tolerance` of `hex` (null when there are none): where a colour sits. */
export async function meanY3d(page: Page, hex: string, tolerance = 6): Promise<number | null> {
  const { y, width, rgb } = await panelPixels(page);
  const want = rgbOf(hex);
  let sum = 0;
  let n = 0;
  for (let k = 0; k * 3 < rgb.length; k++) {
    if (want.every((w, c) => Math.abs((rgb[k * 3 + c] ?? 0) - w) <= tolerance)) {
      sum += y + Math.floor(k / width);
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}
