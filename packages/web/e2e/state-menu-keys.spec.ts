import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clickAt, moveTo, type WorldPoint } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects, storedDocument } from "./support/stored";

// The layout menu keeps its keys (fixes AC-02): nothing pressed in it reaches the editor, so a selected piece can't nudge,
// and the menu's items answer Enter and Space. A 6 × 4 room seeded over MCP, with a bed selected in the browser.

const BED: WorldPoint = { x: 3, y: 2 };

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function withBedSelected(browser: Browser): Promise<{ page: Page; project: string }> {
  const project = `zz-menu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("place_object", { layout: "s0", kind: "bed", centre: BED });
  } finally {
    claude.close();
  }
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}&renderer=canvas2d`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  const canvas = page.getByTestId("canvas");
  await moveTo(page, canvas, BED);
  await clickAt(page, canvas, BED);
  await expect(page.getByTestId("prop-duplicate")).toBeVisible();
  return { page, project };
}

const placements = async (project: string): Promise<string> => JSON.stringify((await storedDocument(project)).placements);

test("ArrowDown in the menu moves its focus and the selected bed stays where it is", async ({ browser }) => {
  const { page, project } = await withBedSelected(browser);
  const before = await placements(project);
  await page.getByTestId("state-menu-button").click();
  await expect(page.getByTestId("state-menu-rename")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("state-menu-duplicate")).toBeFocused();
  await page.waitForTimeout(800); // past the nudge run's rest, so a nudge would have saved
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  expect(await placements(project)).toBe(before);
});

for (const key of ["Enter", "Space"]) {
  test(`${key} picks the focused menu item`, async ({ browser }) => {
    const { page } = await withBedSelected(browser);
    await page.getByTestId("state-menu-button").click();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("state-menu-duplicate")).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.getByTestId("state-menu")).toHaveCount(0);
    await expect(page.getByTestId("state-name")).toHaveValue("Layout 2");
  });
}

test("Escape closes the menu and the bed stays selected", async ({ browser }) => {
  const { page } = await withBedSelected(browser);
  await page.getByTestId("state-menu-button").click();
  await expect(page.getByTestId("state-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("state-menu")).toHaveCount(0);
  await expect(page.getByTestId("prop-duplicate")).toBeVisible();
});
