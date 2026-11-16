import { expect, type Page } from "@playwright/test";
import { ZOOM, clickAt, moveTo, toScreen, typeLengthAndWait, type WorldPoint } from "./canvas";

const HALF_WALL = 0.1; // half the default wall thickness (DEFAULT_WALL_THICKNESS / 2)
const HELPER_OFFSET_PX = 18; // helperLabelAt: the text centre is 18 px beyond the room-side face

export const canvasOf = (page: Page) => page.getByTestId("canvas");

export async function worldToPage(page: Page, p: WorldPoint): Promise<WorldPoint> {
  return toScreen(canvasOf(page), p);
}

/** Server mode: one edit is outstanding at a time (spec: collaboration), so wait for it before the next one. */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("project-status")).toHaveText("saved");
}

/** Server mode: open the project by name, creating it first if it does not exist (Try it steps 1 and 7). */
export async function openProject(page: Page, name: string): Promise<void> {
  const field = page.getByPlaceholder("Project name");
  await field.waitFor();
  // The form shows before the list arrives: counting then would make an empty namesake of a project that exists (graphics.12, clarity.40).
  await expect(page.getByTestId("project-list").getByText("Loading…")).toBeHidden();
  const existing = page.getByRole("button", { name, exact: true });
  if ((await existing.count()) === 0) {
    await field.fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
  } else {
    await existing.click();
  }
  await field.waitFor({ state: "hidden" });
}

/** Try it steps 2–4 on a shared drawing: the 6 × 4 m room, the midpoint divider, and a zone in each room. */
export async function drawSampleApartment(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift"); // digits still type as digits: the input adapter reads the physical key (spec: tools)
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

/**
 * Page position of the helper dimension text of the wall a→b (mirrors helperLabelAt at the default zoom): 18 px beyond
 * its `room`-side face (left or right of a → b), at the face's middle. Holds for a wall without openings whose face
 * starts and ends the same distance in from its joints (both corners alike), so the face's middle is the wall's.
 */
export async function helperLabelPage(page: Page, a: WorldPoint, b: WorldPoint, room: "left" | "right" = "left"): Promise<WorldPoint> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const s = room === "left" ? 1 : -1;
  const normal = { x: (-s * (b.y - a.y)) / len, y: (s * (b.x - a.x)) / len };
  const offset = HALF_WALL + HELPER_OFFSET_PX / ZOOM;
  return worldToPage(page, { x: (a.x + b.x) / 2 + normal.x * offset, y: (a.y + b.y) / 2 + normal.y * offset });
}
