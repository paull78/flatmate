import { expect, test, type BrowserContext } from "@playwright/test";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// A door on a loft's wall has a checked swing (cycle home, spec: levels, AC-04): a stool standing on the loft in the swing
// gives a warning at the loft's level and none at the floor, in a real browser, and get_drawing lists it.

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const record = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v)) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

test("a loft door's blocked swing warns at the loft and not at the floor", async ({ browser }) => {
  const project = `zz-loft-swing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  let loft = "";
  try {
    // A 6 × 4 room under 5.20 m, a loft at 2.45 over x 0.1–2.9, a wall on it at x 1.5 with a door (y 1.6–2.4) swinging
    // west over x 0.6–1.4, and a stool on the loft in the swing.
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("set_ceiling", { height: 5.2 });
    await claude.call("add_deck", { preset: "loft", centre: { x: 1.5, y: 2 }, width: 2.8, depth: 3.8, top: 2.45 });
    loft = String(record(list(record(await claude.call("get_drawing")).decks)[0]).id);
    await claude.call("add_wall", { a: { x: 1.5, y: 0.1 }, b: { x: 1.5, y: 3.9 }, on: loft });
    const wall = list(record(await claude.call("get_drawing")).walls).map(record).find((w) => w.on === loft);
    await claude.call("add_door", { wall: String(wall?.id), offset: 1.5, width: 0.8 });
    await claude.call("place_object", { layout: "s0", kind: "stool", centre: { x: 1, y: 2 }, on: loft });
    const layouts = list(record(await claude.call("get_drawing")).layouts).map(record);
    expect(list(layouts[0]?.blocked).map(record).map((b) => String(b.zone))).toEqual([expect.stringMatching(/^Door .* swing$/)]);
  } finally {
    claude.close();
  }
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);

  // At the floor: no warning. The stool and the door are the loft's.
  await expect(page.getByTestId("level-strip").locator('button[data-level="floor"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("warnings-button")).toHaveCount(0);

  // At the loft: one warning, the door's swing.
  await page.getByTestId("level-strip").locator(`button[data-level="${loft}"]`).click();
  await expect(page.getByTestId("level-strip").locator(`button[data-level="${loft}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("warnings-button")).toHaveAttribute("aria-label", "1 warning");
  await page.screenshot({ path: test.info().outputPath("loft-door-swing.png") });
});
