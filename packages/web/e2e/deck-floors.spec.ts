import { expect, test } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { clickAt, moveTo } from "./support/canvas";
import { SERVER } from "./support/server";
import { deleteProjects, storedDocument } from "./support/stored";
import { copyStudio } from "./support/studio-copy";
import { showGroup } from "./support/palette";

// Deck floors in the browser (deck-floors.02; AC-04): at the loft's level a Floors tile stays armed at that level, and
// a click on the loft lays the motif on it; at the floor the same tile's click on the room finishes the room. On a copy
// of the seeded studio, since other specs read the seed.

const NAME = "Studio decks";
const LOFT_FREE = { x: 2.3, y: 1.25 }; // on the loft (x 0.1–2.5), clear of its mattress
const MAIN_FLOOR = { x: 5.2, y: 0.4 }; // the main room's floor, clear of every piece and deck

test.afterEach(async () => {
  await deleteProjects([NAME]);
});

test("at the loft a Floors tile lays the motif on the loft; at the floor the same click on the room finishes the room (AC-04)", async ({ page }) => {
  await copyStudio(NAME);
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: NAME, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();

  await page.keyboard.press("PageUp");
  const strip = page.getByTestId("level-strip");
  const loftButton = strip.locator('button[aria-pressed="true"]');
  await expect(loftButton).not.toHaveAttribute("data-level", "floor");
  await showGroup(page, "Floors");
  await page.locator('[data-motif="herringbone"]').click();
  await expect(page.getByTestId("command-bar")).toContainText("Click a floor to lay Herringbone");
  await expect(loftButton).not.toHaveAttribute("data-level", "floor"); // arming keeps the loft's level
  await moveTo(page, canvas, { x: 3, y: -1 });
  await clickAt(page, canvas, LOFT_FREE);
  await expect.poll(async () => {
    const decks = (await storedDocument(NAME)).decks;
    const loft = Object.values(decks).find((d) => isRecord(d) && d.name === "Loft");
    return isRecord(loft) && isRecord(loft.finish) ? loft.finish.motif : null;
  }).toBe("herringbone");

  await page.keyboard.press("PageDown");
  await expect(strip.locator('button[aria-pressed="true"]')).toHaveAttribute("data-level", "floor");
  await clickAt(page, canvas, MAIN_FLOOR);
  await expect.poll(async () => {
    const labels = (await storedDocument(NAME)).zoneLabels;
    const main = Object.values(labels).find((l) => isRecord(l) && l.name === "Main room");
    return isRecord(main) && isRecord(main.finish) ? main.finish.motif : null;
  }).toBe("herringbone");
});
