import { expect, type Locator, type Page } from "@playwright/test";

// Mirrors the editor's initial camera (README contracts): centre (3, 2), 80 px per metre, world y up.
export const CENTER = { x: 3, y: 2 };
export const ZOOM = 80;

export type WorldPoint = { x: number; y: number };

export async function toScreen(canvas: Locator, p: WorldPoint): Promise<WorldPoint> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  return {
    x: box.x + box.width / 2 + (p.x - CENTER.x) * ZOOM,
    y: box.y + box.height / 2 - (p.y - CENTER.y) * ZOOM,
  };
}

export async function moveTo(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  const s = await toScreen(canvas, p);
  await page.mouse.move(s.x, s.y, { steps: 4 });
}

export async function clickAt(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  await moveTo(page, canvas, p);
  await page.mouse.down();
  await page.mouse.up();
}

export async function typeLength(page: Page, value: string): Promise<void> {
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

/** Demo steps 2–3: the 6 × 4 room by typed lengths with Shift held, then the divider between the two midpoints. */
export async function drawRoomWithDivider(page: Page, canvas: Locator): Promise<void> {
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 3, y: 0 });
  await typeLength(page, "6");
  await moveTo(page, canvas, { x: 6, y: 2 });
  await typeLength(page, "4");
  await moveTo(page, canvas, { x: 3, y: 4 });
  await typeLength(page, "6");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await clickAt(page, canvas, { x: 3, y: 0 }); // midpoint of the bottom wall
  await clickAt(page, canvas, { x: 3, y: 4 }); // midpoint of the top wall, on the vertical axis
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
}

export async function dragFromTo(page: Page, canvas: Locator, from: WorldPoint, to: WorldPoint): Promise<void> {
  await moveTo(page, canvas, from);
  await page.mouse.down();
  await moveTo(page, canvas, to);
  await page.mouse.up();
}

/**
 * Types a length and confirms it, then waits until the chain draws again. On a shared drawing the chain pauses
 * until the server accepts the segment (spec §5.5), and digits typed meanwhile are ignored.
 */
export async function typeLengthAndWait(page: Page, value: string): Promise<void> {
  await typeLength(page, value);
  await expect(page.getByTestId("command-value")).toHaveText("");
  await expect(page.getByTestId("command-bar")).toContainText("Next point or length");
}

/** Demo step 2 on a shared drawing: W, Shift held, typed lengths along the cursor direction, then the first joint. */
export async function drawDemoRoom(page: Page, canvas: Locator): Promise<void> {
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  const legs: [WorldPoint, string][] = [
    [{ x: 3, y: 0 }, "6"],
    [{ x: 6, y: 2 }, "4"],
    [{ x: 3, y: 4 }, "6"],
  ];
  for (const [p, length] of legs) {
    await moveTo(page, canvas, p);
    await typeLengthAndWait(page, length);
  }
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.up("Shift");
}
