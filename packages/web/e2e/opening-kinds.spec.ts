import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom, moveTo, toScreen } from "./support/canvas";
import { pickOpeningKind } from "./support/opening-kind";
import { screenPixel } from "./support/pixels";
import { toast } from "./support/toasts";

// The new opening kinds in the browser (openkinds, AC-07, AC-08): the kind picker in the floating bar and in
// Properties, and a pocket door's pocket refused in place. drawRectRoom's 6 × 4 m room: its bottom wall runs x 0 → 6.

const canvasOf = (page: Page) => page.getByTestId("canvas");

async function room(page: Page): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), 6, 4);
}

test("the floating bar's list arms Curtain for the next placements; Properties switches it to a Double door (AC-07)", async ({ page }) => {
  await room(page);
  await page.keyboard.press("d");
  await page.getByTestId("opening-kind").click();
  const list = page.getByTestId("opening-kind-list");
  await expect(list.getByRole("group")).toHaveText([/^Doors/, /^Windows/, /^Doorways/]);
  await expect(list.locator("[data-opening-kind]")).toHaveCount(11);
  await list.locator('[data-opening-kind="curtain"]').click();
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId("opening-kind")).toHaveAttribute("aria-label", "Opening kind: Curtain");
  await clickAt(page, canvasOf(page), { x: 1.5, y: 0.05 });
  await clickAt(page, canvasOf(page), { x: 4.5, y: 0.05 }); // still armed: a second curtain
  await expect(page.getByTestId("opening-kind")).toHaveAttribute("aria-label", "Opening kind: Curtain");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await clickAt(page, canvasOf(page), { x: 1.5, y: 0 });
  const kind = page.getByTestId("prop-opening-kind");
  await expect(kind).toHaveAttribute("aria-label", "Kind: Curtain");
  await kind.click();
  await page.getByTestId("opening-kind-list").locator('[data-opening-kind="double"]').click();
  await expect(kind).toHaveAttribute("aria-label", "Kind: Double door");
  await expect(page.locator('[data-field-id="width"]').first()).toHaveValue("0.80"); // a 0.80 curtain is in a double door's range
});

test("a pocket door whose pocket would cover a window previews red, and a click is refused in plain words (AC-08)", async ({ page }) => {
  await room(page);
  await page.keyboard.press("d");
  await pickOpeningKind(page, "window");
  await clickAt(page, canvasOf(page), { x: 3, y: 0.05 }); // x 2.5–3.5
  await pickOpeningKind(page, "pocket");
  // Near the wall's west end the pocket parks toward the east (openkinds.10): span x 1.0–1.8, pocket x 1.8–2.6.
  await moveTo(page, canvasOf(page), { x: 1.4, y: 0.05 });
  // The span's centre: the refusal's translucent red over the grey wall reads about (186, 104, 110); grey and the valid
  // preview's blue have red at most level with green.
  const s = await toScreen(canvasOf(page), { x: 1.4, y: 0 });
  const redness = async (): Promise<number> => {
    const [r = 0, g = 0] = await screenPixel(page, s.x, s.y);
    return r - g;
  };
  await expect.poll(redness, { message: "the preview in the refusal's red" }).toBeGreaterThanOrEqual(60);
  await clickAt(page, canvasOf(page), { x: 1.4, y: 0.05 });
  await expect(toast(page)).toHaveText("A pocket door's pocket would overlap a window");
});
