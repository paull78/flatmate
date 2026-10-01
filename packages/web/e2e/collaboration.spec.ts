import { expect, test, type Browser, type Page } from "@playwright/test";
import { clickAt, dragFromTo, drawDemoRoom, moveTo } from "./support/canvas";

const canvasOf = (page: Page) => page.getByTestId("canvas");

const SERVER = "ws://localhost:8788"; // started by playwright.config.ts

async function openAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  return page;
}

test("two windows share a project: each sees the other, and Bob's wall move changes Alice's drawing", async ({ browser }) => {
  const project = `Apartment ${Date.now()}`;

  // Demo step 1: Alice creates the project; it opens at once.
  const alice = await openAs(browser, "Alice");
  await alice.getByPlaceholder("Project name").fill(project);
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByTestId("project-name")).toHaveText(project);

  // Demo step 2 on a shared drawing: each segment waits for the server.
  await drawDemoRoom(alice, canvasOf(alice));
  await expect(alice.getByTestId("project-status")).toHaveText("saved");

  // Demo step 7: Bob opens the same project.
  const bob = await openAs(browser, "Bob");
  await bob.getByRole("button", { name: project }).click();
  await expect(bob.getByTestId("project-name")).toHaveText(project);

  // Presence travels on pointer moves and is not replayed to late joiners (spec §7.2.1, §7.6).
  await moveTo(alice, canvasOf(alice), { x: 1, y: 1 });
  await moveTo(bob, canvasOf(bob), { x: 2, y: 2 });
  await expect(alice.getByTestId("collaborators")).toContainText("Bob");
  await expect(bob.getByTestId("collaborators")).toContainText("Alice");

  // Alice selects the bottom wall; Bob drags the right wall 1 m to the right.
  await alice.keyboard.press("v");
  await clickAt(alice, canvasOf(alice), { x: 3, y: 0 });
  await expect(alice.locator('[data-field-id="length"]')).toHaveValue("6.00");
  await bob.keyboard.press("v");
  await dragFromTo(bob, canvasOf(bob), { x: 6, y: 2 }, { x: 7, y: 2 });
  await expect(alice.locator('[data-field-id="length"]')).toHaveValue("7.00");
  await expect(bob.getByTestId("project-status")).toHaveText("saved");
});

test("deleting a project sends the window that has it open back to the list (spec §7.2.1)", async ({ browser }) => {
  const project = `Doomed ${Date.now()}`;
  const alice = await openAs(browser, "Alice");
  await alice.getByPlaceholder("Project name").fill(project);
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByTestId("project-name")).toHaveText(project);

  const bob = await openAs(browser, "Bob");
  const row = bob.getByRole("listitem").filter({ hasText: project });
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toContainText("Anyone who has it open is sent back to the project list.");
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(bob.getByRole("button", { name: project })).toBeVisible(); // Cancel deletes nothing
  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("button", { name: "Delete" }).click(); // the confirming Delete

  await expect(bob.getByRole("button", { name: project })).toHaveCount(0);
  await expect(alice.getByTestId("project-list")).toBeVisible();
  await expect(alice.getByRole("status")).toHaveText("This project was deleted");
  await expect(alice.getByRole("button", { name: project })).toHaveCount(0);
});
