import { expect, test, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRectRoom, moveTo, type WorldPoint } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { pickCard } from "./support/palette";

// The duplicate's ghost in the browser (ghost.01, ghost.03), read through pixels in Canvas2D (headless has no WebGL2,
// direct.30). A 5 × 4 room (inner faces x 0.1/4.9, y 0.1/3.9) holds a desk centred on DESK: x 1.0–2.2, y 1.7–2.3.
// Every probe that can read floor or a see-through ghost sits 0.07 m (5.6 px) off the 0.2 m grid on both axes, and
// at least 5 px clear of: the 0.2/1 m grid, the guides at y 1.7/2.0/2.3, the distance lines along y 2.0 and x 3.6
// and their plates, the 5 px size and rotation grips, the edges, the symbol's middle rectangles and the name label.
// Recheck all of these if a probe moves.
// ORIGINAL and GHOST are the same point of the desk and of its unturned copy at SPOT, (+0.47, −0.13) from each centre;
// TURNED lies inside the copy turned by R (x 3.3–3.9, y 1.4–2.6) and above an unturned one.
const DESK = { x: 1.6, y: 2 };
const SPOT = { x: 3.6, y: 2 };
const AWAY = { x: 8, y: -1 }; // only with no ghost up: moving away carries the ghost along
const ORIGINAL = { x: 2.07, y: 1.87 };
const GHOST = { x: 4.07, y: 1.87 };
const TURNED = { x: 3.67, y: 2.47 };

async function setup(page: Page): Promise<Locator> {
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 5, 4);
  await pickCard(page, "desk");
  await clickAt(page, canvas, DESK); // a 1.2 × 0.6 desk centred on the click
  await page.keyboard.press("v");
  return canvas;
}

/** Something other than the floor is drawn there: a see-through ghost reads about 20 from the background. */
async function expectShows(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  await expect.poll(async () => distance(await pixelAt(page, canvas, p), COLORS.background), { message: `something at (${p.x}, ${p.y})` }).toBeGreaterThan(12);
}

/** How far the pixel is from either furniture fill: red over the desk reads far from both. */
async function fromFurniture(page: Page, canvas: Locator, p: WorldPoint): Promise<number> {
  const rgb = await pixelAt(page, canvas, p);
  return Math.min(distance(rgb, COLORS.object), distance(rgb, COLORS.objectSelected));
}

test("Cmd/Ctrl+D picks up a ghost; move, R and a click place a turned copy; one undo removes it; Esc and Cmd+Z drop a ghost (AC-01, AC-02, AC-04, AC-07)", async ({ page }) => {
  const canvas = await setup(page);
  const kind = page.locator('[data-field-id="kind"]');

  await clickAt(page, canvas, DESK);
  await expect(kind).toHaveValue("desk");
  await page.keyboard.press("ControlOrMeta+d");
  await moveTo(page, canvas, SPOT); // the ghost centres on the cursor: x 3.0–4.2, y 1.7–2.3
  await expectShows(page, canvas, GHOST);
  await page.keyboard.press("r"); // turned 90° about its centre: x 3.3–3.9, y 1.4–2.6
  await expectPixel(page, canvas, GHOST, COLORS.background);
  await expectShows(page, canvas, TURNED);

  await clickAt(page, canvas, SPOT); // the press places the copy and selects it
  await expect(kind).toHaveValue("desk");
  await expect(page.locator('[data-field-id="angle"]')).toHaveValue("90");
  await expect(page.locator('[data-field-id="width"]')).toHaveValue("1.20");
  await expect(page.getByTestId("properties-group")).toHaveCount(0);
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, TURNED, COLORS.objectSelected);
  await expectPixel(page, canvas, GHOST, COLORS.background);
  await expectPixel(page, canvas, ORIGINAL, COLORS.object);

  await page.keyboard.press("ControlOrMeta+z"); // one undo removes the copy
  await expectPixel(page, canvas, TURNED, COLORS.background);
  await expectPixel(page, canvas, ORIGINAL, COLORS.object);
  await clickAt(page, canvas, SPOT);
  await expect(kind).toHaveCount(0);

  // Esc drops the ghost: nothing placed.
  await clickAt(page, canvas, DESK);
  await page.keyboard.press("ControlOrMeta+d");
  await moveTo(page, canvas, SPOT);
  await expectShows(page, canvas, GHOST);
  await page.keyboard.press("Escape");
  await expectPixel(page, canvas, GHOST, COLORS.background);
  await clickAt(page, canvas, SPOT);
  await expect(kind).toHaveCount(0);

  // Cmd/Ctrl+Z drops the ghost and undoes nothing: the desk's own placement stays.
  await clickAt(page, canvas, DESK);
  await page.keyboard.press("ControlOrMeta+d");
  await moveTo(page, canvas, SPOT);
  await expectShows(page, canvas, GHOST);
  await page.keyboard.press("ControlOrMeta+z");
  await expectPixel(page, canvas, GHOST, COLORS.background);
  await clickAt(page, canvas, DESK);
  await expect(kind).toHaveValue("desk");
});

test("the Duplicate button picks up the ghost over the original; it follows the pointer onto the canvas and a click places the copy (AC-08)", async ({ page }) => {
  const canvas = await setup(page);

  await clickAt(page, canvas, DESK);
  await page.getByTestId("prop-duplicate").click(); // the mouse goes to the panel: the canvas gets pointerleave
  // Over the desk, the ghost and the desk are drawn red.
  await expect.poll(() => fromFurniture(page, canvas, ORIGINAL), { message: "red over the desk" }).toBeGreaterThan(12);

  await moveTo(page, canvas, SPOT); // from the first move the ghost centres on the cursor
  await expectShows(page, canvas, GHOST);
  await expect.poll(() => fromFurniture(page, canvas, ORIGINAL), { message: "the desk no longer red" }).toBeLessThanOrEqual(12);

  await clickAt(page, canvas, SPOT); // the original stays selected while copying, so Properties can't show the copy
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, GHOST, COLORS.objectSelected);
  await expectPixel(page, canvas, ORIGINAL, COLORS.object);

  await page.keyboard.press("ControlOrMeta+z");
  await expectPixel(page, canvas, GHOST, COLORS.background);
});
