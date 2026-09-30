import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRoomWithDivider, moveTo, typeLength } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";

// S1 (spec §1.4 step 10, §6.2): the WebGL2 renderer and the live toggle. Local mode (`server=off`).
// Probes read composited page pixels; they check "the right colour is there", not pixel parity between renderers.

const WALL_CENTRE = { x: 1.5, y: 0 }; // bottom wall, 16 px thick at the default zoom
const RIGHT_WALL_CENTRE = { x: 6, y: 1 };
const EMPTY_FLOOR = { x: 1.37, y: 2.13 }; // inside the left room, between grid lines; no zone yet

const canvasOf = (page: Page) => page.getByTestId("canvas");
const toggle = (page: Page) => page.locator('[data-action="renderer"]');

async function open(page: Page, renderer: "canvas2d" | "webgl"): Promise<void> {
  await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
  await expect(canvasOf(page)).toBeVisible();
}

for (const renderer of ["canvas2d", "webgl"] as const) {
  test(`${renderer}: walls are wall-coloured and the floor shows the background`, async ({ page }) => {
    await open(page, renderer);
    await expect(toggle(page)).toHaveText(renderer === "webgl" ? "WebGL" : "Canvas2D");
    await expect(page.getByTestId("renderer-notice")).toHaveCount(0);
    await drawRoomWithDivider(page, canvasOf(page));
    await moveTo(page, canvasOf(page), { x: 8, y: -1 }); // keep snap glyphs away from the probes
    await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall);
    await expectPixel(page, canvasOf(page), RIGHT_WALL_CENTRE, COLORS.wall);
    await expectPixel(page, canvasOf(page), EMPTY_FLOOR, COLORS.background);
  });
}

test("toggling mid-drawing keeps the drawing and the wall chain", async ({ page }) => {
  await open(page, "canvas2d");
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 3, y: 0 });
  await typeLength(page, "6");

  await toggle(page).click(); // → WebGL, while the chain waits for its next point
  await expect(toggle(page)).toHaveText("WebGL");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expectPixel(page, canvas, WALL_CENTRE, COLORS.wall);
  await expect(page.getByTestId("command-bar")).toContainText("Next point or length");

  await moveTo(page, canvas, { x: 6, y: 2 });
  await typeLength(page, "4");
  await toggle(page).click(); // → Canvas2D
  await expect(toggle(page)).toHaveText("Canvas2D");
  await expectPixel(page, canvas, RIGHT_WALL_CENTRE, COLORS.wall);
  await page.keyboard.press("Enter"); // an empty Enter ends the chain
  await page.keyboard.up("Shift");

  await page.keyboard.press("v");
  await clickAt(page, canvas, RIGHT_WALL_CENTRE);
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("4.00");
});

test("webgl: ?sdf=debug shows the distance field outside a wall; without it that pixel is background", async ({ page }) => {
  // 6 px below the bottom face of a wall on y = 0 (16 px thick), between grid lines (0.2 m apart at this zoom).
  const outside = { x: 1.37, y: -0.175 };
  for (const debug of [true, false]) {
    await page.goto(`/?name=Alice&server=off&renderer=webgl${debug ? "&sdf=debug" : ""}`);
    const canvas = canvasOf(page);
    await expect(canvas).toBeVisible();
    await expect(toggle(page)).toHaveText("WebGL");
    await page.keyboard.press("w");
    await clickAt(page, canvas, { x: 0, y: 0 });
    await clickAt(page, canvas, { x: 3, y: 0 });
    await page.keyboard.press("Enter");
    await moveTo(page, canvas, { x: 8, y: -1 }); // keep snap glyphs away from the probes
    await expectPixel(page, canvas, WALL_CENTRE, COLORS.wall);
    if (debug) {
      await expect.poll(async () => distance(await pixelAt(page, canvas, outside), COLORS.background), { message: "a distance band" }).toBeGreaterThan(12);
    } else {
      await expectPixel(page, canvas, outside, COLORS.background);
    }
  }
});

test("falls back to Canvas2D with a notice when WebGL2 is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === "webgl2" ? null : Reflect.apply(original, this, [type, ...rest]);
      },
    });
  });
  await open(page, "webgl");
  await expect(page.getByTestId("renderer-notice")).toHaveText("WebGL2 is unavailable: drawing with Canvas2D");
  await expect(toggle(page)).toHaveText("Canvas2D");
  await drawRoomWithDivider(page, canvasOf(page));
  await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall);
});

test("falls back to Canvas2D, keeping the drawing, when the WebGL context is lost", async ({ page }) => {
  await open(page, "webgl");
  await drawRoomWithDivider(page, canvasOf(page));
  await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall);
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gl-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no WebGL canvas");
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByTestId("renderer-notice")).toHaveText("WebGL context lost: drawing with Canvas2D");
  await expect(toggle(page)).toHaveText("Canvas2D");
  await expectPixel(page, canvasOf(page), WALL_CENTRE, COLORS.wall); // the last scene, redrawn by Canvas2D
});
