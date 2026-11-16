import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRoomWithDivider, moveTo } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { pickCard } from "./support/palette";

// The ux-polish cycle in the browser: the floating bar, the renderer chip, the object ghost and chain editing.
// Local mode (`server=off`); the divided sample room: left room x 0–3, y 0–4, bottom-left wall (0, 0) → (3, 0).

const canvasOf = (page: Page) => page.getByTestId("canvas");

async function open(page: Page, renderer: "canvas2d" | "webgl" = "canvas2d"): Promise<void> {
  await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
  await expect(canvasOf(page)).toBeVisible();
}

test("the floating bar picks tools and shows each tool's setting; the renderer chip switches renderers (AC-12, AC-13)", async ({ page }) => {
  await open(page);
  const bar = page.getByTestId("floating-bar");
  for (const tool of ["wall", "zone", "object", "opening", "select"]) {
    await bar.locator(`[data-tool="${tool}"]`).click();
    await expect(bar.locator(`[data-tool="${tool}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await bar.locator('[data-tool="wall"]').click();
  await expect(page.getByTestId("wall-thickness")).toBeVisible();
  await bar.locator('[data-tool="opening"]').click();
  await expect(page.getByTestId("opening-kind")).toBeVisible();
  await expect(page.getByTestId("wall-thickness")).toHaveCount(0);
  await expect(page.getByTestId("command-bar")).toContainText("Click on a wall");

  const chip = page.locator('[data-action="renderer"]');
  await expect(chip).toHaveText("Canvas2D");
  await chip.click();
  await expect(chip).toHaveText("WebGL");
});

for (const renderer of ["canvas2d", "webgl"] as const) {
  test(`${renderer}: the bed's ghost shows under the pointer and a click places the bed there (AC-01)`, async ({ page }) => {
    await open(page, renderer);
    const canvas = canvasOf(page);
    await drawRoomWithDivider(page, canvas);
    await pickCard(page, "bed");
    const probe = { x: 1.15, y: 1.5 }; // inside the footprint of a bed centred at (1.5, 2), clear of its symbol lines
    await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.background)).toBeLessThan(12);
    await moveTo(page, canvas, { x: 1.5, y: 2 });
    await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.background)).toBeGreaterThan(12);
    await clickAt(page, canvas, { x: 1.5, y: 2 });
    await moveTo(page, canvas, { x: 8, y: -1 }); // the ghost goes with the pointer; the placed bed stays
    await expectPixel(page, canvas, probe, COLORS.object);
  });
}

test("typing 1.50 into the first chain piece places the door 1.50 from the wall's inner face (AC-19)", async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  await drawRoomWithDivider(page, canvas);
  await page.keyboard.press("d");
  await clickAt(page, canvas, { x: 1.5, y: 0.05 }); // a 0.80 m door at offset 1.10 on the bottom-left wall
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 0.5, y: 0 }); // select the wall, away from the door
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("3.00");
  // The chain row sits on the room side (left of a → b), its text 18 px beyond the face (y = 0.1) at 80 px/m.
  await clickAt(page, canvas, { x: 0.55, y: 0.1 + 18 / 80 });
  await expect(page.getByTestId("command-bar")).toContainText("Distance");
  await page.keyboard.type("1.5");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape"); // deselect: a selected wall draws blue
  await moveTo(page, canvas, { x: 8, y: -1 });
  // Clear: the door spans 1.60–2.40 (1.50 from the inner face at 0.10). On the centre line it would span 1.50–2.30.
  await expectPixel(page, canvas, { x: 2.35, y: 0 }, COLORS.background); // an unlabelled room's span (thresholds.05)
  await expectPixel(page, canvas, { x: 1.55, y: 0 }, COLORS.wall);
});

test("a door over another door toasts in plain words, with no IDs; the favicon loads (AC-20)", async ({ page, request }) => {
  await open(page);
  const canvas = canvasOf(page);
  await drawRoomWithDivider(page, canvas);
  await page.keyboard.press("d");
  await clickAt(page, canvas, { x: 1.5, y: 0.05 });
  await clickAt(page, canvas, { x: 1.7, y: 0.05 }); // a second door over the first
  await expect(page.getByRole("status")).toHaveText("This door would overlap a door on this wall");
  // With no level strip the toast keeps its place, 72 px above the window's bottom (cleanup.04).
  const box = await page.getByRole("status").boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("toast not laid out");
  expect(viewport.height - (box.y + box.height)).toBeCloseTo(72, 0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  expect((await request.get("/favicon.svg")).status()).toBe(200);
});
