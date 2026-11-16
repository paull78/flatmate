import { expect, test } from "@playwright/test";
import { clickAt, moveTo } from "./support/canvas";
import { SERVER } from "./support/server";

// What the floor level lets you select (shown.01, .02; AC-02): in the seeded studio the loft's mattress lies over the
// whole bathroom and its tag; at the floor the mattress belongs to the loft, so a click on the tag selects the bathroom.

const BATHROOM_TAG = { x: 0.75, y: 1.25 }; // the seed's label point, under the mattress on the loft

test("at the floor, a click on the bathroom's tag under the loft's mattress selects the bathroom (AC-02)", async ({ page }) => {
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: "Studio", exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await moveTo(page, canvas, { x: 3, y: -1 });
  await clickAt(page, canvas, BATHROOM_TAG);
  await expect(page.locator('[data-field-id="name"]')).toHaveValue("Bathroom");
});
