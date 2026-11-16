import { expect, test, type Page } from "@playwright/test";
import { STYLE_3D, finishShades, type Point3 } from "@fm/editor";
import { clickAt, drawRectRoom } from "./support/canvas";
import { distance, screenPixel } from "./support/pixels";
import { screen3d } from "./support/probe3d";

// Wall finishes in the browser (surfaces step 05, AC-02, AC-05; inherit step 05): select a wall, customize the side
// facing the room and pick its finish in Properties, and the WebGL 3D panel shows that face in its colour; the other side keeps the grey; undo clears
// it. drawRectRoom's 6 × 4 m room runs counter-clockwise, so its north wall's inner face is at y 3.9, facing south.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const panel = (page: Page) => page.getByTestId("view3d-panel");
const ROOM = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 };
const RED = "#d0302a";
const SQUARE_TILES = "#e8e4dc"; // square tiles' default colour (the domain's motif table)
const INNER = { x: 3, y: 3.9, z: 1.2 }; // the north wall's inner face, seen over the south wall from the default camera

/** How far the panel's pixel at world point `p` is from the nearest of `colours`. */
async function offByAt(page: Page, p: Point3, colours: readonly string[]): Promise<number> {
  const s = await screen3d(page, ROOM, p);
  const seen = await screenPixel(page, s.x, s.y);
  return Math.min(...colours.map((c) => distance(seen, c)));
}

/** The room, the north wall selected, and the 3D view open in split. */
async function roomWithNorthWall(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off&renderer=webgl");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await clickAt(page, canvasOf(page), { x: 3, y: 4 });
  await expect(page.locator('[data-field-id="thickness"]')).toBeVisible();
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(panel(page)).toHaveAttribute("data-size", "split");
}

/** Customizes the room side (inherit step 05): it then starts as Plain White, its own (inherit.02, .04). */
async function customize(page: Page): Promise<void> {
  const side = page.locator("details.prop-section", { hasText: "Room side" });
  await side.locator('[data-field-id$=".customize"]').click();
  await expect(side.locator('[data-field-id$=".reset"]')).toBeVisible();
}
/** Opens the room side's Finish or Lower row (inherit step 04: a finish is one row until opened). */
async function openRow(page: Page, which: "finish" | "lower"): Promise<void> {
  const side = page.locator("details.prop-section", { hasText: "Room side" });
  const row = which === "finish" ? side.locator('[data-finish-id$=".finish"]') : side.locator('[data-finish-id$=".lower.motif"]');
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
}
/** The Finish select of the wall's side facing the room. */
const roomSideFinish = (page: Page) => page.locator("details.prop-section", { hasText: "Room side" }).locator('select[data-field-id$=".finish"]');
const roomSideHex = (page: Page) => page.locator("details.prop-section", { hasText: "Room side" }).locator('[data-field-id$=".hex"]:not([data-field-id*=".lower."])');
const roomSideLower = (page: Page) => page.locator("details.prop-section", { hasText: "Room side" }).locator('select[data-field-id$=".lower.motif"]');

test("a painted side shows in the 3D panel and undo clears it (AC-02, AC-05)", async ({ page }) => {
  await roomWithNorthWall(page);
  await expect(page.locator("details.prop-section", { hasText: "Outside" })).toBeVisible();
  const greys = [STYLE_3D.wall.lit, STYLE_3D.wall.shaded];
  await expect.poll(() => offByAt(page, INNER, greys), { message: "the inner face is grey before" }).toBeLessThanOrEqual(14);

  await customize(page); // Plain White, its own: one undo step
  await openRow(page, "finish");
  await expect(roomSideFinish(page)).toHaveValue("plain");
  await roomSideHex(page).fill(RED);
  await roomSideHex(page).press("Enter");
  const red = finishShades(RED);
  await expect.poll(() => offByAt(page, INNER, [red.lit, red.shaded]), { message: "the inner face takes the red" }).toBeLessThanOrEqual(14);

  await page.keyboard.press("Escape");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => offByAt(page, INNER, greys), { message: "undo leaves the grey" }).toBeLessThanOrEqual(14);
});

test("square tiles to 1.20 with sage paint above, in the 3D panel (step 08, AC-05)", async ({ page }) => {
  await roomWithNorthWall(page);
  const SAGE = "#a8b59a";
  await customize(page);
  await openRow(page, "finish");
  await roomSideHex(page).fill(SAGE);
  await roomSideHex(page).press("Enter");
  await openRow(page, "lower");
  await roomSideLower(page).selectOption("squareTiles");
  const tiles = finishShades(SQUARE_TILES);
  const sage = finishShades(SAGE);
  // Inside a tile (rows at 0.30 and 0.60 from 0.00, joints at x 3.1 and 3.4 from the face's west end) and well above the band.
  await expect.poll(() => offByAt(page, { x: 3.25, y: 3.9, z: 0.45 }, [tiles.lit, tiles.shaded]), { message: "the tiles below 1.20" }).toBeLessThanOrEqual(14);
  await expect.poll(() => offByAt(page, { x: 3.3, y: 3.9, z: 1.9 }, [sage.lit, sage.shaded]), { message: "the paint above" }).toBeLessThanOrEqual(14);
});
