import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { pickCard } from "./support/palette";
import { pieces } from "./support/pieces";
import { bandUnder, decode, pixelsNear, plateBox, plateFaults, shot, withSlack, type Box } from "./support/plate";
import { panelPixels, screen3d } from "./support/probe3d";
import { SERVER } from "./support/server";
import { deleteProjects, storedDocument } from "./support/stored";
import { toast } from "./support/toasts";

// A piece that fits by getting shorter, in a real browser (clarity.06, AC-07, AC-09), in Canvas2D and in WebGL. The label
// is canvas text, so the page can't read its words: its box comes from their width, and the stored 2.03 is the sturdier
// check. A run acts like a user: the pointer moves along a path, and each edit waits for its acknowledgement.

const UNDER: WorldPoint = { x: 1.5, y: 2 }; // under the loft
const CLEAR: WorldPoint = { x: 4.5, y: 2 }; // beside it, where a wardrobe keeps its height
const WORDS = "H 2.03 m · default 2.05 · under Loft";
const NOTE = { line: COLORS.warningLine, text: COLORS.text };
const ROOM = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 }; // the 6 × 4 room, under a 2.50 ceiling

type Renderer = { renderer: "canvas2d" | "webgl"; label: string };
const RENDERERS: readonly Renderer[] = [{ renderer: "canvas2d", label: "Canvas2D" }, { renderer: "webgl", label: "WebGL" }];

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const canvasOf = (page: Page): Locator => page.getByTestId("canvas");

/** A 6 × 4 room with a loft over its west half (x 0.1–3.1), opened by Alice in `renderer`. */
async function underLoft(browser: Browser, { renderer, label }: Renderer): Promise<{ page: Page; project: string }> {
  const project = `zz-height-fit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("add_deck", { preset: "loft", centre: { x: 1.6, y: 2 }, width: 3, depth: 3.8 });
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

/** The pointer glides to `to` from where it is, in small moves, and stops there; returns the page point it stopped at. */
async function glideTo(page: Page, to: WorldPoint): Promise<WorldPoint> {
  const s = await toScreen(canvasOf(page), to);
  await page.mouse.move(s.x, s.y, { steps: 12 });
  return s;
}

/** The ghost's area around the pointer, 1.2 × 0.6 m at 80 px/m, with a margin: red pixels here are a red ghost's. */
const ghostArea = (pointer: WorldPoint): Box => ({ x: pointer.x - 60, y: pointer.y - 32, width: 120, height: 48 });
const redIn = async (page: Page, box: Box): Promise<number> => pixelsNear(await decode(page, await shot(page, box)), COLORS.invalid);

async function expectLabel(page: Page, pointer: WorldPoint): Promise<void> {
  const box = withSlack(plateBox(pointer, WORDS));
  await expect.poll(async () => plateFaults(await decode(page, await shot(page, box)), NOTE), { message: `the label reading "${WORDS}"` }).toEqual([]);
}

type Panel = Awaited<ReturnType<typeof panelPixels>>;

/** How many pixels of a 3D-panel region around `at` differ between two reads of the panel, more than antialiasing would. */
function changedAround(a: Panel, b: Panel, at: { x: number; y: number }, reach: number): number {
  let n = 0;
  for (let y = at.y - reach; y <= at.y + reach; y++) {
    for (let x = at.x - reach; x <= at.x + reach; x++) {
      const k = (y - a.y) * a.width + (x - a.x);
      const near = [0, 1, 2].every((c) => Math.abs((a.rgb[k * 3 + c] ?? 0) - (b.rgb[k * 3 + c] ?? 0)) <= 8);
      if (!near) n++;
    }
  }
  return n;
}

for (const look of RENDERERS) {
  test.describe(look.label, () => {
    test("a wardrobe card over the loft shows a normal ghost with the label; the click places it; the stored height is 2.03; Properties shows 2.03; the 3D panel draws it", async ({ browser }) => {
      const { page, project } = await underLoft(browser, look);
      await pickCard(page, "wardrobe");

      // Over the loft: not red, and the label reads with no rest.
      let pointer = await glideTo(page, UNDER);
      await expectLabel(page, pointer);
      expect(await redIn(page, ghostArea(pointer)), "the ghost isn't red").toBe(0);

      // Beside the loft the label goes, and the band it lay in has none of its border.
      const band = await decode(page, await shot(page, await bandUnder(page, pointer)));
      expect(pixelsNear(band, COLORS.warningLine, 40), "the label's border, as a control").toBeGreaterThan(0);
      const beside = await glideTo(page, CLEAR);
      const bandBeside = await bandUnder(page, beside);
      await expect.poll(async () => pixelsNear(await decode(page, await shot(page, bandBeside)), COLORS.warningLine, 40), { message: "no label beside the loft" }).toBe(0);

      // Back, and the click places it, with no refusal.
      pointer = await glideTo(page, UNDER);
      await expectLabel(page, pointer);
      await page.mouse.down();
      await page.mouse.up();
      await expect.poll(async () => (await pieces(project)).length).toBe(1);
      await waitSaved(page);
      await expect(toast(page)).toHaveCount(0);

      const stored = await storedDocument(project);
      expect(Object.values(stored.objects)).toMatchObject([{ kind: "wardrobe", w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 2.03 }, z: { standard: 0 } }]);
      expect(Object.values(stored.placements)).toMatchObject([{ deck: null, rotation: 0 }]);

      // Over itself the armed ghost goes red: the red check above can see one.
      await page.mouse.move(pointer.x + 3, pointer.y, { steps: 2 });
      await expect.poll(() => redIn(page, ghostArea(pointer)), { message: "a red ghost over the placed piece" }).toBeGreaterThan(0);
      await page.keyboard.press("Escape");

      // An ordinary height: Properties shows it.
      await glideTo(page, CLEAR);
      await page.mouse.move(pointer.x, pointer.y, { steps: 8 });
      await page.mouse.down();
      await page.mouse.up();
      await expect(page.locator('[data-field-id="height.standard"]')).toHaveValue("2.03");
      await page.keyboard.press("Escape");

      // The 3D panel draws it: its south face, in the low part the loft doesn't hide, is gone after an undo.
      const [piece] = await pieces(project);
      if (piece === undefined) throw new Error("no piece");
      await page.keyboard.press("3");
      await expect(page.getByTestId("view3d-panel")).toBeVisible();
      const face = await screen3d(page, ROOM, { x: piece.at.x, y: piece.at.y - piece.d, z: 0.3 });
      await page.waitForTimeout(500); // the panel opens and draws over a few frames
      const withPiece = await panelPixels(page);
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(async () => (await pieces(project)).length).toBe(0);
      await waitSaved(page);
      await expect.poll(async () => changedAround(withPiece, await panelPixels(page), face, 4), { message: "the wardrobe's face in the 3D panel" }).toBeGreaterThan(40);
    });
  });
}
