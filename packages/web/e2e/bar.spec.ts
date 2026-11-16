import { expect, test } from "@playwright/test";
import { canvasOf, openProject } from "./support/app-driver";
import { SERVER } from "./support/server";

// The floating bar without dividers (tidy C10a, AC-14): its groups are told apart by a wider gap, so when a narrow
// window wraps the bar nothing dangles at a row's start or end.

// 856 px: the 256 px canvas a 760 px window gave before the palette widened by 96 px (library.08).
test("at an 856 px window (a 256 px canvas) with the Wall tool the bar wraps by groups and has no dividers (AC-14)", async ({ page }) => {
  await page.setViewportSize({ width: 856, height: 900 });
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  const bar = page.getByTestId("floating-bar");
  await expect(bar).toBeVisible();
  await bar.locator('[data-tool="wall"]').click();
  await expect(page.getByTestId("wall-thickness")).toBeVisible();
  await expect(page.locator(".bar-sep")).toHaveCount(0);
  // Nothing overflows the bar: a group wraps too when it is wider than the canvas.
  const overflow = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll("button, label")].filter((c) => {
      const b = c.getBoundingClientRect();
      return b.left < r.left - 0.5 || b.right > r.right + 0.5;
    }).length;
  });
  expect(overflow).toBe(0);
  await bar.screenshot({ path: test.info().outputPath("floating-bar-856-wall.png") });
});

// The Projects button sits in the canvas's top-left corner in server mode (tidy.36, AC-21): the bar and its hint line
// centre in the space to its right, so no tool is ever under it.
for (const [width, height] of [[1280, 800], [856, 900], [1600, 1000]] as const) {
  test(`the Projects button never covers a tool of the floating bar at ${width} px (AC-21)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}&renderer=canvas2d`);
    await openProject(page, `Bar ${width} ${Date.now()}`);
    await page.keyboard.press("w");
    const bar = page.getByTestId("floating-bar");
    await expect(page.getByTestId("wall-thickness")).toBeVisible();
    const projects = await page.locator(".projects-button").boundingBox();
    if (!projects) throw new Error("no Projects button");
    const covered = await bar.locator("button").evaluateAll(
      (els, p) =>
        els.filter((e) => {
          const b = e.getBoundingClientRect();
          return b.left < p.x + p.width && b.right > p.x && b.top < p.y + p.height && b.bottom > p.y;
        }).length,
      projects,
    );
    expect(covered).toBe(0);
    const canvasEdge = await canvasOf(page).boundingBox();
    if (!canvasEdge) throw new Error("no canvas");
    const outside = await bar.locator("button, label").evaluateAll(
      (els, c) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.left < c.x - 0.5 || r.right > c.x + c.width + 0.5; }).length,
      canvasEdge,
    );
    expect(outside).toBe(0); // nothing spills past the canvas
    if (width === 1600) {
      // Still about centred: off the canvas centre by at most half the button's width and its gap.
      const canvas = await canvasOf(page).boundingBox();
      const b = await bar.boundingBox();
      if (!canvas || !b) throw new Error("no boxes");
      expect(Math.abs(b.x + b.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThanOrEqual(projects.width / 2 + 12);
    }
    const canvasBox = await canvasOf(page).boundingBox();
    if (canvasBox) await page.screenshot({ path: test.info().outputPath(`floating-bar-${width}-projects.png`), clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: 220 } });
  });
}
