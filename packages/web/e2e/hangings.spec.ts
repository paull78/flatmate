import { expect, test, type Page } from "@playwright/test";
import { STYLE_3D, type Point3, type Style3d } from "@fm/editor";
import { clickAt, drawRectRoom } from "./support/canvas";
import { pickOpeningKind } from "./support/opening-kind";
import { pickCard } from "./support/palette";
import { distance, screenPixel } from "./support/pixels";
import { screen3d } from "./support/probe3d";
import { expectNoToast } from "./support/toasts";

// The hangings in the browser (hangings step 08, AC-01, AC-04, AC-05, AC-08): a mirror from the palette hangs on the
// north wall and the WebGL 3D panel draws its glass; a window there takes a shutter box and a floor-length sheer from
// Properties, each drawn in 3D in its own colour, each one undo step. drawRectRoom's 6 × 4 m room: the north wall's
// inner face at y 3.9, seen over the south wall from the default camera.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const panel = (page: Page) => page.getByTestId("view3d-panel");
/** A material's three shades. */
type Shades = Style3d["joinery"];
const ROOM = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 };

async function offBy(page: Page, p: Point3, shades: Shades): Promise<number> {
  const s = await screen3d(page, ROOM, p);
  const seen = await screenPixel(page, s.x, s.y);
  return Math.min(distance(seen, shades.lit), distance(seen, shades.shaded));
}
const near = (page: Page, p: Point3, shades: Shades, message: string) => expect.poll(() => offBy(page, p, shades), { message }).toBeLessThanOrEqual(14);
/**
 * The 3D panel's warm cream pixels: red at least 150 and 25 over blue, as the sheer's shades (#ecdfb8, #dccb9a) and
 * their blends with the strips' edges; the bare room's greys, white joinery, pale floor and blue glass have none.
 */
async function creamPixels(page: Page): Promise<number> {
  const png = await page.getByTestId("view3d").screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) >= 150 && (data[i] ?? 0) - (data[i + 2] ?? 0) >= 25) count += 1;
    return count;
  }, png.toString("base64"));
}

/** Opens the 3D panel to look, then closes it, so clicks on the plan land on world points. */
async function in3d(page: Page, look: () => Promise<void>): Promise<void> {
  await page.getByTestId("open3d").click();
  await expect(panel(page)).toHaveAttribute("data-size", "split");
  await look();
  await page.locator('[data-action="close3d"]').click();
  await expect(page.getByTestId("open3d")).toBeVisible();
}

async function room(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off&renderer=webgl");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit3"); // the 3D panel docked under the plan, closed until we look
  await expect(panel(page)).toHaveAttribute("data-size", "split");
  await page.locator('[data-action="close3d"]').click();
}

test("a mirror from the palette hangs on the north wall, and the 3D panel draws its glass (AC-01, AC-04)", async ({ page }) => {
  await room(page);
  await pickCard(page, "mirror");
  await clickAt(page, canvasOf(page), { x: 3, y: 3.8 });
  await expectNoToast(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: 3, y: 3.885 }); // on the mirror, in the wall's click band: the mirror wins
  await expect(page.locator('[data-field-id="name"]')).toHaveValue("Mirror");
  await expect(page.locator('[data-field-id="width"]').first()).toHaveValue("0.60");
  await page.keyboard.press("Escape");
  // Its glass, a metal panel 1.10–1.90 up, faces the room at the wall (y 3.87).
  await in3d(page, () => near(page, { x: 3, y: 3.87, z: 1.5 }, STYLE_3D.slots.metal, "the mirror's glass on the north wall"));
});

test("a window takes a shutter box and a floor-length sheer from Properties, drawn in 3D, each one undo step (AC-05, AC-08)", async ({ page }) => {
  await room(page);
  await page.keyboard.press("d");
  await pickOpeningKind(page, "window");
  await clickAt(page, canvasOf(page), { x: 3, y: 4 }); // x 2.5–3.5 on the north wall, sill 0.90, head 2.10
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await clickAt(page, canvasOf(page), { x: 3, y: 4 });
  const box = page.getByRole("switch", { name: "Shutter box" });
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  // The box: 2.10–2.35 up, its front 0.12 off the inner face.
  await in3d(page, async () => {
    await near(page, { x: 3, y: 3.78, z: 2.22 }, STYLE_3D.joinery, "the shutter box over the head");
    expect(await creamPixels(page)).toBeLessThan(10); // no sheer yet
  });

  await clickAt(page, canvasOf(page), { x: 3, y: 4 });
  const sheer = page.getByRole("group", { name: "Sheer curtain" });
  await sheer.getByRole("button", { name: "Floor" }).click();
  await expect(sheer.getByRole("button", { name: "Floor" })).toHaveAttribute("aria-pressed", "true");
  // A strip at x 2.92–2.98, 0.18 off the face (in front of the box), down to the floor: below the sill it hangs over the wall.
  // Strips 6 cm wide with 4 cm gaps are a pixel or two each in the docked panel, blended with their edges, so the panel
  // counts its warm cream pixels: none with the box alone (walls grey, joinery white, glass blue, floor pale), many now.
  await in3d(page, () => expect.poll(() => creamPixels(page), { message: "the sheer's strips in the 3D panel" }).toBeGreaterThan(60));

  await clickAt(page, canvasOf(page), { x: 3, y: 4 });
  await page.getByRole("button", { name: /Undo/ }).first().click();
  await expect(sheer.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
  await expect(box).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /Undo/ }).first().click();
  await expect(box).toHaveAttribute("aria-checked", "false");
});
