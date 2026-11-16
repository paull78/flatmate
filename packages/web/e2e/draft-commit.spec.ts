import { expect, test } from "@playwright/test";

// A text field's draft commits before a click on a toolbar button, a tab or a card acts (fixes AC-01). Those buttons keep
// the focus off themselves, so without this the field unmounts with its text and nothing says so.

test("a typed thickness commits when another tool is clicked", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  const bar = page.getByTestId("floating-bar");
  await bar.locator('[data-tool="wall"]').click();
  const thickness = page.getByTestId("wall-thickness");
  await thickness.fill("0.3");
  await bar.locator('[data-tool="select"]').click();
  await expect(thickness).toHaveCount(0);
  await bar.locator('[data-tool="wall"]').click();
  await expect(thickness).toHaveValue(/^0\.30?$/);
});

test("a typed layout name commits when another layout's tab is clicked, as one undo step", async ({ page }) => {
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  const name = page.getByTestId("state-name");
  const more = page.getByTestId("state-menu-button");
  await more.click();
  await page.getByTestId("state-menu-duplicate").click();
  await expect(name).toHaveValue("Layout 2");
  await name.click();
  await name.fill("Night");
  await page.getByTestId("state-pill").getByRole("button", { name: "Layout", exact: true }).click();
  await expect(name).toHaveValue("Layout");
  const night = page.getByTestId("state-pill").getByRole("button", { name: "Night", exact: true });
  await expect(night).toBeVisible();
  await page.locator('[data-action="undo"]').click();
  await expect(page.getByTestId("state-pill").getByRole("button", { name: "Layout 2", exact: true })).toBeVisible();
  await expect(night).toHaveCount(0);
});

test("a field that isn't a draft keeps its focus and its text", async ({ page }) => {
  // The guard on the fix: only a draft commits on these clicks. A report's text under the style buttons relies on the same.
  await page.goto("/?name=Alice&server=off&renderer=canvas2d");
  const add = page.getByPlaceholder("Find furniture");
  await add.fill("bed");
  await page.getByTestId("floating-bar").locator('[data-tool="select"]').click();
  await expect(add).toBeFocused();
  await expect(add).toHaveValue("bed");
});
