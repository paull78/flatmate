import type { Locator, Page } from "@playwright/test";
import { openSection } from "./sections";
import { COLORS } from "@fm/editor";
import { CENTER, ZOOM, type WorldPoint } from "./canvas";

// Plan pictures for the underlay tests, made in the page (OffscreenCanvas), and the geometry to probe them. Every
// helper assumes the initial camera (support/canvas.ts): these tests never pan or zoom.

export type PictureSpec =
  | { kind: "quadrants"; name: string; width: number; height: number; colours: readonly [string, string, string, string]; type: string }
  | { kind: "solid"; name: string; width: number; height: number; colour: string; type: string }
  | { kind: "noise"; name: string; width: number; height: number; seed: number; type: string; quality: number }
  | { kind: "bytes"; name: string; type: string; text?: string; randomBytes?: number };

/** The four quadrants top-left, top-right, bottom-left, bottom-right: they differ in hue and in luma. */
export const QUADRANTS = ["#000000", "#0000ff", "#606060", "#c8c8c8"] as const;

/** Picture A: taller than wide, its splits (240, 352) on 16 px JPEG blocks. */
export const PICTURE_A: PictureSpec = { kind: "quadrants", name: "plan-a.png", width: 480, height: 704, colours: QUADRANTS, type: "image/png" };
/** Picture B: wide, another size, one colour. */
export const PICTURE_B: PictureSpec = { kind: "solid", name: "plan-b.png", width: 320, height: 256, colour: "#ff0000", type: "image/png" };

/**
 * Builds the spec's File in the page. Self-contained: Playwright sends its source text to the page, so it may use no
 * imports and no outer names.
 */
export async function makeFileInPage(spec: PictureSpec): Promise<File> {
  if (spec.kind === "bytes") {
    if (spec.text !== undefined) return new File([spec.text], spec.name, { type: spec.type });
    const bytes = new Uint8Array(spec.randomBytes ?? 1024);
    crypto.getRandomValues(bytes);
    return new File([bytes], spec.name, { type: spec.type });
  }
  const canvas = new OffscreenCanvas(spec.width, spec.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2D context");
  if (spec.kind === "quadrants") {
    const w = spec.width / 2;
    const h = spec.height / 2;
    const [tl, tr, bl, br] = spec.colours;
    for (const [colour, x, y] of [[tl, 0, 0], [tr, w, 0], [bl, 0, h], [br, w, h]] as const) {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, w, h);
    }
  } else if (spec.kind === "solid") {
    ctx.fillStyle = spec.colour;
    ctx.fillRect(0, 0, spec.width, spec.height);
  } else {
    let s = spec.seed >>> 0; // mulberry32
    const next = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    const image = ctx.createImageData(spec.width, spec.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const r = next();
      image.data[i] = r & 0xff;
      image.data[i + 1] = (r >>> 8) & 0xff;
      image.data[i + 2] = (r >>> 16) & 0xff;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  const quality = spec.kind === "noise" ? spec.quality : undefined;
  const blob = await canvas.convertToBlob({ type: spec.type, quality });
  return new File([blob], spec.name, { type: spec.type });
}

/** Drops the picture on the canvas with a real `drop` event, after the `dragover` that lets it land. */
export async function dropPicture(page: Page, spec: PictureSpec): Promise<void> {
  const file = await page.evaluateHandle(makeFileInPage, spec);
  const dataTransfer = await page.evaluateHandle((f) => {
    const dt = new DataTransfer();
    dt.items.add(f);
    return dt;
  }, file);
  const canvas = page.getByTestId("canvas");
  await canvas.dispatchEvent("dragover", { dataTransfer });
  await canvas.dispatchEvent("drop", { dataTransfer });
}

/** Picks the picture through the Underlay section's Choose picture… and the browser's file chooser. */
export async function choosePicture(page: Page, spec: PictureSpec): Promise<void> {
  const file = await page.evaluateHandle(makeFileInPage, spec);
  const b64 = await page.evaluate(
    (f) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(f);
      }),
    file,
  );
  await openSection(page.getByTestId("underlay-section")); // closed until opened (inherit step 06)
  const button = page.getByTestId("underlay-section").getByRole("button", { name: /Choose picture/ });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()]);
  await chooser.setFiles({ name: spec.name, mimeType: spec.type, buffer: Buffer.from(b64, "base64") });
}

/** The world point at the canvas's top-left corner, where a new picture lands (the editor's screenToWorld of (0, 0)). */
export async function viewTopLeft(canvas: Locator): Promise<WorldPoint> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  return { x: CENTER.x - box.width / (2 * ZOOM), y: CENTER.y + box.height / (2 * ZOOM) };
}

/** The world point of picture pixel (u, v) for a picture whose top-left is `origin`: rows run toward −y. */
export function onPicture(origin: WorldPoint, metresPerPixel: number, u: number, v: number): WorldPoint {
  return { x: origin.x + u * metresPerPixel, y: origin.y - v * metresPerPixel };
}

const GRID = 0.2; // gridSpacingFor at the initial zoom: these lines draw over the picture
const CLEAR = 0.04; // 3 px at zoom 80

/** Nudges each coordinate by at most 0.04 m, so it lies at least 0.04 m from a grid line. */
export function offGrid(p: WorldPoint): WorldPoint {
  const nudge = (c: number): number => {
    const r = ((c % GRID) + GRID) % GRID;
    if (r < CLEAR) return c + (CLEAR - r);
    if (r > GRID - CLEAR) return c - (r - (GRID - CLEAR));
    return c;
  };
  return { x: nudge(p.x), y: nudge(p.y) };
}

/** `hex` drawn at `strength` (1 − fade) over the canvas background, as `#rrggbb`. */
export function faded(hex: string, strength = 0.5): string {
  const channel = (s: string, i: number): number => parseInt(s.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(strength * channel(hex, i) + (1 - strength) * channel(COLORS.background, i)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}
