import { expect, test } from "@playwright/test";

// The layout pill's menu (spec: layouts): deleting a layout takes the ⋯ menu, never one click on the pill, and the
// name field shows no square focus outline.

test("the layout menu renames, duplicates and deletes; the pill itself never deletes", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const name = page.getByTestId("state-name");
  const more = page.getByTestId("state-menu-button");
  const menu = page.getByTestId("state-menu");
  await expect(name).toHaveValue("Layout");

  // Clicking the name edits it, with a field inside the pill rather than a square outline round it.
  await name.click();
  await expect(name).toBeFocused();
  expect(await name.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  await name.press("Escape");
  await expect(page.getByTestId("state-delete")).toHaveCount(0);

  // One layout: the menu offers no delete.
  await more.click();
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("state-menu-rename")).toBeFocused();
  await expect(page.getByTestId("state-menu-delete")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // Duplicate copies the active layout and makes the copy active; Rename focuses the name.
  await more.click();
  await page.getByTestId("state-menu-duplicate").click();
  await expect(menu).toHaveCount(0);
  await expect(name).toHaveValue("Layout 2");
  await more.click();
  await page.getByTestId("state-menu-rename").click();
  await expect(name).toBeFocused();
  await page.keyboard.type("Night");
  await page.keyboard.press("Enter");
  await expect(name).toHaveValue("Night");

  // Clicking away closes the menu without deleting.
  await more.click();
  await expect(menu).toBeVisible();
  await page.getByTestId("canvas").click({ position: { x: 40, y: 300 } }); // clear of the floating bar, which reaches x 40 on a 680 px canvas
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Layout", exact: true })).toBeVisible();

  // Delete removes the active layout; the other becomes active.
  await more.click();
  await page.getByTestId("state-menu-delete").click();
  await expect(name).toHaveValue("Layout");
  await expect(page.getByTestId("state-pill").getByRole("button", { name: "Night" })).toHaveCount(0);
});
