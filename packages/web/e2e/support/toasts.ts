import { expect, type Locator, type Page } from "@playwright/test";

/** The toast element (web/src/panels/Toast.tsx). */
export const toast = (page: Page): Locator => page.locator(".fm-toast");

/**
 * No toast on screen now. A refusal toasts in the same update as the click, before the click helper returns, and hides
 * after TOAST_MS (6 s): `toHaveCount(0)` would retry until it had gone, so the check could never fail (levels.55).
 */
export async function expectNoToast(page: Page): Promise<void> {
  expect(await toast(page).allTextContents(), "no toast").toEqual([]);
}
