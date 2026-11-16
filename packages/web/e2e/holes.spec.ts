import { expect, test, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRectRoom, moveTo, type WorldPoint } from "./support/canvas";
import { expectPixel } from "./support/pixels";

// Rooms with holes in the browser (AC-01, AC-07, AC-08), Canvas2D only (headless has no WebGL2, direct.30). The
// apartment of AC-01 does not fit the default camera, so the same shape at screen size: room R 6 × 4 (clear 22.04) and
// a core 2 × 2 at (2,1)–(4,3), 0.20 m walls (footprint 4.84, interior 3.24). The ring nets 22.04 − 4.84 = 17.20.
// The probes sit 0.1 m off the 0.2 m grid lines, clear of the tags at (1, 2) and (3, 2).

const RING_FLOOR = { x: 1.3, y: 0.5 };
const CORE_FLOOR = { x: 3.3, y: 2.1 };

/** A closed loop with the Wall tool; two Escapes end the chain and the tool (as `drawRectRoom`). */
async function drawLoop(page: Page, canvas: Locator, points: WorldPoint[]): Promise<void> {
  await page.keyboard.press("w");
  for (const p of points) await clickAt(page, canvas, p);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

/** Select tool, then Esc on idle clears the selection: Properties shows the rooms table. */
async function showRoomsTable(page: Page): Promise<Locator> {
  await page.keyboard.press("v");
  await page.keyboard.press("Escape");
  const table = page.getByTestId("rooms-table");
  await expect(table).toBeVisible();
  return table;
}

test("a core inside a room: Properties, the rooms table and the floor leave the core out (AC-01, AC-07, AC-08)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  const name = page.locator('[data-field-id="name"]');
  const area = page.locator('[data-field-id="area"]');

  await drawRectRoom(page, canvas, 6, 4);
  await drawLoop(page, canvas, [
    { x: 2, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
    { x: 2, y: 3 },
    { x: 2, y: 1 },
  ]);

  // AC-01: the ring's area leaves the core's footprint out (22.04 without holes).
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 1, y: 2 });
  await expect(name).toHaveValue("Room 1");
  await expect(area).toHaveValue("17.20 m²");

  // AC-08: a rectangle with a hole has no size line (5.80 × 3.80 m without holes).
  let table = await showRoomsTable(page);
  const room1 = table.locator('[data-room="Room 1"]');
  await expect(room1.locator("td").first()).toHaveText("17.20 m²");
  await expect(room1.locator(".prop-room-size")).toHaveCount(0);

  // AC-07: the ring's fill leaves the core uncovered. Probed before the core is labelled, when it would get its own fill.
  await moveTo(page, canvas, { x: 8, y: -1 }); // keep the snap glyph off the probes
  await expectPixel(page, canvas, RING_FLOOR, COLORS.openingFloor); // zoneFill over the background
  await expectPixel(page, canvas, CORE_FLOOR, COLORS.background);

  // The innermost room wins: a click inside the core's outline labels the core.
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 3, y: 2 });
  await expect(name).toHaveValue("Room 2");
  await expect(area).toHaveValue("3.24 m²");

  // The nested room counts once: 17.20 + 3.24 (25.28 before holes).
  table = await showRoomsTable(page);
  await expect(table.locator("tfoot td").first()).toHaveText("20.44 m²");
  await expect(table.locator('[data-room="Room 2"] .prop-room-size')).toHaveText("1.80 × 1.80 m");
  await expect(table.locator('[data-room="Room 1"] .prop-room-size')).toHaveCount(0);

  // Each floor selects its own room.
  await clickAt(page, canvas, { x: 1, y: 2 });
  await expect(name).toHaveValue("Room 1");
  await expect(area).toHaveValue("17.20 m²");
  await clickAt(page, canvas, CORE_FLOOR);
  await expect(name).toHaveValue("Room 2");
  await expect(area).toHaveValue("3.24 m²");
});
