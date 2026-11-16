import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clickAt } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { deleteProjects, storedDocument } from "./support/stored";
import { SERVER } from "./support/server";
import { showGroup } from "./support/palette";

// Quick add in a real browser (quick-add AC-01, AC-02, AC-03, AC-07, AC-08, AC-09): "/" focuses the palette's field, typing
// filters, arrows choose, Enter arms the Object tool and gives the canvas the keys, Esc clears then leaves, Ctrl+K
// focuses it too. Server mode; an empty 6 × 5 room is seeded over MCP.

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function open(browser: import("@playwright/test").Browser): Promise<{ page: Page; project: string }> {
  const project = `zz-quick-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 5 });
  } finally {
    claude.close();
  }
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click(); // the seeded project's own button (graphics.12)
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return { page, project };
}

const field = (page: Page) => page.getByTestId("quick-add-input");
const tool = (page: Page, name: string) => page.locator(`[data-tool="${name}"]`);
const armedTile = (page: Page) => page.locator('.palette-card[aria-pressed="true"]');
const railGroup = (page: Page) => page.locator('.palette-rail-button[aria-pressed="true"]');
const selectedRow = (page: Page) => page.locator('.quick-add-row[aria-selected="true"]');

test('"/" then "couch" and Enter arms the sofa, and a click places it (AC-01, AC-09)', async ({ browser }) => {
  const { page, project } = await open(browser);
  await page.getByTestId("canvas").click({ position: { x: 5, y: 5 } }); // the keys start on the canvas
  await page.keyboard.press("/");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("couch");
  await expect(selectedRow(page)).toHaveAttribute("data-kind", "sofa");
  await expect(selectedRow(page)).toContainText("(couch)");
  await page.keyboard.press("Enter");
  await expect(field(page)).not.toBeFocused();
  await expect(field(page)).toHaveValue("");
  await expect(railGroup(page)).toHaveAttribute("data-group", "Sleep"); // quick add leaves the rail alone (library spec)
  await showGroup(page, "Sit and eat");
  await expect(armedTile(page)).toHaveCount(1); // the sofa's card at its default size, not its other presets
  await expect(armedTile(page)).toHaveAttribute("data-kind", "sofa");
  await clickAt(page, page.getByTestId("canvas"), { x: 3, y: 2.5 });
  await waitSaved(page);
  const doc = await storedDocument(project);
  expect(Object.values(doc.objects).map((o) => o.kind)).toContain("sofa");
});

test('"bed", ↓ ↓ Enter arms the loft bed; ↑ from the first row wraps to the last (AC-03)', async ({ browser }) => {
  const { page } = await open(browser);
  await field(page).click();
  await page.keyboard.type("bed");
  await expect(page.locator(".quick-add-row")).toHaveCount(8); // the five beds, the nightstand ("bedside table"), the cot ("baby bed"), the set
  await page.keyboard.press("ArrowUp");
  await expect(selectedRow(page)).toHaveAttribute("data-kind", "bedAndNightstands");
  await page.keyboard.press("ArrowDown"); // back to Bed
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(armedTile(page)).toHaveAttribute("data-kind", "loftBed");
});

test("Esc clears, a second Esc leaves the field, and W then picks the Wall tool; letters in the field stay there (AC-07, AC-09)", async ({ browser }) => {
  const { page } = await open(browser);
  await page.getByTestId("canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+k");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("w");
  await expect(field(page)).toHaveValue("w");
  await expect(tool(page, "wall")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveValue("");
  await expect(page.locator('button[data-group="Sleep"]')).toBeVisible();
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field(page)).not.toBeFocused();
  await page.keyboard.press("w");
  await expect(tool(page, "wall")).toHaveAttribute("aria-pressed", "true");
});

test('"queen" and Enter arm the bed with its US Queen preset; "xyzq" offers the Custom box (AC-02, AC-08)', async ({ browser }) => {
  const { page } = await open(browser);
  await field(page).click();
  await page.keyboard.type("queen");
  await expect(selectedRow(page)).toHaveAttribute("data-kind", "bed");
  await expect(selectedRow(page)).toContainText("US Queen 162 × 213");
  await page.keyboard.press("Enter");
  await expect(armedTile(page)).toHaveAttribute("data-kind", "bed");
  await expect(page.getByTestId("size-picker-select")).toHaveValue("US Queen 162 × 213");
  await field(page).click();
  await page.keyboard.type("xyzq");
  await expect(page.getByTestId("quick-add-list")).toContainText("No furniture matches “xyzq”");
  await expect(selectedRow(page)).toHaveAttribute("data-kind", "block");
  await page.keyboard.press("Enter");
  await showGroup(page, "Basic");
  await expect(armedTile(page)).toHaveAttribute("data-kind", "block");
});
