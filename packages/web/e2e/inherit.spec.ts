import { expect, test, type Page } from "@playwright/test";
import { finishShades, type Point3 } from "@fm/editor";
import { clickAt, drawRectRoom } from "./support/canvas";
import { distance, screenPixel } from "./support/pixels";
import { screen3d } from "./support/probe3d";
import { openSection } from "./support/sections";

// Inherited wall finishes in the browser (inherit step 09, AC-02, AC-03, AC-05, AC-06, AC-08, AC-09): the house's outside
// walls and a room's walls set once, seen in the WebGL 3D panel; a customised wall keeps its finish when the room is
// repainted; a wall drawn later comes out in the room's; Reset returns the custom wall; Properties sections remember
// being opened. drawRectRoom's 6 × 4 m room: its north wall's inner face at y 3.9, its south wall's outer face at y −0.1.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const panel = (page: Page) => page.getByTestId("view3d-panel");
const ROOM = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 };
const INNER = { x: 3, y: 3.9, z: 1.2 }; // the north wall's inner face, seen over the south wall from the default camera
const OUTER = { x: 3, y: -0.1, z: 1.2 }; // the south wall's outer face, facing the default camera
const BLUE = "#2f3e57", SAGE = "#a8b59a", RED = "#d0302a", SAND = "#e3d9c6";

async function offByAt(page: Page, p: Point3, hex: string): Promise<number> {
  const s = await screen3d(page, ROOM, p);
  const seen = await screenPixel(page, s.x, s.y);
  const shades = finishShades(hex);
  return Math.min(distance(seen, shades.lit), distance(seen, shades.shaded));
}
const near = (page: Page, p: Point3, hex: string, message: string) => expect.poll(() => offByAt(page, p, hex), { message }).toBeLessThanOrEqual(14);

/**
 * Opens the 3D panel (split, as set at the start) to look, then closes it: clicks on the plan go to world points only
 * while the plan has the whole canvas (with the panel docked, a point near the top lands on the tool bar).
 */
async function in3d(page: Page, look: () => Promise<void>): Promise<void> {
  await page.getByTestId("open3d").click();
  await expect(panel(page)).toHaveAttribute("data-size", "split");
  await look();
  await page.locator('[data-action="close3d"]').click();
  await expect(page.getByTestId("open3d")).toBeVisible();
}

/** Opens a finish's row if closed, picks Plain and types the colour. */
async function paint(page: Page, rowId: string, hexId: string, hex: string): Promise<void> {
  const row = page.locator(`[data-finish-id="${rowId}"]`);
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  const pattern = page.locator(`select[data-field-id="${rowId.slice("row:".length)}"]`);
  if ((await pattern.inputValue()) !== "plain") await pattern.selectOption("plain");
  const box = page.locator(`[data-field-id="${hexId}"]`);
  await box.fill(hex);
  await box.press("Enter");
}

test("outside walls and a room's walls set once; a custom wall survives a repaint; a new wall inherits; Reset returns it", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=webgl");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("z"); // label the room: "Room 1"
  await clickAt(page, canvasOf(page), { x: 1, y: 1 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit3"); // the 3D panel docked under the plan, then closed until we look
  await expect(panel(page)).toHaveAttribute("data-size", "split");
  await page.locator('[data-action="close3d"]').click();

  // The house's outside walls, with nothing selected; under a flat ceiling the Outside switch shows them (AC-08, AC-09).
  await expect(page.getByTestId("outside-section")).toBeVisible();
  await paint(page, "row:outside.finish", "outside.hex", BLUE);
  await in3d(page, async () => {
    const outside = page.locator('[data-action="roof3d"]');
    await expect(outside).toHaveAttribute("title", "Show the outside walls");
    await outside.click();
    await near(page, OUTER, BLUE, "the south wall's outer face in the house's blue");
    await outside.click();
  });

  // The room's walls (AC-02, AC-06).
  await clickAt(page, canvasOf(page), { x: 3, y: 2 });
  await paint(page, "row:walls.finish", "walls.hex", SAGE);
  await in3d(page, () => near(page, INNER, SAGE, "the north wall's inner face in the room's sage"));

  // Customize the north wall's room side: its Finish row opens; it turns red (AC-05).
  await clickAt(page, canvasOf(page), { x: 3, y: 4 });
  const side = page.locator("details.prop-section", { hasText: "Room 1 side" });
  await expect(side.locator('[data-field-id$=".customize"]')).toHaveAttribute("aria-label", /Room 1's walls/);
  await side.locator('[data-field-id$=".customize"]').click();
  await expect(side.locator('[data-finish-id$=".finish"]')).toHaveAttribute("aria-expanded", "true");
  const hex = side.locator('[data-field-id$=".hex"]:not([data-field-id*=".lower."])');
  await hex.fill(RED);
  await hex.press("Enter");
  await in3d(page, () => near(page, INNER, RED, "the custom side in red"));

  // Repaint the room: the custom side keeps its red (AC-02).
  await clickAt(page, canvasOf(page), { x: 3, y: 2 });
  await paint(page, "row:walls.finish", "walls.hex", SAND);
  await expect(page.locator('[data-field-id="walls.note"]')).toHaveText("Every side facing Room 1 shows these, but 1 custom");
  await in3d(page, () => near(page, INNER, RED, "the custom side still red after the room's repaint"));

  // A wall drawn later comes out in the room's walls default (AC-03).
  await page.keyboard.press("Escape");
  await page.keyboard.press("w");
  await clickAt(page, canvasOf(page), { x: 4, y: 1 });
  await clickAt(page, canvasOf(page), { x: 5, y: 1 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await clickAt(page, canvasOf(page), { x: 4.5, y: 1 });
  await expect(page.locator("details.prop-section", { hasText: "Left side" }).locator('[data-field-id$=".customize"]')).toHaveAttribute("aria-label", /Room 1's walls/);

  // Reset the north wall: back to the room's sand.
  await clickAt(page, canvasOf(page), { x: 3, y: 4 });
  await side.locator('[data-field-id$=".reset"]').click();
  await in3d(page, () => near(page, INNER, SAND, "the reset side shows the room's sand"));
});

test("a Properties section stays opened or closed after a reload (AC-08)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const shortcuts = page.getByTestId("shortcuts-section");
  expect(await shortcuts.evaluate((d) => d.hasAttribute("open"))).toBe(false); // closed until opened
  await openSection(shortcuts);
  // The toggle event saves it a moment after the click; a person's reload comes later than a test's.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fm-sections"))).toBe('{"Shortcuts":true}');
  await page.reload();
  await expect(page.getByTestId("shortcuts-section")).toHaveAttribute("open", "");
});
