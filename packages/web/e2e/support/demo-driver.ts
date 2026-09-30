import { expect, type Page } from "@playwright/test";
import { ZOOM, clickAt, moveTo, toScreen, typeLengthAndWait, type WorldPoint } from "./canvas";

const HALF_WALL = 0.1; // WALL_THICKNESS / 2
const HELPER_OFFSET_PX = 18; // helperLabelAt: the text centre is 18 px beyond the wall face

export const canvasOf = (page: Page) => page.getByTestId("canvas");

export async function worldToPage(page: Page, p: WorldPoint): Promise<WorldPoint> {
  return toScreen(canvasOf(page), p);
}

/** Server mode: one edit is outstanding at a time (spec §7.4), so wait for it before the next one. */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("project-status")).toHaveText("saved");
}

/** Server mode: open the project by name, creating it first if it does not exist (demo steps 1 and 7). */
export async function openProject(page: Page, name: string): Promise<void> {
  const field = page.getByPlaceholder("Project name");
  await field.waitFor();
  const existing = page.getByRole("button", { name, exact: true });
  if ((await existing.count()) === 0) {
    await field.fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
  } else {
    await existing.click();
  }
  await field.waitFor({ state: "hidden" });
}

/** Demo steps 2–4 on a shared drawing: the 6 × 4 m room, the midpoint divider, and a zone in each room. */
export async function drawDemoApartment(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift"); // digits still type as digits: the input adapter reads the physical key (spec §5.4)
  const legs: [WorldPoint, string][] = [[{ x: 2, y: 0.1 }, "6"], [{ x: 6.1, y: 2 }, "4"], [{ x: 3, y: 4.1 }, "6"]];
  for (const [p, length] of legs) {
    await moveTo(page, canvas, p);
    await typeLengthAndWait(page, length);
  }
  await clickAt(page, canvas, { x: 0.05, y: 0.02 }); // the first joint closes the chain
  await page.keyboard.up("Shift");
  await waitSaved(page);

  await clickAt(page, canvas, { x: 3.07, y: 0.02 }); // midpoint snap → (3, 0)
  await page.keyboard.down("Shift");
  await clickAt(page, canvas, { x: 2.96, y: 3.97 }); // vertical axis + midpoint snap → (3, 4)
  await page.keyboard.up("Shift");
  await waitSaved(page);
  await page.keyboard.press("Enter"); // the chain resumed; an empty Enter finishes it

  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 1.5, y: 2 });
  await waitSaved(page);
  await clickAt(page, canvas, { x: 4.5, y: 2 });
  await waitSaved(page);
}

/** Page position of the helper dimension text of the wall a→b (mirrors helperLabelAt at the default zoom). */
export async function helperLabelPage(page: Page, a: WorldPoint, b: WorldPoint): Promise<WorldPoint> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const left = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const offset = HALF_WALL + HELPER_OFFSET_PX / ZOOM;
  return worldToPage(page, { x: (a.x + b.x) / 2 + left.x * offset, y: (a.y + b.y) / 2 + left.y * offset });
}
