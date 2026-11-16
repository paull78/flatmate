import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { COLORS, OBJECT_KINDS } from "@fm/editor";
import { clickAt, moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { placeIn } from "./support/mcp-listing";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { pickCard } from "./support/palette";
import { pieces, type Piece } from "./support/pieces";
import { distance, pixelAt } from "./support/pixels";
import { SERVER } from "./support/server";
import { deleteProjects, storedDocument } from "./support/stored";
import { expectNoToast, toast } from "./support/toasts";

// The catalog cycle in a real browser (step 15), in Canvas2D and in WebGL: a corner desk placed from its card into a
// room corner, its arm grip, its zone's depth handle, a chair in its empty quarter (AC-01 to AC-04), a sofa on a rug
// (AC-07), a hob's six rings and a fridge's Under-counter preset (AC-06). Each test seeds a 6 × 4 room over MCP (inner
// faces x 0.1 / 5.9, y 0.1 / 3.9), labelled so its floor is blue, with its tag at LABEL, far from every probe. Floor
// probes sit off the 0.2 m grid lines (seating.23). A run acts like a user: the pointer moves along a path and every edit
// waits for its acknowledgement.

const AWAY: WorldPoint = { x: 8, y: -1 }; // the cursor off the drawing, so no hover changes the probes
const LABEL: WorldPoint = { x: 4.9, y: 0.7 };
const FLOOR: WorldPoint = { x: 1.1, y: 1.1 }; // empty labelled floor in every fixture, off the grid lines
const AT: WorldPoint = { x: 3.1, y: 2.1 }; // where a piece is placed in the room's middle

// The corner desk in the room's top-left corner, 1.60 × 1.20 with arms of 0.60: its back arm x 0.1–1.7, y 3.3–3.9, its
// left arm x 0.1–0.7, y 2.7–3.3, its empty quarter x 0.7–1.7, y 2.7–3.3. MCP's `at` is the footprint's centre.
const DESK_CENTRE: WorldPoint = { x: 0.9, y: 3.3 };
const BACK_ARM: WorldPoint = { x: 1.3, y: 3.6 };
const LEFT_ARM: WorldPoint = { x: 0.4, y: 3.0 };
const QUARTER: WorldPoint = { x: 1.3, y: 3.1 };

// How close a pixel must be to a fill: the grey and the rug are 12 apart, the rug and the floor 15, the floor and the grey 23.
const FILL = 4;

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

/** A JSON field read without casts (the e2e package has no MCP types). */
const field = (v: unknown, key: string): unknown => (typeof v === "object" && v !== null ? Reflect.get(v, key) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A fresh project seeded over MCP (the labelled room, then `seed`), opened by Alice in `renderer`. */
async function seeded(browser: Browser, { renderer, label }: Renderer, seed: (claude: McpClient) => Promise<void> = async () => {}): Promise<{ page: Page; project: string }> {
  const project = `zz-catalog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  await expect(page.locator('[data-action="renderer"]')).toHaveText(label);
  await moveTo(page, canvasOf(page), AWAY);
  return { page, project };
}

const seedDesk = async (claude: McpClient): Promise<void> => {
  await claude.call("place_object", { layout: "s0", kind: "cornerDesk", centre: DESK_CENTRE });
};

/** The pointer glides from `from` to `to` in many small moves (a person's path, not a jump). */
async function glide(page: Page, from: WorldPoint, to: WorldPoint): Promise<void> {
  const canvas = canvasOf(page);
  const [a, b] = [await toScreen(canvas, from), await toScreen(canvas, to)];
  await page.mouse.move(a.x, a.y, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 30 });
}

/** A drag along a path from `from` to `to`, then the edit's acknowledgement. */
async function drag(page: Page, from: WorldPoint, to: WorldPoint): Promise<void> {
  await glide(page, AWAY, from);
  await page.mouse.down();
  await glide(page, from, to);
  await page.mouse.up();
  await waitSaved(page);
}

/** Places the armed kind by a click at `at` after a glide there, waits until `count` pieces are stored and saved. */
async function place(page: Page, project: string, at: WorldPoint, count: number): Promise<void> {
  await glide(page, AWAY, at);
  await clickAt(page, canvasOf(page), at);
  await expect.poll(async () => (await pieces(project)).length).toBe(count);
  await waitSaved(page);
}

/** Leaves the Object tool with nothing selected and the pointer off the drawing, so the probes see plain fills. */
async function settle(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.keyboard.press("Escape");
  await moveTo(page, canvasOf(page), AWAY);
}

/** The Select tool's click on a piece, with the pointer coming along a path. */
async function select(page: Page, at: WorldPoint): Promise<void> {
  await page.keyboard.press("v");
  await glide(page, AWAY, at);
  await clickAt(page, canvasOf(page), at);
}

/** Waits until the pixel at `p` is within `FILL` of `hex`. */
async function expectFill(page: Page, p: WorldPoint, hex: string, what: string): Promise<void> {
  await expect.poll(async () => distance(await pixelAt(page, canvasOf(page), p), hex), { message: `${what} at (${p.x}, ${p.y}) ≈ ${hex}` }).toBeLessThanOrEqual(FILL);
}

const hex = (rgb: number[]): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** The composited colours of every page pixel in the world box spanned by `a` and `b`, as [r, g, b]. */
async function region(page: Page, a: WorldPoint, b: WorldPoint): Promise<number[][]> {
  const canvas = canvasOf(page);
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

/** How far the region's most different pixel is from `color`: 0 for a plain fill, large where a line crosses it. */
async function farthest(page: Page, a: WorldPoint, b: WorldPoint, color: string): Promise<number> {
  return Math.max(...(await region(page, a, b)).map((rgb) => distance(rgb, color)));
}

function onePiece(all: Piece[], kind: string): Piece {
  const found = all.filter((p) => p.kind === kind);
  expect(found, kind).toHaveLength(1);
  const [piece] = found;
  if (piece === undefined) throw new Error(`no ${kind}`);
  return piece;
}

/** The project's one object of `kind` as Claude's get_drawing lists it, read by a fresh MCP client. */
async function drawn(project: string, kind: string): Promise<unknown> {
  const claude = await startMcp(SERVER);
  try {
    const id = field(list(field(await claude.call("list_projects"), "projects")).find((p) => field(p, "name") === project), "id");
    if (typeof id !== "string") throw new Error(`no project ${project}`);
    const found = list(field(await claude.call("open_project", { id }), "objects")).filter((o) => field(o, "kind") === kind);
    expect(found, kind).toHaveLength(1);
    return found[0];
  } finally {
    claude.close();
  }
}

/** An arm's stored depth on the project's one object, a corner desk. */
const storedArm = async (project: string, arm: "back" | "left"): Promise<unknown> => field(field(Object.values((await storedDocument(project)).objects)[0], "arms"), arm);

for (const look of RENDERERS) {
  test.describe(look.label, () => {
    test("a corner desk from the Work card into a room corner: its right angle on the corner, its fill on both arms, the floor in the empty quarter (AC-03, AC-01)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look);
      await pickCard(page, "cornerDesk");
      // The cursor is the footprint's centre, a little off the corner's: the corner snap makes it exact.
      await place(page, project, { x: DESK_CENTRE.x + 0.04, y: DESK_CENTRE.y - 0.04 }, 1);
      const desk = onePiece(await pieces(project), "cornerDesk");
      expect(desk.w).toBeCloseTo(1.6, 6);
      expect(desk.d).toBeCloseTo(1.2, 6);
      expect(desk.rotation).toBe(0);
      expect(desk.at.x).toBeCloseTo(0.9, 3); // `at` is the back edge's middle
      expect(desk.at.y).toBeCloseTo(3.9, 3);
      await settle(page);
      const floor = hex(await pixelAt(page, canvasOf(page), FLOOR));
      expect(distance(await pixelAt(page, canvasOf(page), FLOOR), COLORS.object), "the floor is not the piece's grey").toBeGreaterThan(12);
      await expectFill(page, BACK_ARM, COLORS.object, "the back arm");
      await expectFill(page, LEFT_ARM, COLORS.object, "the left arm");
      await expectFill(page, QUARTER, floor, "the empty quarter");
    });

    test("the back arm grip: a drag across the arm reads 0.80 in Properties, is stored and draws the deeper arm (AC-02)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look, seedDesk);
      await select(page, BACK_ARM);
      const backArm = page.locator('[data-field-id="backArm"]');
      await expect(backArm).toHaveValue("0.60");
      await drag(page, { x: 1.2, y: 3.3 }, { x: 1.2, y: 3.1 }); // the grip on the inner edge's middle, into the quarter
      await moveTo(page, canvasOf(page), AWAY);
      await expect.poll(() => storedArm(project, "back")).toBeCloseTo(0.8, 6);
      await expect(backArm).toHaveValue("0.80");
      expect(await storedArm(project, "left")).toBeCloseTo(0.6, 6);
      await page.keyboard.press("Escape");
      await expectFill(page, { x: 1.3, y: 3.2 }, COLORS.object, "the deeper arm"); // the floor before the drag
    });

    test("the zone's depth handle: a drag outward changes the stored front depth, as get_drawing lists it (AC-04)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look, seedDesk);
      const frontZone = async (): Promise<unknown> => field(field(placeIn(await drawn(project, "cornerDesk"), "s0"), "zones"), "front");
      expect(field(await frontZone(), "depth")).toBeCloseTo(0.8, 6);
      await select(page, BACK_ARM);
      // At a depth of 0.80 the left strip (0.60 long) lies inside the back strip: one depth handle, on the back strip's
      // outer line: x the middle of the inner edge 0.7–1.7, y the inner corner's 3.3 less the depth.
      await drag(page, { x: 1.2, y: 2.5 }, { x: 1.2, y: 2.3 });
      await expect.poll(async () => field(await frontZone(), "depth")).toBeCloseTo(1, 6);
      expect(await frontZone()).toMatchObject({ start: 0, end: 0 });
    });

    test("a chair in the empty quarter is accepted, no toast; one over the back arm is refused with one (AC-01)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look, seedDesk);
      await pickCard(page, "chair");
      // The 0.45 chair centred (1.25, 3.0): x 1.025–1.475, y 2.775–3.225, wholly in the quarter.
      await place(page, project, { x: 1.25, y: 3 }, 2);
      await expectNoToast(page);
      const chair = onePiece(await pieces(project), "chair");
      // It may snap to the arm's lines (guides), so a hair's slack on the quarter's sides.
      expect(chair.at.x - chair.w / 2).toBeGreaterThan(0.7 - 1e-6);
      expect(chair.at.x + chair.w / 2).toBeLessThan(1.7 + 1e-6);
      expect(chair.at.y).toBeLessThan(3.3 + 1e-6);
      expect(chair.at.y - chair.d).toBeGreaterThan(2.7 - 1e-6);

      await glide(page, { x: 1.25, y: 3 }, { x: 1.2, y: 3.6 });
      await clickAt(page, canvasOf(page), { x: 1.2, y: 3.6 });
      await expect(toast(page)).toBeVisible(); // the control: the no-toast check above can tell
      await waitSaved(page);
      expect(await pieces(project)).toHaveLength(2);
    });

    test("a rug, then a sofa on it: both stored, the sofa's fill over the rug's, the rug's around it (AC-07)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look);
      await pickCard(page, "rug");
      await place(page, project, AT, 1); // 2.00 × 1.40
      const rug = onePiece(await pieces(project), "rug");
      await pickCard(page, "sofa", "2 seats"); // 1.50 × 0.90, wholly on the rug
      await place(page, project, AT, 2);
      await expectNoToast(page);
      const sofa = onePiece(await pieces(project), "sofa");
      await settle(page);
      const [cx, rugBack] = [rug.at.x, rug.at.y];
      const [sofaBack, sofaFront] = [sofa.at.y, sofa.at.y - sofa.d];
      expect(sofa.at.x - sofa.w / 2).toBeGreaterThanOrEqual(cx - rug.w / 2);
      expect(sofa.at.x + sofa.w / 2).toBeLessThanOrEqual(cx + rug.w / 2);
      expect(sofaBack).toBeLessThanOrEqual(rugBack);
      expect(sofaFront).toBeGreaterThanOrEqual(rugBack - rug.d);
      // A seat of the sofa, clear of the seam at its middle and of its cushion's lines: the grey, 12 from the rug.
      await expectFill(page, { x: sofa.at.x + 0.37, y: sofaFront + 0.35 }, COLORS.object, "the sofa over the rug");
      // The rug's fill between the sofa's back and the rug's border line (0.098 in from its back).
      await expectFill(page, { x: sofa.at.x, y: (sofaBack + rugBack - 0.098) / 2 }, COLORS.rug, "the rug around the sofa");
      const floor = hex(await pixelAt(page, canvasOf(page), FLOOR));
      expect(distance(await pixelAt(page, canvasOf(page), { x: sofa.at.x, y: (sofaBack + rugBack - 0.098) / 2 }), floor), "the rug is not the floor").toBeGreaterThan(FILL);
    });

    test("a 6-burner hob (0.90): the middle column's ring draws, which only six burners have (AC-06)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look);
      await pickCard(page, "hobUnit");
      const option = OBJECT_KINDS.find((k) => k.id === "hobUnit")?.presets.find((p) => p.id === "6 burners")?.label;
      await page.getByTestId("size-picker-select").selectOption({ label: option ?? "" });
      await place(page, project, AT, 1);
      const hob = onePiece(await pieces(project), "hobUnit");
      expect(hob.w).toBeCloseTo(0.9, 6);
      expect(hob.d).toBeCloseTo(0.6, 6);
      await settle(page);
      // Six rings: columns x 0, ±w/3.2, rows ±d/4 from the centre; the middle ones 0.078 in radius (0.13 × the depth).
      const [cx, cy] = [hob.at.x, hob.at.y - hob.d / 2];
      const ring = { x: cx, y: cy + hob.d / 4 };
      const box = (at: WorldPoint, half: number): [WorldPoint, WorldPoint] => [{ x: at.x - half, y: at.y - half }, { x: at.x + half, y: at.y + half }];
      await expect.poll(() => farthest(page, ...box(ring, 0.1), COLORS.object), { message: "the ring's line" }).toBeGreaterThan(24);
      expect(await farthest(page, ...box(ring, 0.04), COLORS.object), "plain inside the ring").toBeLessThanOrEqual(8);
      expect(await farthest(page, ...box({ x: cx + hob.w / 6.4, y: ring.y }, 0.02), COLORS.object), "plain between two columns").toBeLessThanOrEqual(8);
    });

    test("a fridge's Under-counter preset: 0.60 × 0.60, its height 0.85 read back from Properties and get_drawing (AC-06)", async ({ browser }) => {
      const { page, project } = await seeded(browser, look);
      await pickCard(page, "fridge");
      const option = OBJECT_KINDS.find((k) => k.id === "fridge")?.presets.find((p) => p.id === "Under-counter")?.label;
      await page.getByTestId("size-picker-select").selectOption({ label: option ?? "" });
      await place(page, project, AT, 1);
      await settle(page);
      const size = field(field(await drawn(project, "fridge"), "sizes"), "standard");
      expect(size).toMatchObject({ width: 0.6, depth: 0.6, height: 0.85 });
      await select(page, AT);
      await expect(page.locator('[data-field-id="height.standard"]')).toHaveValue("0.85");
    });
  });
}
