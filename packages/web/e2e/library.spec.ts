import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { placeIn } from "./support/mcp-listing";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { pieces } from "./support/pieces";
import { distance, pixelAt } from "./support/pixels";
import { armedCards, pickCard, showGroup } from "./support/palette";
import { deleteProjects, storedDocument } from "./support/stored";
import { SERVER } from "./support/server";

// The library cycle in a real browser (step 07): the rail remembers its group and hides while searching (AC-01); the
// "Dining table with chairs · 8 seats" card places a 3.20 × 2.10 set that draws 8 chairs, one at each end (AC-03,
// AC-04); "Round chairs" in Properties rounds the chairs and one undo squares them again (AC-05). Pieces sit in a 6 × 4
// room seeded over MCP (inner faces x 0.1 / 5.9, y 0.1 / 3.9), labelled so its free floor shows, its tag at LABEL. Thin
// lines are probed by region (seating.42); floor probes sit off the 0.2 m grid lines.

const AWAY: WorldPoint = { x: 8, y: -1 }; // the cursor off the drawing, so no hover changes the probes
const LABEL: WorldPoint = { x: 4.9, y: 0.7 };
const AT: WorldPoint = { x: 3.1, y: 2.15 }; // the set's centre: its back edge y 3.20, front y 1.10, ends x 1.5 / 4.7
const FLOOR: WorldPoint = { x: 1.1, y: 1.1 }; // empty labelled floor, off the grid lines
const GREY = COLORS.object;

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const canvasOf = (page: Page) => page.getByTestId("canvas");
const pressedGroup = (page: Page): Locator => page.locator('.palette-rail-button[aria-pressed="true"]');
const cardKinds = (page: Page): Promise<(string | null)[]> => page.locator(".palette-card[data-kind]").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-kind")));

/** A JSON field read without casts (the e2e package has no MCP types). */
const field = (v: unknown, key: string): unknown => (typeof v === "object" && v !== null ? Reflect.get(v, key) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A fresh project seeded over MCP (the labelled room, then `seed`), opened by Alice. */
async function seeded(browser: Browser, seed: (claude: McpClient) => Promise<void>): Promise<{ page: Page; project: string }> {
  const project = `zz-library-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("label_room", { point: LABEL, name: "Dining" });
    await seed(claude);
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
  await moveTo(page, canvasOf(page), AWAY);
  return { page, project };
}

/** The project's one object as get_drawing lists it, read by a fresh MCP client. */
async function drawnObject(project: string): Promise<unknown> {
  const claude = await startMcp(SERVER);
  try {
    const id = field(list(field(await claude.call("list_projects"), "projects")).find((p) => field(p, "name") === project), "id");
    if (typeof id !== "string") throw new Error(`no project ${project}`);
    const objects = list(field(await claude.call("open_project", { id }), "objects"));
    expect(objects).toHaveLength(1);
    return objects[0];
  } finally {
    claude.close();
  }
}

/** The composited colours of every page pixel in the world box spanned by `a` and `b`, as [r, g, b]. */
async function region(page: Page, canvas: Locator, a: WorldPoint, b: WorldPoint): Promise<number[][]> {
  const [p, q] = [await toScreen(canvas, a), await toScreen(canvas, b)];
  const x = Math.round(Math.min(p.x, q.x));
  const y = Math.round(Math.min(p.y, q.y));
  const clip = { x, y, width: Math.round(Math.max(p.x, q.x)) - x, height: Math.round(Math.max(p.y, q.y)) - y };
  const png = await page.screenshot({ clip });
  return page.evaluate(async ({ base64, w, h }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(w, h).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    return Array.from({ length: w * h }, (_, i) => [data[4 * i] ?? 0, data[4 * i + 1] ?? 0, data[4 * i + 2] ?? 0]);
  }, { base64: png.toString("base64"), w: clip.width, h: clip.height });
}

/**
 * A chair's backrest in the box: some pixels of the piece's grey fill (not the floor, which is 20 or more from it) and a
 * line across it (a pixel far from the fill). A missing chair shows the floor; a set with no chairs, the table's plain fill.
 */
async function backrest(page: Page, canvas: Locator, a: WorldPoint, b: WorldPoint): Promise<{ fill: number; line: number }> {
  const pixels = await region(page, canvas, a, b);
  return { fill: pixels.filter((rgb) => distance(rgb, GREY) <= 6).length, line: Math.max(...pixels.map((rgb) => distance(rgb, GREY))) };
}

const hex = (rgb: number[]): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** How many pixels of two equal regions differ by more than 24 on a channel. */
const changed = (a: number[][], b: number[][]): number => a.filter((rgb, i) => Math.max(...rgb.map((c, k) => Math.abs(c - (b[i]?.[k] ?? -1000)))) > 24).length;

test("the rail: a click shows one group, a reload keeps it, searching hides the rail and the cards, clearing shows the chosen group again (AC-01)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await expect(pressedGroup(page)).toHaveAttribute("data-group", "Sleep");
  const kitchen = ["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"];

  await showGroup(page, "Kitchen");
  await expect(pressedGroup(page)).toHaveAttribute("data-group", "Kitchen");
  await expect.poll(() => cardKinds(page)).toEqual(kitchen);

  await page.reload();
  await expect(canvasOf(page)).toBeVisible();
  await expect(pressedGroup(page)).toHaveAttribute("data-group", "Kitchen");
  await expect.poll(() => cardKinds(page)).toEqual(kitchen);

  const search = page.getByTestId("quick-add-input");
  await search.fill("sofa");
  await expect(page.locator(".quick-add-row").first()).toBeVisible();
  await expect(page.locator(".palette-rail-button")).toHaveCount(0);
  await expect(page.locator(".palette-card")).toHaveCount(0);

  await search.fill("");
  await expect(page.locator(".palette-rail-button")).toHaveCount(10);
  await expect(pressedGroup(page)).toHaveAttribute("data-group", "Kitchen");
  await expect.poll(() => cardKinds(page)).toEqual(kitchen);
});

test("the \"Dining table with chairs · 8 seats\" card, then a click: a 3.20 × 2.10 set with 8 chairs clear of the table, three a side and one at each end (AC-03, AC-04)", async ({ browser }) => {
  const { page, project } = await seeded(browser, async () => {});
  const canvas = canvasOf(page);
  await pickCard(page, "seatedDining", "8 seats");
  await expect(armedCards(page)).toHaveCount(1);
  await expect(armedCards(page)).toHaveAttribute("data-preset", "8 seats");
  await expect(armedCards(page).locator(".palette-card-name")).toHaveText("Dining table with chairs · 8 seats");
  await clickAt(page, canvas, AT);
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await moveTo(page, canvas, AWAY);

  const set = await drawnObject(project);
  expect(field(set, "kind")).toBe("seatedDining");
  const size = field(field(set, "sizes"), "standard");
  expect(field(size, "width")).toBeCloseTo(3.2, 6);
  expect(field(size, "depth")).toBeCloseTo(2.1, 6);
  const placement = placeIn(set, "s0");
  expect(field(placement, "rotation")).toBe(0);
  const [cx, cy] = list(field(placement, "centre")).map(Number); // get_drawing's points are [x, y]
  if (cx === undefined || cy === undefined) throw new Error("no centre");
  const [left, right, back, front] = [cx - 1.6, cx + 1.6, cy + 1.05, cy - 1.05];

  // The 2.00 × 0.90 table stands 0.60 from the piece's edge: three chairs a side centred x −0.667, 0, +0.667 from the
  // middle (2.00 / 3 cells), and one at each end centred on the depth, each 0.45 wide. A box across each backrest's band
  // line, 0.015 clear of the piece's edge, holds its fill and a line.
  const boxes: [string, WorldPoint, WorldPoint][] = [
    ...[-2 / 3, 0, 2 / 3].flatMap((dx): [string, WorldPoint, WorldPoint][] => [
      [`back chair ${dx.toFixed(2)}`, { x: cx + dx - 0.05, y: back - 0.085 }, { x: cx + dx + 0.05, y: back - 0.015 }],
      [`front chair ${dx.toFixed(2)}`, { x: cx + dx - 0.05, y: front + 0.015 }, { x: cx + dx + 0.05, y: front + 0.085 }],
    ]),
    ["left end chair", { x: left + 0.015, y: cy - 0.05 }, { x: left + 0.085, y: cy + 0.05 }],
    ["right end chair", { x: right - 0.085, y: cy - 0.05 }, { x: right - 0.015, y: cy + 0.05 }],
  ];
  for (const [name, a, b] of boxes) {
    await expect.poll(async () => (await backrest(page, canvas, a, b)).fill, { message: `${name}: the chair's fill` }).toBeGreaterThanOrEqual(6);
    await expect.poll(async () => (await backrest(page, canvas, a, b)).line, { message: `${name}: its lines` }).toBeGreaterThan(24);
  }
  // Between them the strips show the floor: between two side chairs (x ±1/3, where four a side would sit) and beside
  // each end chair (y ±0.32, where a table without end chairs would reach), and in the 0.15 m between a chair and the
  // table (seated.01): no chair is tucked. Every point is off the grid lines.
  const floor = hex(await pixelAt(page, canvas, FLOOR));
  expect(distance(await pixelAt(page, canvas, FLOOR), GREY), "the floor is not the piece's grey").toBeGreaterThan(12);
  const gaps: WorldPoint[] = [
    ...[-1 / 3, 1 / 3].flatMap((dx) => [{ x: cx + dx, y: back - 0.05 }, { x: cx + dx, y: front + 0.05 }]),
    ...[-0.32, 0.32].flatMap((dy) => [{ x: left + 0.05, y: cy + dy }, { x: right - 0.05, y: cy + dy }]),
    { x: cx, y: back - 0.525 }, { x: cx, y: front + 0.525 },
  ];
  for (const p of gaps) {
    await expect.poll(async () => distance(await pixelAt(page, canvas, p), floor), { message: `the floor at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})` }).toBeLessThanOrEqual(12);
  }
});

test("Round chairs: select the set, switch it on in Properties, its chairs draw round and it is stored; one undo squares them and clears it (AC-05)", async ({ browser }) => {
  const { page, project } = await seeded(browser, async (claude) => {
    await claude.call("place_object", { layout: "s0", kind: "seatedDining", preset: "8 seats", centre: AT });
  });
  const canvas = canvasOf(page);
  // The middle back chair's backrest strip (x 2.875–3.325, y 3.10–3.20) with a margin: a square chair fills its back
  // corners, a round one cuts them by 0.12 m arcs and draws a curved band.
  const PROBE: [WorldPoint, WorldPoint] = [{ x: AT.x - 0.27, y: 3.07 }, { x: AT.x + 0.27, y: 3.23 }];
  const round = page.locator('[data-field-id="roundChairs"]');
  const stored = async (): Promise<unknown> => field(field(Object.values((await storedDocument(project)).objects)[0], "options"), "roundChairs");
  const MIDDLE: [WorldPoint, WorldPoint] = [{ x: AT.x - 0.05, y: 3.115 }, { x: AT.x + 0.05, y: 3.185 }];
  await expect.poll(async () => (await backrest(page, canvas, ...MIDDLE)).fill, { message: "the set is drawn" }).toBeGreaterThanOrEqual(10);
  const square = await region(page, canvas, ...PROBE);

  await page.keyboard.press("v");
  await clickAt(page, canvas, AT);
  await expect(round).toHaveAttribute("aria-checked", "false");
  await round.click();
  await expect(round).toHaveAttribute("aria-checked", "true");
  await waitSaved(page);
  await expect.poll(stored).toBe(true);
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => changed(await region(page, canvas, ...PROBE), square), { message: "round chairs change the backrest" }).toBeGreaterThan(30);

  await page.locator('[data-testid="floating-bar"] [data-action="undo"]').click();
  await waitSaved(page);
  await expect.poll(stored).toBeUndefined();
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => changed(await region(page, canvas, ...PROBE), square), { message: "square again" }).toBeLessThanOrEqual(2);
});
