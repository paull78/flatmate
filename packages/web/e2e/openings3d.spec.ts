import { expect, test, type Page } from "@playwright/test";
import { STYLE_3D, type Point3 } from "@fm/editor";
import { clickAt, drawRectRoom } from "./support/canvas";
import { pickOpeningKind } from "./support/opening-kind";
import { distance, screenPixel } from "./support/pixels";
import { screen3d } from "./support/probe3d";

// Doors and windows in 3D (openings3d): frames, leaves and glass in the panel's real pixels, placed through the editor's
// own camera. drawRectRoom's 6 × 4 m room runs counter-clockwise, so its north wall runs from x 6 to x 0; a door clicked
// at x 2.4 from the room's side opens south and hinges at x 2.0, the nearer end of the wall's far half.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const panel = (page: Page) => page.getByTestId("view3d-panel");
const ROOM = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 };
const JOINERY = Object.values(STYLE_3D.joinery);

/** How far the panel's pixel at world point `p` is from the nearest of `colours`. */
async function offBy(page: Page, p: Point3, colours: readonly string[]): Promise<number> {
  const s = await screen3d(page, ROOM, p);
  const seen = await screenPixel(page, s.x, s.y);
  return Math.min(...colours.map((c) => distance(seen, c)));
}
const expectAt = (page: Page, p: Point3, colours: readonly string[], what: string) =>
  expect.poll(() => offBy(page, p, colours), { message: what }).toBeLessThanOrEqual(14);

/** The room with one opening of `kind` clicked on the north wall at (x, 3.95), and the 3D view open in split. */
async function roomWith(page: Page, kind: "swing" | "sliding" | "window", x: number): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("d");
  await pickOpeningKind(page, kind);
  await clickAt(page, canvasOf(page), { x, y: 3.95 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(panel(page)).toHaveAttribute("data-size", "split");
}

test("a swing door's leaf stands open in the room, in joinery's white, and its doorway shows beside it", async ({ page }) => {
  await roomWith(page, "swing", 2.4);
  await page.keyboard.press("]"); // from the south-east the leaf no longer stands in front of its doorway
  await expect(panel(page)).toHaveAttribute("data-yaw", "315");
  // Without a leaf this pixel shows the shaded wall west of the door. (From the south-west it would show the floor through
  // the doorway, which is within the colour tolerance of the leaf's lit side, so the probe couldn't tell.)
  await expectAt(page, { x: 2.06, y: 3.5, z: 1 }, JOINERY, "the leaf's face, standing out of the wall at the hinge");
  await expectAt(page, { x: 2.5, y: 4, z: 1 }, [STYLE_3D.background], "the background through the door");
});

test("a sliding door's leaf is parked beside its doorway, which stays clear", async ({ page }) => {
  await roomWith(page, "sliding", 2.4);
  // Clicked at x 2.4, nearer the wall's west end: a sliding door parks toward the far end (openkinds.10), x 2.8–3.6.
  await expectAt(page, { x: 3.2, y: 3.86, z: 1 }, JOINERY, "the parked leaf, beyond the hinge end");
  await expectAt(page, { x: 2.4, y: 4, z: 1 }, [STYLE_3D.background], "the background through the clear doorway");
});

test("a window's pane shows in the 3D glass, inside a frame in joinery's white", async ({ page }) => {
  await roomWith(page, "window", 4);
  await expectAt(page, { x: 4, y: 4, z: 1.5 }, [STYLE_3D.glass], "the pane");
  await expectAt(page, { x: 4, y: 3.95, z: 0.96 }, [STYLE_3D.joinery.top], "the frame's bottom rail, from above");
});
