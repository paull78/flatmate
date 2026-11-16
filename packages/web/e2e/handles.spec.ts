import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, dragFromTo, drawRectRoom, moveTo } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { pickCard } from "./support/palette";

// Furniture grips in the browser (spec: tools, direct.03–direct.06). The room is 6 × 4 with inner faces at x 0.1/5.9 and
// y 0.1/3.9; the sofa bed (2.00 × 0.90) is centred on (3, 2): x 2–4, y 1.55–2.45, front facing −y. Its right grip is at
// (4, 2), its rotation grip at (3, 1.25). At zoom 80 the Auto snap step is 0.2 m, so drags end on that grid.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 8, y: -1 }; // the cursor off the drawing, so no hover changes the probes
const RIGHT_GRIP = { x: 4, y: 2 };
const ROTATE_GRIP = { x: 3, y: 1.25 }; // 1.55 − ROTATE_GRIP_PX (24) / 80, view/handles.ts

async function sofaInRoom(page: Page, renderer: "canvas2d" | "webgl"): Promise<void> {
  await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();
  await expect(page.locator('[data-action="renderer"]')).toHaveText(renderer === "webgl" ? "WebGL" : "Canvas2D"); // no fallback
  await drawRectRoom(page, canvas, 6, 4);
  await pickCard(page, "sofaBed");
  await clickAt(page, canvas, { x: 3, y: 2 });
  // A new sofa bed is 2.10 wide; these probes assume the 2.00 one.
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 3, y: 2 });
  const width = page.locator('[data-field-id="width"]');
  await width.fill("2.00");
  await width.press("Enter");
  await expect(width).toHaveValue("2.00");
  await page.keyboard.press("Escape");
}

for (const renderer of ["canvas2d", "webgl"] as const) {
  test(`${renderer}: one selected piece shows grips, Esc hides them (AC-01)`, async ({ page }) => {
    await sofaInRoom(page, renderer);
    const canvas = canvasOf(page);
    await page.keyboard.press("v");
    await page.keyboard.press("Escape");
    await moveTo(page, canvas, AWAY);
    const probe = { x: 4 - 3 / 80, y: 2 }; // 3 px inside the right grip, clear of the arm line at x 3.8 and the edge
    await expectPixel(page, canvas, probe, COLORS.object);

    await clickAt(page, canvas, { x: 3, y: 2 });
    await moveTo(page, canvas, AWAY);
    await expect
      .poll(async () => {
        const rgb = await pixelAt(page, canvas, probe);
        return Math.min(distance(rgb, COLORS.objectSelected), distance(rgb, COLORS.object));
      }, { message: "the grip is drawn over the selected fill" })
      .toBeGreaterThan(12);

    await page.keyboard.press("Escape");
    await expectPixel(page, canvas, probe, COLORS.object);
  });
}

test("canvas2d: resize by the right grip, flush to a wall, a refused resize, and a turn by the rotation grip, each undone (AC-02..AC-05)", async ({ page }) => {
  await sofaInRoom(page, "canvas2d");
  const canvas = canvasOf(page);
  const width = page.locator('[data-field-id="width"]');
  const angle = page.locator('[data-field-id="angle"]');
  const undo = page.locator('[data-testid="floating-bar"] [data-action="undo"]');
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 3, y: 2 });
  await expect(width).toHaveValue("2.00");
  await expect(page.locator('[data-field-id="depth"]')).toHaveValue("0.90");
  await expect(angle).toHaveValue("0");

  // AC-02: +0.40 m on the 0.2 m grid; the left side stays at x 2.
  await dragFromTo(page, canvas, RIGHT_GRIP, { x: 4.4, y: 2 });
  await expect(width).toHaveValue("2.40");
  await expect(page.locator('[data-field-id="depth"]')).toHaveValue("0.90");
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, { x: 4.3, y: 1.7 }, COLORS.objectSelected);
  await expectPixel(page, canvas, { x: 1.95, y: 1.7 }, COLORS.background);
  await undo.click();
  await expect(width).toHaveValue("2.00");

  // AC-04: the side ends 4 px from the face at x 5.9, so the face wins over the grid.
  await dragFromTo(page, canvas, RIGHT_GRIP, { x: 5.85, y: 2 });
  await expect(width).toHaveValue("3.90");
  await undo.click();
  await expect(width).toHaveValue("2.00");

  // AC-03: the side crosses the wall; nothing is committed, so there is nothing to undo.
  await dragFromTo(page, canvas, RIGHT_GRIP, { x: 6.3, y: 2 });
  await expect(page.locator(".fm-toast")).toBeVisible();
  await expect(width).toHaveValue("2.00");

  // AC-05: (3.6, 1.4) is at −45° from the centre (3, 2), a 45° turn.
  await dragFromTo(page, canvas, ROTATE_GRIP, { x: 3.6, y: 1.4 });
  await expect(angle).toHaveValue("45");
  await undo.click();
  await expect(angle).toHaveValue("0");
});
