import { expect, test } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { SERVER } from "./support/server";

// The Dimension tool in the browser (AC-01, AC-02), read through pixels in Canvas2D (headless has no WebGL2,
// direct.30). With the 0.25 m snap step, A (0.5, 2.5), B (3.5, 2.5) and the pointer at y 3.3 give offset 0.75: the
// dimension line runs along y 3.25. PROBE sits on that line, off the 0.2 m grid lines and clear of the text (centred
// on x 2.0), the ticks (x 0.5 and 3.5) and the snap mark.

const PROBE = { x: 1.1, y: 3.25 };

test("three clicks place a dimension that is there after a reload (AC-01, AC-02)", async ({ page }) => {
  const project = `Dims ${Date.now()}`;
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByPlaceholder("Project name").fill(project);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  const canvas = page.getByTestId("canvas");

  await page.locator('[data-tool="dimension"]').click();
  await expect(page.locator('[data-tool="dimension"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("command-bar")).toContainText("Click the first point");
  await page.locator('[data-snap-step="0.25"]').click();
  await expectPixel(page, canvas, PROBE, COLORS.background);

  await clickAt(page, canvas, { x: 0.5, y: 2.5 });
  await clickAt(page, canvas, { x: 3.5, y: 2.5 });
  await clickAt(page, canvas, { x: 2.9, y: 3.3 });
  await waitSaved(page);
  const drawn = async (): Promise<number> => distance(await pixelAt(page, canvas, PROBE), COLORS.background);
  await expect.poll(drawn, { message: "the dimension line at the probe" }).toBeGreaterThan(12);

  await page.reload();
  await page.getByRole("button", { name: project }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await expect.poll(drawn, { message: "the dimension line after a reload" }).toBeGreaterThan(12);
});
