import { expect, test } from "@playwright/test";
import { openSection } from "./support/sections";
import { drawSampleRoom } from "./support/canvas";
import { SERVER } from "./support/server";

// The Project section (sheet.04; AC-06, AC-01): with nothing selected, Properties lists the title block fields; a
// field typed and committed with Enter is stored in the shared document and is there after a reload.


test("a client typed in the Project section is saved with the drawing", async ({ page }) => {
  const project = `Sheet ${Date.now()}`;
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByPlaceholder("Project name").fill(project);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await drawSampleRoom(page, page.getByTestId("canvas"));
  await page.keyboard.press("Escape");

  const section = page.getByTestId("project-section");
  await openSection(section); // closed until opened (inherit step 06)
  const client = section.locator('[data-field-id="project.client"]');
  await client.fill("Rossi");
  await client.press("Enter");
  const notes = section.locator('[data-field-id="project.notes"]');
  await notes.fill("Line one\nLine two");
  await notes.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("project-status")).toHaveText("saved");

  await page.reload();
  await page.getByRole("button", { name: project }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await expect(page.getByTestId("project-section").locator('[data-field-id="project.client"]')).toHaveValue("Rossi");
  await expect(page.getByTestId("project-section").locator('[data-field-id="project.notes"]')).toHaveValue("Line one\nLine two");
});
