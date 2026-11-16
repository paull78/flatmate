import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clickAt, moveTo, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { armedCards, pickCard } from "./support/palette";
import { pieces } from "./support/pieces";
import { distance, pixelAt } from "./support/pixels";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Seated tables and multi-piece sets in a real browser (AC-14), in both renderers. A 6 × 4 room seeded over MCP, inner faces
// x 0.1 / 5.9, y 0.1 / 3.9, labelled so its floor shows. The 6-seat table's piece is centred at AT, so it runs x 1.8–4.4 and
// y 1.1–3.2; its table is 1.40 × 0.90 about AT, and its side chairs are centred x ±0.35 from AT, 0.45 deep from the piece's edge.

const AWAY: WorldPoint = { x: 8, y: -1 };
const LABEL: WorldPoint = { x: 5.3, y: 0.5 };
const FLOOR: WorldPoint = { x: 0.7, y: 0.7 }; // empty floor, off the grid lines
const AT: WorldPoint = { x: 3.1, y: 2.15 };
const STRIP: WorldPoint = { x: AT.x + 0.35, y: 3.2 - 0.525 }; // between the back right chair's front and the table's back edge
const SEAT: WorldPoint = { x: AT.x + 0.35, y: 3.2 - 0.3 }; // that chair's seat
const TOP: WorldPoint = { x: AT.x + 0.1, y: AT.y + 0.1 }; // the table's top, off its lines

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const canvasOf = (page: Page) => page.getByTestId("canvas");

async function seeded(browser: Browser, renderer: string, seed: (claude: McpClient) => Promise<void>): Promise<{ page: Page; project: string }> {
  const project = `zz-seated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("label_room", { point: LABEL, name: "Living" });
    await seed(claude);
  } finally {
    claude.close();
  }
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}&renderer=${renderer}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await moveTo(page, canvasOf(page), AWAY);
  return { page, project };
}

const table = async (claude: McpClient): Promise<void> => {
  await claude.call("place_object", { layout: "s0", kind: "seatedDining", preset: "6 seats", centre: AT });
};

/** The floor's colour here, and that a point shows it or doesn't. */
async function shows(page: Page, p: WorldPoint, floor: boolean): Promise<void> {
  const here = await pixelAt(page, canvasOf(page), FLOOR);
  const rgb = `#${here.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const near = async () => distance(await pixelAt(page, canvasOf(page), p), rgb);
  if (floor) await expect.poll(near, { message: `the floor at (${p.x}, ${p.y})` }).toBeLessThanOrEqual(12);
  else await expect.poll(near, { message: `a piece at (${p.x}, ${p.y})` }).toBeGreaterThan(12);
}

for (const renderer of ["canvas2d", "webgl"]) {
  test.describe(renderer, () => {
    test("a new table shows the floor between a chair and the table (AC-14)", async ({ browser }) => {
      const { page } = await seeded(browser, renderer, table);
      await shows(page, TOP, false);
      await shows(page, SEAT, false);
      await shows(page, STRIP, true);
    });

    test("Break apart leaves the pieces selected, standing where they did; one undo restores the set (AC-07, AC-14)", async ({ browser }) => {
      const { page, project } = await seeded(browser, renderer, table);
      await page.keyboard.press("v");
      await clickAt(page, canvasOf(page), TOP);
      await page.getByTestId("prop-break-apart").click();
      await expect(page.getByTestId("properties-group")).toHaveText("7 objects");
      await waitSaved(page);
      expect((await pieces(project)).map((p) => p.kind).sort()).toEqual(["chair", "chair", "chair", "chair", "chair", "chair", "extendingTable"]);
      await page.keyboard.press("Escape");
      await moveTo(page, canvasOf(page), AWAY);
      await shows(page, TOP, false);
      await shows(page, SEAT, false);
      await shows(page, STRIP, true);

      await page.locator('[data-testid="floating-bar"] [data-action="undo"]').click();
      await waitSaved(page);
      await expect.poll(async () => (await pieces(project)).map((p) => p.kind)).toEqual(["seatedDining"]);
    });

    test("a set from its card sits flush against a wall, and stays armed (AC-12, AC-17)", async ({ browser }) => {
      const { page, project } = await seeded(browser, renderer, async () => {});
      await pickCard(page, "bedAndNightstands");
      await expect(armedCards(page)).toHaveCount(1);
      await clickAt(page, canvasOf(page), { x: 3, y: 3.9 - 1.05 - 0.05 });
      await expect.poll(async () => (await pieces(project)).length).toBe(3);
      await waitSaved(page);
      await expect(armedCards(page)).toHaveAttribute("data-kind", "bedAndNightstands");
      const placed = await pieces(project);
      expect(placed.map((p) => p.kind).sort()).toEqual(["bed", "nightstand", "nightstand"]);
      for (const p of placed) expect(p.at.y, p.kind).toBeCloseTo(3.9, 3);
      await page.keyboard.press("Escape");
      await expect(armedCards(page)).toHaveCount(0);
    });
  });
}

test("quick add finds a set by its name, and Enter arms it (AC-11)", async ({ browser }) => {
  const { page, project } = await seeded(browser, "canvas2d", async () => {});
  await canvasOf(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await page.keyboard.type("sofa and rug");
  await expect(page.locator('.quick-add-row[aria-selected="true"]')).toHaveAttribute("data-kind", "sofaAndRug");
  await page.keyboard.press("Enter");
  await clickAt(page, canvasOf(page), { x: 3, y: 2 });
  await expect.poll(async () => (await pieces(project)).map((p) => p.kind).sort()).toEqual(["coffeeTable", "rug", "sofa"]);
});
