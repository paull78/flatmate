import type { Page } from "@playwright/test";
import type { OpeningKind } from "@fm/editor";

// The Opening tool's kind picker (openkinds.07): one button whose list holds every kind; a spec opens it, then picks.

/** Arms `kind` from the floating bar's kind picker; the Opening tool must be active. */
export async function pickOpeningKind(page: Page, kind: OpeningKind): Promise<void> {
  await page.getByTestId("opening-kind").click();
  await page.locator(`[data-testid="opening-kind-list"] [data-opening-kind="${kind}"]`).click();
}
