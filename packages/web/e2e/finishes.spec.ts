import { expect, test, type Browser, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawSampleRoom, drawRectRoom, moveTo, type WorldPoint } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { showGroup } from "./support/palette";
import { SERVER } from "./support/server";

// Floor finishes in the browser (finishes.08, .09, .19; AC-07, AC-11): a Floors tile arms the Zone tool's Floor mode,
// a click lays the motif in the room, Esc disarms the tile, and the Finishes switch is this viewer's only.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 8, y: -1 }; // outside the room: no hover tint, and the presence cursor stays off the probes
const ROOM_CLICK = { x: 4.5, y: 3.1 }; // where the Floor click lands, and so the new label's tag: far from the probe
// Near the 6 × 4 room's centre, off the 0.2 m grid and off every plank joint at the defaults (rows every 0.20 m; row
// y 2.0–2.2 has end joints at x 1.6 and 2.8).
const PROBE = { x: 2.5, y: 2.1 };
const FACE = { x: 0.1, y: 2.1 }; // on the left wall's inner face, where a selected room's outline runs
const OAK = "#c8a27a"; // the planks' default colour (the domain's motif table)
const BLUE = COLORS.openingFloor; // the room's blue fill over the canvas background, as before finishes

const armedTiles = (page: Page) => page.locator('.palette-card[aria-pressed="true"]');
const finishesSwitch = (page: Page) => page.getByTestId("finishes-switch");

/** Arms Planks and clicks the room along a pointer path; then Esc leaves the Floor mode and Esc clears the selection. */
async function layPlanks(page: Page, at: WorldPoint): Promise<void> {
  await showGroup(page, "Floors");
  const planks = page.locator('[data-motif="planks"]');
  await planks.click();
  await expect(planks).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("command-bar")).toContainText("Click a floor to lay Planks");
  await moveTo(page, canvasOf(page), AWAY);
  await clickAt(page, canvasOf(page), at);
}

for (const renderer of ["canvas2d", "webgl"] as const) {
  test(`${renderer}: arm Planks, click a room: the floor turns oak; Esc disarms the tile; the switch off shows the blue fill (AC-07, AC-11)`, async ({ page }) => {
    await page.goto(`/?name=Alice&server=off&renderer=${renderer}`);
    const canvas = canvasOf(page);
    await expect(canvas).toBeVisible();
    await drawRectRoom(page, canvas, 6, 4);
    await moveTo(page, canvas, AWAY);
    await expectPixel(page, canvas, PROBE, COLORS.background); // an unlabelled room has no fill

    await layPlanks(page, ROOM_CLICK);
    await page.keyboard.press("Escape");
    await expect(armedTiles(page)).toHaveCount(0);
    await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
    // The Floor click selected the room's new label (finishes.42): its floor keeps its colour, and a blue outline runs
    // along the wall faces (finishes.47).
    await moveTo(page, canvas, AWAY);
    await expectPixel(page, canvas, PROBE, OAK);
    await expectPixel(page, canvas, FACE, COLORS.wallSelected);
    await page.keyboard.press("Escape");
    await expect.poll(async () => distance(await pixelAt(page, canvas, FACE), COLORS.wallSelected)).toBeGreaterThan(60); // no outline
    await expectPixel(page, canvas, PROBE, OAK);

    await finishesSwitch(page).click();
    await expect(finishesSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expectPixel(page, canvas, PROBE, BLUE);
    await finishesSwitch(page).click();
    await expect(finishesSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expectPixel(page, canvas, PROBE, OAK);
  });
}

async function openAs(browser: Browser, name: string, renderer: "canvas2d" | "webgl"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}&renderer=${renderer}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  return page;
}

test("Alice's switch off leaves Bob's finishes on, in either renderer (AC-11)", async ({ browser }) => {
  const project = `Finishes ${Date.now()}`;
  const alice = await openAs(browser, "Alice", "canvas2d");
  await alice.getByPlaceholder("Project name").fill(project);
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByTestId("project-name")).toHaveText(project);
  const status = alice.getByTestId("project-status");
  await drawSampleRoom(alice, canvasOf(alice));
  await expect(status).toHaveText("saved");
  await layPlanks(alice, ROOM_CLICK);
  await expect(status).toHaveText("saved"); // the label and its finish, one acknowledged edit
  await alice.keyboard.press("Escape");
  await alice.keyboard.press("Escape");
  await moveTo(alice, canvasOf(alice), AWAY);

  const bob = await openAs(browser, "Bob", "webgl");
  await bob.getByRole("button", { name: project }).click();
  await expect(bob.getByTestId("project-name")).toHaveText(project);
  await moveTo(bob, canvasOf(bob), AWAY);
  await showGroup(bob, "Floors"); // the Finishes switch is in the Floors group
  await expectPixel(alice, canvasOf(alice), PROBE, OAK);
  await expectPixel(bob, canvasOf(bob), PROBE, OAK);

  await finishesSwitch(alice).click();
  await expectPixel(alice, canvasOf(alice), PROBE, BLUE);
  expect(distance(await pixelAt(bob, canvasOf(bob), PROBE), OAK)).toBeLessThanOrEqual(12); // Bob's switch is still on
  await expect(finishesSwitch(bob)).toHaveAttribute("aria-checked", "true");

  // The other way round, each in the other renderer: Bob off in WebGL; Alice back on, then in WebGL too.
  await finishesSwitch(bob).click();
  await expectPixel(bob, canvasOf(bob), PROBE, BLUE);
  await finishesSwitch(alice).click();
  await expectPixel(alice, canvasOf(alice), PROBE, OAK);
  await alice.locator('[data-action="renderer"]').click();
  await expect(alice.locator('[data-action="renderer"]')).toHaveText("WebGL");
  await expectPixel(alice, canvasOf(alice), PROBE, OAK);
  expect(distance(await pixelAt(bob, canvasOf(bob), PROBE), BLUE)).toBeLessThanOrEqual(12);
});
