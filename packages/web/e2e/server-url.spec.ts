import { expect, test } from "@playwright/test";

// A bad ?server= says so, where before new WebSocket threw during mount and left a blank page (fixes AC-06).

test("?server= without a scheme shows a plain message, not a blank page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?name=Alice&server=localhost:8787");
  await expect(page.getByRole("alert")).toContainText("ws:// or wss://");
  expect(errors).toEqual([]);
});
