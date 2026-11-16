import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, dragFromTo, moveTo, type WorldPoint } from "./support/canvas";
import { canvasOf, waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { pickCard } from "./support/palette";
import { pieces } from "./support/pieces";
import { distance, pixelAt } from "./support/pixels";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// The new piece symbols in a real browser, in Canvas2D and in WebGL (symbols AC-08, AC-10, symbols.19): a plant's canopy is
// solid white over a finish, so its dark lines read on the floor, with the floor still showing between a palm's fronds; each
// selects and moves by its round ring; the palette places a vanity unit and a wall-hung WC.

const OAK = "#c8a27a"; // the planks' default colour
const AWAY: WorldPoint = { x: 8, y: -1 };
const RENDERERS = [{ renderer: "canvas2d", label: "Canvas2D" }, { renderer: "webgl", label: "WebGL" }];
const PALM: WorldPoint = { x: 1.5, y: 2 }; // the footprint's centre, 0.90 m across
const FERN: WorldPoint = { x: 3.2, y: 2 }; // 0.60 m across
const ROSETTE: WorldPoint = { x: 4.8, y: 2 }; // 0.40 m across
/** Between two of a palm's nine fronds near their tips, inside the ring it fits by: the first frond points along +x. */
const BETWEEN = { x: PALM.x + 0.36 * Math.cos(Math.PI / 9), y: PALM.y + 0.36 * Math.sin(Math.PI / 9) };

const projects: string[] = [];
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
  await deleteProjects(projects.splice(0));
});

/** The room label's id in `get_drawing`'s answer. */
function labelIn(drawing: unknown): string {
  const found = /"labels":\[\{"id":"([^"]+)"/.exec(JSON.stringify(drawing));
  if (!found?.[1]) throw new Error("no label in the drawing");
  return found[1];
}

async function opened(browser: Browser, renderer: string, label: string): Promise<{ page: Page; project: string }> {
  const project = `zz-symbols-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("label_room", { point: { x: 3, y: 0.7 }, name: "Room" });
    const drawing: unknown = await claude.call("get_drawing");
    await claude.call("set_finish", { label: labelIn(drawing), motif: "planks" });
    await claude.call("place_object", { layout: "s0", kind: "palm", centre: PALM });
    await claude.call("place_object", { layout: "s0", kind: "fern", centre: FERN });
    await claude.call("place_object", { layout: "s0", kind: "rosette", centre: ROSETTE });
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
  await expect(page.locator('[data-action="renderer"]')).toHaveText(label);
  return { page, project };
}

/** How close the pixel at `p` is to `hex`: 0 is the same colour. */
const near = async (page: Page, p: WorldPoint, hex: string): Promise<number> => distance(await pixelAt(page, canvasOf(page), p), hex);

for (const { renderer, label } of RENDERERS) {
  test.describe(label, () => {
    test("a plant's canopy is solid over a finish, with dark lines on it, and the floor shows between a palm's fronds (symbols.19)", async ({ browser }) => {
      const { page } = await opened(browser, renderer, label);
      await moveTo(page, canvasOf(page), AWAY);
      await expect.poll(() => near(page, BETWEEN, OAK)).toBeLessThan(45);
      const white = COLORS.objectOnFinish;
      await expect.poll(() => near(page, { x: PALM.x + 0.03, y: PALM.y + 0.03 }, white)).toBeLessThan(30); // inside the pot, off its dot
      await expect.poll(() => near(page, { x: FERN.x + 0.02, y: FERN.y + 0.2 }, white)).toBeLessThan(60); // between the fern's fine lines
      await expect.poll(() => near(page, { x: ROSETTE.x + 0.15, y: ROSETTE.y }, white)).toBeLessThan(45); // a rosette's outer petal, past its inner layer
    });

    test("a palm is selected by its round ring, fills it while selected, and moves (AC-10)", async ({ browser }) => {
      const { page, project } = await opened(browser, renderer, label);
      await clickAt(page, canvasOf(page), BETWEEN); // a gap between its fronds: inside the ring it fits by
      await moveTo(page, canvasOf(page), AWAY);
      await expect.poll(() => near(page, BETWEEN, COLORS.objectSelected)).toBeLessThan(30);
      await page.keyboard.press("Escape");
      await expect.poll(() => near(page, BETWEEN, OAK)).toBeLessThan(45);
      const to = { x: PALM.x, y: PALM.y - 0.6 };
      await dragFromTo(page, canvasOf(page), BETWEEN, { x: BETWEEN.x + to.x - PALM.x, y: BETWEEN.y + to.y - PALM.y });
      await waitSaved(page);
      await expect.poll(async () => (await pieces(project)).find((p) => p.kind === "palm")?.at.y ?? 0).toBeLessThan(2.45 - 0.3);
    });

    test("hovering a palm's gap shows the pointer cursor, as its ring is what a click hits, and a drag onto the fern is refused by that ring (AC-10)", async ({ browser }) => {
      const { page, project } = await opened(browser, renderer, label);
      const before = await pieces(project);
      await moveTo(page, canvasOf(page), AWAY);
      await expect(canvasOf(page)).not.toHaveCSS("cursor", "pointer");
      await moveTo(page, canvasOf(page), BETWEEN);
      await expect(canvasOf(page)).toHaveCSS("cursor", "pointer");
      // The ring would overlap the fern's: its centre 0.5 m from the fern's, under their radii 0.45 + 0.30.
      await dragFromTo(page, canvasOf(page), BETWEEN, { x: BETWEEN.x + (FERN.x - 0.5 - PALM.x), y: BETWEEN.y });
      await page.waitForTimeout(300);
      expect((await pieces(project)).find((p) => p.kind === "palm")?.at).toEqual(before.find((p) => p.kind === "palm")?.at);
    });
  });
}

test("the palette places a vanity unit and a wall-hung WC at their default sizes (AC-03, AC-08)", async ({ browser }) => {
  const { page, project } = await opened(browser, "canvas2d", "Canvas2D");
  await pickCard(page, "vanityUnit");
  await clickAt(page, canvasOf(page), { x: 2, y: 3.3 });
  await waitSaved(page);
  await pickCard(page, "toilet");
  await clickAt(page, canvasOf(page), { x: 4.5, y: 3.4 });
  await waitSaved(page);
  await page.keyboard.press("v");
  await moveTo(page, canvasOf(page), AWAY);
  await expect.poll(async () => (await pieces(project)).find((p) => p.kind === "vanityUnit")).toMatchObject({ w: 1, d: 0.5 });
  await expect.poll(async () => (await pieces(project)).find((p) => p.kind === "toilet")).toMatchObject({ w: 0.36, d: 0.54 });
});
