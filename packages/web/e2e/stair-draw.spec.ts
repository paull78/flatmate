import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { isRecord } from "@fm/protocol";
import { moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { distance, pixelAt } from "./support/pixels";
import { deleteProjects, storedDocument } from "./support/stored";
import { SERVER } from "./support/server";
import { card, pickCard } from "./support/palette";

// Drawing stairs in a real browser (stairdraw AC-17, AC-12): an L up to the loft in two clicks, swung sideways after
// the first, stored as two flights and a landing in every layout and drawn on the plan and in 3D; then a Stair that
// is short of its run takes a fix from its chip, reached by a realistic mouse path after click 1 (stairdraw.48).

const canvasOf = (page: Page) => page.getByTestId("canvas");
const hint = (page: Page) => page.getByTestId("command-bar").locator(".command-prompt");
const AWAY = { x: 8, y: -1 };

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

// A 6 × 5 room (inner faces x 0.1 / 5.9, y 0.1 / 4.9) under a 3.20 ceiling, with a loft (top 2.15) along its west
// side, x 0.1–1.6: its one free edge is x 1.6, facing the room. Two layouts.
const LOFT_EDGE = 1.6;

/** The room, the loft, a second layout and `blocks` (Custom box centres) in a new project, over MCP, opened in a page. */
async function seed(browser: Browser, blocks: readonly WorldPoint[] = []): Promise<{ page: Page; project: string; loft: string }> {
  const project = `zz-stairdraw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  let loft = "";
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 5 });
    await claude.call("set_ceiling", { height: 3.2 });
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 0.85, y: 2.5 }, width: 1.5, depth: 4.8 });
    if (isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string") loft = added.result.deck;
    await claude.call("add_layout", { name: "Night" });
    for (const at of blocks) await claude.call("place_object", { layout: "s0", kind: "block", centre: at, rotation: 0 });
  } finally {
    claude.close();
  }
  expect(loft).not.toBe("");
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return { page, project, loft };
}

/** Arms a stair kind from the palette's Stairs group. */
async function arm(page: Page, kind: string): Promise<void> {
  await pickCard(page, kind);
}

/** A realistic mouse path: 25 small moves from wherever the pointer is to the page point `to`. */
async function travel(page: Page, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(to.x, to.y, { steps: 25 });
}

const rows = (doc: unknown, table: string): Record<string, unknown>[] => {
  const t = isRecord(doc) ? doc[table] : undefined;
  return isRecord(t) ? Object.values(t).filter(isRecord) : [];
};

test("an L up to the loft in two clicks (AC-17)", async ({ browser }) => {
  const { page, project, loft } = await seed(browser);
  const canvas = canvasOf(page);
  await arm(page, "stair");

  // Hover in front of the loft's edge: it catches, and the hint says where the stair goes.
  const start = { x: LOFT_EDGE + 0.7, y: 1.4 };
  await moveTo(page, canvas, start);
  await expect(hint(page)).toContainText("Click to start the stair here, up to the Loft");

  // Click 1 fixes the top; a 25-step path sideways along the edge, past 30°, bends the ghost into an L.
  await page.mouse.down();
  await page.mouse.up();
  await travel(page, await toScreen(canvas, { x: LOFT_EDGE + 0.5, y: 2.6 }));
  await expect(hint(page)).toContainText("Click to place the L: two flights and a landing at +1.08");
  await page.mouse.down();
  await page.mouse.up();
  await waitSaved(page);

  const doc: unknown = await storedDocument(project);
  const landings = rows(doc, "decks").filter((d) => d.name === "Landing");
  expect(landings).toHaveLength(1);
  const landing = landings[0] ?? {};
  expect(landing).toMatchObject({ solid: true, w: 0.9, d: 0.9 });
  expect(landing.top).toBeCloseTo(1.075, 3);
  const landingId = String(landing.id);
  const flights = rows(doc, "objects").filter((o) => o.kind === "stair");
  expect(flights).toHaveLength(2);
  const upper = flights.find((o) => o.reaches === loft);
  const lower = flights.find((o) => o.reaches === landingId);
  expect(upper?.startsAt).toBe(landingId);
  expect(lower?.startsAt ?? null).toBeNull();
  // Every flight is in both layouts.
  for (const f of flights) expect(rows(doc, "placements").filter((p) => p.object === f.id)).toHaveLength(2);

  // On the plan: the landing (below the floor's cut) is filled with the deck tint at its centre.
  await moveTo(page, canvas, AWAY);
  const at = isRecord(landing.at) ? { x: Number(landing.at.x), y: Number(landing.at.y) } : { x: 0, y: 0 };
  await expect.poll(async () => distance(await pixelAt(page, canvas, at), COLORS.deck), { message: "the landing is drawn" }).toBeLessThanOrEqual(6);

  // In 3D: the panel opens and renders.
  await page.keyboard.press("3");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
});

test("a short Stair takes a fix from its chip (AC-17, AC-12)", async ({ browser }) => {
  // A Custom box (0.60 square) centred at (4.2, 2.6) leaves 2.30 of free floor in front of the edge: a Stair's 2.99 run
  // is about 0.69 short there.
  const { page, project, loft } = await seed(browser, [{ x: 4.2, y: 2.6 }]);
  const canvas = canvasOf(page);
  await arm(page, "stair");
  await moveTo(page, canvas, { x: 2.3, y: 2.63 });
  await expect(hint(page)).toHaveText(/^Doesn't fit: \d\.\d\d m short\. Click to fix the top, then pick a fix$/);

  // Click 1 pins this point's fixes; the hand then travels to the chip in 25 steps and the chips stay put.
  await page.mouse.down();
  await page.mouse.up();
  const chip = page.locator('button.command-chip[data-chip-id="storageStair/straight"]');
  await expect(chip).toHaveText(/^Storage stair · \d\.\d\d m$/);
  const box = await chip.boundingBox();
  if (box === null) throw new Error("no chip box");
  await travel(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(chip).toBeVisible();
  await chip.click();
  await waitSaved(page);

  const placed = rows(await storedDocument(project), "objects").filter((o) => o.kind === "storageStair");
  expect(placed).toHaveLength(1);
  expect(placed[0]?.reaches).toBe(loft);
  // The armed kind stays the Stair.
  await expect(card(page, "stair")).toHaveAttribute("aria-pressed", "true");

  // One undo removes it.
  await moveTo(page, canvas, AWAY);
  await page.keyboard.press("ControlOrMeta+z");
  await waitSaved(page);
  await expect.poll(async () => rows(await storedDocument(project), "objects").filter((o) => o.kind === "storageStair").length).toBe(0);
});
