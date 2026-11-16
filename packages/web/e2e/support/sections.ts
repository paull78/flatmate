import { expect, type Locator } from "@playwright/test";

// A Properties section that may start closed (inherit step 06: Shortcuts, Underlay, Trailer and Project do, and every
// section remembers being opened or closed): opens it by its title when closed, as a person would.

export async function openSection(section: Locator): Promise<void> {
  await expect(section).toBeVisible();
  if ((await section.getAttribute("open")) === null) await section.locator("summary").first().click();
  await expect(section).toHaveAttribute("open", "");
}
