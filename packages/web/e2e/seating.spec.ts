import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { pieces, type Piece } from "./support/pieces";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { deleteProjects, storedDocument } from "./support/stored";
import { SERVER } from "./support/server";
import { armedCards, showGroup } from "./support/palette";

// The seating cycle in a real browser (step 13): pieces draw white over a finish (AC-01), a chair dragged to a desk's
// front tucks and the free floor rises (AC-08, AC-06), the desk draws over its tucked chair on WebGL and a click in the
// overlap picks the desk (AC-07), a dining set from quick add draws its four chairs (AC-04), and "With computer" draws
// the gear (AC-09). Each test seeds a 6 × 4 room over MCP (inner faces x 0.1 / 5.9, y 0.1 / 3.9), labelled so its free
// floor shows, with its tag at LABEL, far from every probe. Probes inside a piece sit off its lines; probes on the floor
// sit off the 0.2 m grid lines, since the grey fill is close to the grid colours (editor.md:83).

const AWAY: WorldPoint = { x: 8, y: -1 }; // the cursor off the drawing, so no hover changes the probes
const LABEL: WorldPoint = { x: 4.9, y: 0.7 };
const FLOOR: WorldPoint = { x: 1.1, y: 1.1 }; // empty labelled floor in every fixture, off the grid lines
const WHITE = COLORS.objectOnFinish;
const GREY = COLORS.object;

type Renderer = "canvas2d" | "webgl";

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const canvasOf = (page: Page) => page.getByTestId("canvas");

/** A JSON field read without casts (the e2e package has no MCP types). */
const field = (v: unknown, key: string): unknown => (typeof v === "object" && v !== null ? Reflect.get(v, key) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The room's label id in a get_drawing reply. */
function labelId(drawing: unknown): string {
  const id = field(list(field(list(field(drawing, "rooms"))[0], "labels"))[0], "id");
  if (typeof id !== "string") throw new Error("no label");
  return id;
}

/** A fresh project seeded over MCP (the labelled room, then `seed`), opened by Alice in `renderer`. */
async function seeded(browser: Browser, renderer: Renderer, seed: (claude: McpClient) => Promise<void>): Promise<{ page: Page; project: string }> {
  const project = `zz-seating-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** The pointer glides from `from` to `to` in many small moves (a person's path, not a jump). */
async function glide(page: Page, canvas: Locator, from: WorldPoint, to: WorldPoint): Promise<void> {
  const [a, b] = [await toScreen(canvas, from), await toScreen(canvas, to)];
  await page.mouse.move(a.x, a.y, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 30 });
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

/** How far the region's most different pixel is from `hex`: 0 for a plain fill, large where a line crosses it. */
async function farthest(page: Page, canvas: Locator, a: WorldPoint, b: WorldPoint, hex: string): Promise<number> {
  return Math.max(...(await region(page, canvas, a, b)).map((rgb) => distance(rgb, hex)));
}

const hex = (rgb: number[]): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** The room's free floor in m², read from its Properties after a click on its empty floor; Esc clears the selection. */
async function freeFloor(page: Page): Promise<number> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), FLOOR);
  const value = await page.locator('[data-field-id="free"]').inputValue();
  await page.keyboard.press("Escape");
  return parseFloat(value);
}

function onePiece(all: Piece[], kind: string): Piece {
  const found = all.filter((p) => p.kind === kind);
  expect(found, kind).toHaveLength(1);
  const [piece] = found;
  if (piece === undefined) throw new Error(`no ${kind}`);
  return piece;
}

test("white pieces over a finish: a sofa in a planked room is white with Finishes on, grey with it off (AC-01)", async ({ browser }) => {
  // The 2.10 × 0.90 sofa centred (3.1, 2.0): its back at y 2.45, three cushions; the middle one x 2.825–3.375,
  // y 1.575–2.209. PROBE is inside it, 0.05 m or more from every line, so it shows the piece's fill.
  const { page } = await seeded(browser, "canvas2d", async (claude) => {
    await claude.call("set_finish", { label: labelId(await claude.call("get_drawing")), motif: "planks" });
    await claude.call("place_object", { layout: "s0", kind: "sofa", centre: { x: 3.1, y: 2.0 } });
  });
  const canvas = canvasOf(page);
  const PROBE = { x: 3.1, y: 1.9 };
  await showGroup(page, "Floors");
  const finishes = page.getByTestId("finishes-switch");
  await expect(finishes).toHaveAttribute("aria-checked", "true");
  await expectPixel(page, canvas, PROBE, WHITE);
  await finishes.click();
  await expect(finishes).toHaveAttribute("aria-checked", "false");
  await expectPixel(page, canvas, PROBE, GREY);
  expect(distance(await pixelAt(page, canvas, PROBE), WHITE)).toBeGreaterThan(24); // grey and white are 31 apart
  await finishes.click();
  await expectPixel(page, canvas, PROBE, WHITE);
});

test("tuck a chair by dragging: a chair 30° off a desk's front, dragged along a path toward it, ends square and tucked; the free floor rises (AC-08, AC-06)", async ({ browser }) => {
  // The recipe of editor/test/scenarios/tuck-drag.test.ts: the 1.20 × 0.60 desk x 1.4–2.6, y 3.3–3.9 (front y 3.3), the
  // 0.45 chair at 210° centred (2, 2.5). Dragged by 0.40 to centre (2, 2.9) its front comes 0.093 from the edge (7.4 px);
  // tucked it turns to 180° with its back edge's middle on y 3.2, 0.35 m under the desk.
  const { page, project } = await seeded(browser, "canvas2d", async (claude) => {
    await claude.call("place_object", { layout: "s0", kind: "desk", centre: { x: 2, y: 3.6 } });
    await claude.call("place_object", { layout: "s0", kind: "chair", centre: { x: 2, y: 2.5 }, rotation: 210 });
  });
  const canvas = canvasOf(page);
  const before = await freeFloor(page);
  expect(before).toBeCloseTo(22.04 - 1.2 * 0.6 - 0.45 * 0.45, 1); // the fixture: both pieces in the room, apart

  const from = { x: 2, y: 2.5 };
  await glide(page, canvas, AWAY, from);
  await page.mouse.down();
  await glide(page, canvas, from, { x: 2, y: 2.9 });
  await page.mouse.up();
  await waitSaved(page);
  await expect.poll(async () => onePiece(await pieces(project), "chair").rotation).toBe(180);
  const chair = onePiece(await pieces(project), "chair");
  expect(Math.abs(chair.at.x - 2)).toBeLessThanOrEqual(0.0011);
  expect(Math.abs(chair.at.y - 3.2)).toBeLessThanOrEqual(0.0011);
  await expect(page.locator(".fm-toast")).toBeHidden();

  // The overlap 0.45 × 0.35 is counted once (AC-06): free floor up by 0.1575 m², shown to the centimetre.
  await page.keyboard.press("Escape");
  await expect.poll(() => freeFloor(page)).toBeGreaterThan(before);
  expect((await freeFloor(page)) - before).toBeCloseTo(0.1575, 1);
});

test("the table draws over the chair on WebGL: no chair line inside the desk; selected, its outline shows; a click in the overlap picks the desk, a second the chair (AC-07)", async ({ browser }) => {
  // The desk as above and the chair tucked over MCP: centre (2, 3.425) at 180°, back y 3.2, front y 3.65. Unclipped, its
  // seat (x 1.815–2.185, front line y 3.61) and its outline (x 1.775 / 2.225, y 3.65) would cross INSIDE, a box in the
  // overlap 4 px clear of the desk's front line (y 3.3); the desk has no inner lines.
  const { page } = await seeded(browser, "webgl", async (claude) => {
    await claude.call("place_object", { layout: "s0", kind: "desk", centre: { x: 2, y: 3.6 } });
    await claude.call("place_object", { layout: "s0", kind: "chair", centre: { x: 2, y: 3.425 }, rotation: 180 });
  });
  const canvas = canvasOf(page);
  await expect(page.locator('[data-action="renderer"]')).toHaveText("WebGL");
  const INSIDE: [WorldPoint, WorldPoint] = [{ x: 1.75, y: 3.35 }, { x: 2.25, y: 3.68 }];
  await expect.poll(() => farthest(page, canvas, ...INSIDE, GREY), { message: "only the desk's fill in the overlap" }).toBeLessThanOrEqual(8);

  // A click in the overlap selects the desk (angle 0), a second click there the chair (180).
  const angle = page.locator('[data-field-id="angle"]');
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 2.1, y: 3.5 });
  await expect(angle).toHaveValue("0");
  await clickAt(page, canvas, { x: 2.1, y: 3.5 });
  await expect(angle).toHaveValue("180");
  // Selected, the chair's whole symbol draws in selection blue after the desk: the same box now holds its lines.
  await moveTo(page, canvas, AWAY);
  await expect.poll(() => farthest(page, canvas, ...INSIDE, GREY), { message: "the selected chair's lines in the overlap" }).toBeGreaterThan(60);
  await page.keyboard.press("Escape");
  await expect(angle).toHaveCount(0);
  await expect.poll(() => farthest(page, canvas, ...INSIDE, GREY)).toBeLessThanOrEqual(8);
});

test("place a dining set from quick add: \"dining set\", Enter, a click; its four chairs draw, apart (AC-04)", async ({ browser }) => {
  const { page, project } = await seeded(browser, "canvas2d", async () => {});
  const canvas = canvasOf(page);
  await canvas.click({ position: { x: 5, y: 5 } }); // the keys start on the canvas
  await page.keyboard.press("/");
  await expect(page.getByTestId("quick-add-input")).toBeFocused();
  await page.keyboard.type("dining set");
  await expect(page.locator('.quick-add-row[aria-selected="true"]')).toHaveAttribute("data-kind", "seatedDining");
  await page.keyboard.press("Enter");
  await showGroup(page, "Sit and eat"); // quick add leaves the rail on Sleep
  await expect(armedCards(page)).toHaveCount(1);
  await expect(armedCards(page)).toHaveAttribute("data-kind", "seatedDining");
  const at = { x: 3.1, y: 2.1 };
  await glide(page, canvas, AWAY, at);
  await clickAt(page, canvas, at);
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await moveTo(page, canvas, AWAY);

  // The 1.20 × 2.00 set, unturned: two chairs a side centred x ±0.30 from its middle, each backrest's front line 0.04 in
  // from the set's edge (y 0.04 below its back, 0.04 above its front); the table stands 0.60 in from each long side.
  const set = onePiece(await pieces(project), "seatedDining");
  expect(set.rotation).toBe(0);
  expect(set.w).toBeCloseTo(1.2, 6);
  expect(set.d).toBeCloseTo(2.0, 6);
  const back = set.at.y;
  const front = back - set.d;
  // Each chair's band line: a box 0.10 wide and 0.03 tall across it, clear of the table's edge (0.06 away) and the chair's back edge (0.04).
  for (const cx of [set.at.x - 0.3, set.at.x + 0.3]) {
    for (const lineY of [back - 0.04, front + 0.04]) {
      await expect
        .poll(() => farthest(page, canvas, { x: cx - 0.05, y: lineY - 0.015 }, { x: cx + 0.05, y: lineY + 0.015 }, GREY), { message: `the backrest at (${cx.toFixed(2)}, ${lineY.toFixed(2)})` })
        .toBeGreaterThan(24);
    }
  }
  // Between each side's two chairs, in the strip outside the table, the floor shows: four chairs, not one block.
  const floor = hex(await pixelAt(page, canvas, FLOOR));
  expect(distance(await pixelAt(page, canvas, FLOOR), GREY)).toBeGreaterThan(12);
  for (const y of [back - 0.05, front + 0.05]) {
    await expect.poll(async () => distance(await pixelAt(page, canvas, { x: set.at.x, y }), floor), { message: `the floor between the chairs at y ${y.toFixed(2)}` }).toBeLessThanOrEqual(12);
  }
});

test("With computer: select the desk, flip the switch in Properties, the monitor draws on its top; one undo takes it off (AC-09)", async ({ browser }) => {
  // The 1.20 × 0.60 desk centred (3.1, 2.0), back edge y 2.3: the monitor's outline x 2.825–3.375, y 2.17–2.21 (step 12).
  // MONITOR spans it, 5 px clear of the desk's back line; without the gear it is the desk's plain fill.
  const { page, project } = await seeded(browser, "canvas2d", async (claude) => {
    await claude.call("place_object", { layout: "s0", kind: "desk", centre: { x: 3.1, y: 2.0 } });
  });
  const canvas = canvasOf(page);
  const MONITOR: [WorldPoint, WorldPoint] = [{ x: 2.8, y: 2.15 }, { x: 3.4, y: 2.23 }];
  const computer = page.locator('[data-field-id="computer"]');
  const stored = async (): Promise<unknown> => field(field(Object.values((await storedDocument(project)).objects)[0], "options"), "computer"); // library.10
  await expect.poll(() => farthest(page, canvas, ...MONITOR, GREY), { message: "a plain desk top" }).toBeLessThanOrEqual(8);

  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 3.1, y: 1.8 });
  await expect(computer).toHaveAttribute("aria-checked", "false");
  await computer.click();
  await expect(computer).toHaveAttribute("aria-checked", "true");
  await waitSaved(page);
  await expect.poll(stored).toBe(true);
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  await expect.poll(() => farthest(page, canvas, ...MONITOR, GREY), { message: "the monitor's lines" }).toBeGreaterThan(24);

  await page.locator('[data-testid="floating-bar"] [data-action="undo"]').click();
  await waitSaved(page);
  await expect.poll(stored).toBeUndefined();
  await moveTo(page, canvas, AWAY);
  await expect.poll(() => farthest(page, canvas, ...MONITOR, GREY)).toBeLessThanOrEqual(8);
});
