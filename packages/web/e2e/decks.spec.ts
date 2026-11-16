import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS, STYLE_3D, type Bounds3, type Point3 } from "@fm/editor";
import { clickAt, dragFromTo, toScreen, type WorldPoint } from "./support/canvas";
import { pickOpeningKind } from "./support/opening-kind";
import { openProject, waitSaved } from "./support/app-driver";
import { layoutIds, placesOf } from "./support/mcp-listing";
import { startMcp } from "./support/mcp-stdio";
import { distance, expectPixel, screenPixel } from "./support/pixels";
import { screen3d } from "./support/probe3d";
import { drawChain, wallCount } from "./support/pieces";
import { deleteProjects, storedDocument } from "./support/stored";
import { expectNoToast, toast } from "./support/toasts";
import { SERVER } from "./support/server";
import { pickCard } from "./support/palette";

// Decks in a real browser (spec "The sample Studio", AC-17, AC-01, AC-03, AC-04, AC-06, AC-09, AC-10): the Deck tool, a chair
// landing on a platform, "Stands on" lifting a mattress onto a loft and the 3D panel showing it there, a platform drag
// carrying its chair, the level strip (levels AC-03, AC-07, AC-09), then the tiny-house sample, start to finish with a mattress
// dropped on the loft from the loft's view (levels AC-13, cleanup AC-07) and Claude's beat through a real stdio MCP process. Server mode
// throughout: stored rows are read from the server.


const canvasOf = (page: Page) => page.getByTestId("canvas");

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function openAs(browser: Browser, name: string, project: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await openProject(page, project);
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return page;
}

/** A fresh project name; the suffix keeps names apart when repeats run in parallel workers. */
function newProject(): string {
  const name = `zz-decks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(name);
  return name;
}

// ---- stored rows -------------------------------------------------------------------------------------------------

type StoredDeck = { id: string; name: string; at: WorldPoint; w: number; d: number; top: number; solid: boolean };
type StoredPiece = { id: string; object: string; kind: string; state: string; centre: WorldPoint; rotation: number; deck: string | null; w: number; d: number; h: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number") throw new Error(`${what} is not a number`);
  return v;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`${what} is not a string`);
  return v;
};
const point = (v: unknown, what: string): WorldPoint => {
  if (!isRecord(v)) throw new Error(`${what} is not a point`);
  return { x: num(v.x, `${what}.x`), y: num(v.y, `${what}.y`) };
};

async function storedDecks(project: string): Promise<StoredDeck[]> {
  const doc = await storedDocument(project);
  return Object.values(doc.decks).map((r) => {
    if (typeof r.solid !== "boolean") throw new Error("deck.solid is not a boolean");
    return { id: str(r.id, "deck.id"), name: str(r.name, "deck.name"), at: point(r.at, "deck.at"), w: num(r.w, "deck.w"), d: num(r.d, "deck.d"), top: num(r.top, "deck.top"), solid: r.solid };
  });
}

/** Every placement with its footprint's centre (`at` is the back edge's middle; at rotation 0 the front faces −y). */
async function storedPieces(project: string): Promise<StoredPiece[]> {
  const doc = await storedDocument(project);
  return Object.values(doc.placements).map((p) => {
    const object = doc.objects[str(p.object, "placement.object")];
    const config = str(p.config, "placement.config");
    if (object === undefined || !isRecord(object.w) || !isRecord(object.d) || !isRecord(object.h)) throw new Error("malformed object");
    const depth = num(object.d[config], "object depth");
    const at = point(p.at, "placement.at");
    const rotation = num(p.rotation, "placement.rotation");
    const r = (rotation * Math.PI) / 180;
    const centre = { x: at.x + (depth / 2) * Math.sin(r), y: at.y - (depth / 2) * Math.cos(r) };
    const deck = p.deck === null ? null : str(p.deck, "placement.deck");
    return { id: str(p.id, "placement.id"), object: str(p.object, "placement.object"), kind: str(object.kind, "object.kind"), state: str(p.state, "placement.state"), centre, rotation, deck, w: num(object.w[config], "object width"), d: depth, h: num(object.h[config], "object height") };
  });
}

async function onlyDeck(project: string, name?: string): Promise<StoredDeck> {
  const all = (await storedDecks(project)).filter((d) => name === undefined || d.name === name);
  expect(all).toHaveLength(1);
  const [deck] = all;
  if (deck === undefined) throw new Error("no deck");
  return deck;
}

function expectNear(p: WorldPoint, want: WorldPoint, within = 0.001): void {
  expect(Math.abs(p.x - want.x), `x ${p.x} vs ${want.x}`).toBeLessThanOrEqual(within);
  expect(Math.abs(p.y - want.y), `y ${p.y} vs ${want.y}`).toBeLessThanOrEqual(within);
}

// ---- gestures ----------------------------------------------------------------------------------------------------

/** The Deck tool with a preset, a drag from corner to corner, then back to Select; waits for the server. */
async function drawDeck(page: Page, preset: "platform" | "loft", from: WorldPoint, to: WorldPoint): Promise<void> {
  await page.keyboard.press("k");
  await page.locator(`[data-deck-preset="${preset}"]`).click();
  await dragFromTo(page, canvasOf(page), from, to);
  await waitSaved(page);
  await page.keyboard.press("Escape");
}

/** Picks a kind in the palette (and a size from the picker), clicks the plan at `at`, then back to Select. */
async function place(page: Page, kind: string, at: WorldPoint, opts: { size?: string; turns?: number } = {}): Promise<void> {
  await pickCard(page, kind);
  if (opts.size !== undefined) await page.getByTestId("size-picker-select").selectOption(opts.size);
  for (let i = 0; i < (opts.turns ?? 0); i++) await page.keyboard.press("r");
  await clickAt(page, canvasOf(page), at);
  await waitSaved(page);
  await page.keyboard.press("Escape");
}


/** Types a value into a Properties field and commits it with Enter. */
async function setField(page: Page, id: string, value: string): Promise<void> {
  const input = page.locator(`[data-field-id="${id}"]`);
  await input.fill(value);
  await input.press("Enter");
  await waitSaved(page);
}

/** Picks a deck in the selected piece's "Stands on" (the select lists Floor and the deck under its centre). */
async function standOn(page: Page, deckId: string): Promise<void> {
  await page.locator('select[data-field-id="standsOn"]').selectOption(deckId);
  await waitSaved(page);
}

type Box = { x: number; y: number; width: number; height: number };

/** The composited colours of a page box, as [r, g, b] per pixel. */
async function pixelsIn(page: Page, box: Box): Promise<number[][]> {
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    const out: number[][] = [];
    for (let i = 0; i < data.length; i += 4) out.push([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
    return out;
  }, png.toString("base64"));
}

/** How many pixels in a page box are darker than any light fill (a label's text, antialiased). */
async function darkPixels(page: Page, box: Box): Promise<number> {
  return (await pixelsIn(page, box)).filter((rgb) => Math.max(...rgb) < 170).length;
}

/** The page box over the world rectangle with corners `a` and `b` (through the initial camera). */
async function worldBox(page: Page, a: WorldPoint, b: WorldPoint): Promise<Box> {
  const p = await toScreen(canvasOf(page), a);
  const q = await toScreen(canvasOf(page), b);
  const x = Math.round(Math.min(p.x, q.x));
  const y = Math.round(Math.min(p.y, q.y));
  return { x, y, width: Math.max(1, Math.round(Math.max(p.x, q.x)) - x), height: Math.max(1, Math.round(Math.max(p.y, q.y)) - y) };
}

// ---- the 3D panel ------------------------------------------------------------------------------------------------

/** The composited colour at the 3D panel's pixel where world point `p` lands. */
async function probe3d(page: Page, bounds: Bounds3, p: Point3): Promise<number[]> {
  const s = await screen3d(page, bounds, p);
  return screenPixel(page, s.x, s.y);
}

const expect3d = (page: Page, bounds: Bounds3, p: Point3, hex: string, what: string) =>
  expect.poll(async () => distance(await probe3d(page, bounds, p), hex), { message: what }).toBeLessThanOrEqual(14);

/** The distance from the probed colour to the nearest of `hexes` (a face lit or shaded). */
async function nearest3d(page: Page, bounds: Bounds3, p: Point3, hexes: string[]): Promise<number> {
  const rgb = await probe3d(page, bounds, p);
  return Math.min(...hexes.map((hex) => distance(rgb, hex)));
}

/** Opens the 3D panel in split, on the WebGL2 canvas, at turn 0. */
async function open3d(page: Page): Promise<void> {
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("view3d-panel")).toHaveAttribute("data-size", "split");
  await expect(page.getByTestId("view3d-panel")).toHaveAttribute("data-yaw", "225");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
}

// ---- a 6 × 4 room ------------------------------------------------------------------------------------------------

// Walls 0.20 m thick on the clicked lines: inner faces x 0.1 / 5.9, y 0.1 / 3.9; the default 2.50 m ceiling.
const ROOM: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 }, top: 2.5 };

async function room(browser: Browser): Promise<{ page: Page; project: string }> {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  await drawChain(page, project, [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }], [1, 1, 1, 1]);
  return { page, project };
}

// A platform away from the walls, so neither corner snaps to a face: x 1–3, y 1–2.5.
const PLATFORM_FROM = { x: 1, y: 2.5 };
const PLATFORM_TO = { x: 3, y: 1 };

test("K draws a platform; it is stored with its preset's top and drawn with its tint and label (AC-01, AC-10)", async ({ browser }) => {
  const { page, project } = await room(browser);
  await drawDeck(page, "platform", PLATFORM_FROM, PLATFORM_TO);
  const deck = await onlyDeck(project);
  expect(deck).toMatchObject({ name: "Platform", w: 2, d: 1.5, top: 0.45, solid: true });
  expectNear(deck.at, { x: 2, y: 1.75 });

  const canvas = canvasOf(page);
  await page.mouse.move(5, 5); // no hover over the plan
  await expectPixel(page, canvas, { x: 2.5, y: 1.3 }, COLORS.deck); // the tint, clear of the label
  // "Platform +0.45" hangs below a point 0.12 m inside the top-left corner (1, 2.5): dark text on the light tint.
  const anchor = await toScreen(canvas, { x: 1.12, y: 2.38 });
  await expect.poll(() => darkPixels(page, { x: Math.round(anchor.x) + 1, y: Math.round(anchor.y) + 1, width: 80, height: 10 })).toBeGreaterThan(20);
  // The same box on the floor beside the deck holds no text.
  const beside = await toScreen(canvas, { x: 3.4, y: 2.38 });
  expect(await darkPixels(page, { x: Math.round(beside.x) + 1, y: Math.round(beside.y) + 1, width: 80, height: 10 })).toBeLessThan(5);
});

test("a chair dropped on the platform stands on it (AC-03)", async ({ browser }) => {
  const { page, project } = await room(browser);
  await drawDeck(page, "platform", PLATFORM_FROM, PLATFORM_TO);
  const deck = await onlyDeck(project);
  await place(page, "chair", { x: 2.4, y: 1.6 });
  await expectNoToast(page);
  const pieces = await storedPieces(project);
  expect(pieces).toHaveLength(1);
  expect(pieces[0]).toMatchObject({ kind: "chair", deck: deck.id });
  await expect(page.locator('select[data-field-id="standsOn"]')).toHaveCount(0); // placing leaves nothing selected
  await clickAt(page, canvasOf(page), pieces[0]?.centre ?? { x: 0, y: 0 });
  await expect(page.locator('select[data-field-id="standsOn"]')).toHaveValue(deck.id);
});

test("Stands on puts a 0.35 m mattress on a loft, and the 3D panel shows it at the loft's height (AC-04, AC-09)", async ({ browser }) => {
  const { page, project } = await room(browser);
  // A loft from the bottom-left inner corner, x 0.1–3.0, y 0.1–2.4: hollow, 2.03–2.15.
  await drawDeck(page, "loft", { x: 0.1, y: 0.1 }, { x: 3, y: 2.4 });
  const loft = await onlyDeck(project);
  expect(loft).toMatchObject({ name: "Loft", top: 2.15, solid: false, w: 2.9, d: 2.3 });

  // A bed on the floor under the loft (1.00 m tall, well under its 2.03 underside), then lowered to a mattress.
  await place(page, "bed", { x: 1.5, y: 1.25 });
  const [onFloor] = await storedPieces(project);
  expect(onFloor).toMatchObject({ kind: "bed", deck: null });
  const centre = onFloor?.centre ?? { x: 0, y: 0 };
  await clickAt(page, canvasOf(page), centre);
  await setField(page, "height.standard", "0.35");
  await standOn(page, loft.id);
  await expectNoToast(page);
  const [mattress] = await storedPieces(project);
  expect(mattress).toMatchObject({ kind: "bed", deck: loft.id, h: 0.35 });
  // On the loft it belongs to the loft's level (shown.02): the floor drops it, and the loft selects it again.
  await expect(page.locator('[data-field-id="top"]')).toHaveCount(0);
  await page.keyboard.press("PageUp");
  await clickAt(page, canvasOf(page), centre);
  await expect(page.locator('[data-field-id="top"]')).toHaveValue(/^2\.50 /); // the read-only Top is absolute

  // Selected: its top at 2.15 + 0.35 draws in the selection blue where the camera puts (centre, 2.50).
  await open3d(page);
  await expect3d(page, ROOM, { ...centre, z: 2.5 }, COLORS.objectSelected, "the mattress's top at 2.50");
});

test("a drag of the platform carries the chair (AC-06, AC-10)", async ({ browser }) => {
  const { page, project } = await room(browser);
  await drawDeck(page, "platform", PLATFORM_FROM, PLATFORM_TO);
  await place(page, "chair", { x: 2.4, y: 1.6 });
  const before = await onlyDeck(project);
  const [chair] = await storedPieces(project);
  expect(chair?.deck).toBe(before.id);
  const canvas = canvasOf(page);
  await clickAt(page, canvas, { x: 1.4, y: 1.3 }); // the platform, clear of the chair
  await dragFromTo(page, canvas, { x: 1.4, y: 1.3 }, { x: 2.4, y: 1.3 }); // 1 m east, on the snap step
  await waitSaved(page);
  const after = await onlyDeck(project);
  expectNear(after.at, { x: before.at.x + 1, y: before.at.y });
  const [moved] = await storedPieces(project);
  expect(moved?.deck).toBe(before.id);
  expectNear(moved?.centre ?? { x: 0, y: 0 }, { x: (chair?.centre.x ?? 0) + 1, y: chair?.centre.y ?? 0 });
});

// ---- levels ------------------------------------------------------------------------------------------------------

// The room split at x = 3 by a partition lowered to 2.03 (like the sample Studio's); a sofa (2.10 × 0.90) on the west floor; a
// loft x 2–4, y 0.1–2.0 over the partition's south end. At +2.15 the plan is cut at 2.33 (half the 0.35 m to the
// 2.50 ceiling); the partition's north end, outside the loft, then draws as a grey outline (levels.04).
test("the level strip: the loft adds a row; Page Up views it, the sofa hidden and the partition grey; a Bed beside the loft is refused with \"No floor at +2.15 here\" (levels AC-03, AC-07, AC-09)", async ({ browser }) => {
  const { page, project } = await room(browser);
  const canvas = canvasOf(page);
  const strip = page.getByTestId("level-strip");
  const level = (id: string) => strip.locator(`button[data-level="${id}"]`);
  const cut = page.getByTestId("cut-height");
  await drawChain(page, project, [{ x: 3, y: 0 }, { x: 3, y: 4 }], [3]); // both walls split, plus the partition
  await clickAt(page, canvas, { x: 3, y: 3.5 });
  await page.locator('[data-field-id="toCeiling"]').click();
  await waitSaved(page);
  await setField(page, "top", "2.03");
  await page.keyboard.press("Escape");
  await place(page, "sofa", { x: 1.5, y: 2.5 });
  const [sofa] = await storedPieces(project);
  expect(sofa).toMatchObject({ kind: "sofa", deck: null, rotation: 0 });
  await expect(strip).toHaveCount(0); // no deck above the floor's cut

  await drawDeck(page, "loft", { x: 2, y: 0.1 }, { x: 4, y: 2 });
  const loft = await onlyDeck(project);
  expect(loft).toMatchObject({ top: 2.15, solid: false, w: 2, d: 1.9 });
  await expect(strip.locator("button .level-height")).toHaveText(["+2.15", "0.00"]);
  await expect(strip.locator("button .level-name")).toHaveText(["Loft", "Floor"]);
  expect(await strip.locator("button").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-level")))).toEqual([loft.id, "floor"]);
  await expect(level(loft.id)).toHaveAttribute("aria-pressed", "false");
  await expect(level("floor")).toHaveAttribute("aria-pressed", "true");
  await expect(cut).toHaveText("Cut +1.20");

  // The probes, through the initial camera: the sofa's fill, 0.10 m in from its edges (#e0e0de, 7 from the grid's
  // lines and 20 from the canvas, so pixels within 3 of it are the sofa's), and a 1 px row across the partition at
  // y 3.5, north of the loft and of the sofa: the wall's near-black body at the floor, at the loft its two 1 px face
  // lines antialiased to about 216 (darker than the grid line at x 3, about 230) and nothing dark.
  const c = sofa?.centre ?? { x: 0, y: 0 };
  const inSofa = await worldBox(page, { x: c.x - 0.95, y: c.y - 0.35 }, { x: c.x + 0.95, y: c.y + 0.35 });
  const across = await worldBox(page, { x: 2.8, y: 3.5 }, { x: 3.2, y: 3.5 });
  const sofaPixels = async (): Promise<number> => (await pixelsIn(page, inSofa)).filter((rgb) => distance(rgb, COLORS.object) <= 3).length;
  // Hidden: under 1% of the box. At the loft's level "Open to below" (edges.07) can sit over the hidden sofa, and its grey
  // text's anti-aliased edges hit the sofa's fill colour in a few pixels (15 seen); a drawn sofa fills over half.
  const sofaHidden = async (): Promise<boolean> => (await sofaPixels()) < inSofa.width * inSofa.height * 0.01;
  const greyest = async (): Promise<number> => Math.min(...(await pixelsIn(page, across)).map((rgb) => Math.max(...rgb)));
  const floorDrawn = async (): Promise<void> => {
    await expect.poll(sofaPixels, { message: "the sofa drawn" }).toBeGreaterThan(inSofa.width * inSofa.height * 0.5);
    await expect.poll(() => darkPixels(page, across), { message: "the partition solid" }).toBeGreaterThanOrEqual(14); // 0.20 m is 16 px
  };
  await page.mouse.move(5, 5); // no hover over the plan
  await floorDrawn();

  // Page Up views the loft: its row pressed, the cut at 2.33, the sofa gone, the partition a grey outline.
  await page.keyboard.press("PageUp");
  await expect(level(loft.id)).toHaveAttribute("aria-pressed", "true");
  await expect(level("floor")).toHaveAttribute("aria-pressed", "false");
  await expect(cut).toHaveText("Cut +2.33");
  await expect.poll(sofaHidden, { message: "the sofa hidden" }).toBe(true);
  await expect.poll(() => darkPixels(page, across), { message: "the partition not solid" }).toBe(0);
  await expect.poll(greyest, { message: "the partition's grey face lines" }).toBeLessThanOrEqual(222);
  expect(await greyest()).toBeGreaterThanOrEqual(200);
  await page.keyboard.press("PageUp"); // the top level: stays
  await expect(level(loft.id)).toHaveAttribute("aria-pressed", "true");

  // A Bed clicked beside the loft (the east room's floor): refused at this level, nothing sent.
  await pickCard(page, "bed");
  await clickAt(page, canvas, { x: 5, y: 2.8 });
  await expect(toast(page)).toHaveText("No floor at +2.15 here");
  // The toast clears the strip (cleanup AC-04): their boxes don't meet.
  const [toastBox, stripBox] = [await toast(page).boundingBox(), await page.getByTestId("level-strip").boundingBox()];
  if (!toastBox || !stripBox) throw new Error("toast or strip not laid out");
  expect(toastBox.y + toastBox.height, "the toast's bottom above the strip's top").toBeLessThanOrEqual(stripBox.y);
  // In split 3D the toast still shows, above the 3D panel (cleanup.38): its own fill at its centre, read on screen.
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("view3d-panel")).toHaveAttribute("data-size", "split");
  const split = await toast(page).boundingBox();
  if (!split) throw new Error("toast gone before the probe");
  const fill = await toast(page).evaluate((e) => getComputedStyle(e).backgroundColor);
  const rgb = (fill.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const seen = await screenPixel(page, split.x + 4, split.y + split.height / 2);
  expect(Math.max(...seen.map((c, i) => Math.abs(c - (rgb[i] ?? 0)))), `toast fill ${fill}, seen ${seen.join(",")}`).toBeLessThanOrEqual(30);
  await page.keyboard.press("3"); // close the 3D view again
  await page.keyboard.press("Escape");
  await waitSaved(page);
  expect(await storedPieces(project)).toHaveLength(1); // the sofa only
  await expect(level(loft.id)).toHaveAttribute("aria-pressed", "true"); // Escape keeps the level

  // Page Down returns to the floor, drawn as before; the strip's rows view their levels too.
  await page.keyboard.press("PageDown");
  await expect(level("floor")).toHaveAttribute("aria-pressed", "true");
  await expect(cut).toHaveText("Cut +1.20");
  await floorDrawn();
  await level(loft.id).click();
  await expect(level(loft.id)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(sofaHidden, { message: "the sofa hidden again" }).toBe(true);
  await level("floor").click();
  await expect(level("floor")).toHaveAttribute("aria-pressed", "true");
  await floorDrawn();
});

// ---- the sample Studio ----------------------------------------------------------------------------------------------------

// The 7 × 2.5 m studio (spec "The sample Studio"): inner faces x 0.1 / 6.9, y 0.1 / 2.4. A bathroom x 0.1–1.4 behind a partition
// on x = 1.5; a loft x 0.1–2.5 over it and part of the kitchen; the hollow platform x 2.6–4.6, y 1.3–2.4 under a window
// on the top wall; the roll-out bed (a small single, 1.95 × 0.85 turned, 0.30 tall) under it by Day, in front of it at
// Night; Claude's platform x 4.65–6.85, y 0.12–1.32 under a window on the bottom wall, clear of the bed at Night. Under
// the 3.05 ceiling a mattress (0.25 tall) stands on the 2.15 loft; a default bed (1.00) is refused only under a lower
// one, since under 3.05 it now lowers to fit (cleanup.06, clarity.11).
const STUDIO: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05 };
const SMALL_SINGLE = "Small single 85 × 195";
const NIGHT_BED = { x: 3.6, y: 0.8 };

type Drawing = { states: { id: string; name: string }[]; objects: { id: string; kind: string; placements: Record<string, { on: string } | null> }[]; decks: { id: string; name: string; range: { bottom: number; top: number } }[] };

/** get_drawing's shape, as far as this test reads it. */
function drawingOf(v: unknown): Drawing {
  if (!isRecord(v) || !Array.isArray(v.layouts) || !Array.isArray(v.objects) || !Array.isArray(v.decks)) throw new Error("not a drawing");
  const states = v.layouts.map((s: unknown) => (isRecord(s) ? { id: str(s.id, "state.id"), name: str(s.name, "state.name") } : { id: "", name: "" }));
  const objects = v.objects.map((o: unknown) => {
    if (!isRecord(o) || !(isRecord(o.placements) || isRecord(o.placement))) throw new Error("not an object");
    const placements: Record<string, { on: string } | null> = {};
    for (const [state, p] of Object.entries(placesOf(o, layoutIds(v)))) placements[state] = isRecord(p) ? { on: str(p.on, "placement.on") } : null;
    return { id: str(o.id, "object.id"), kind: str(o.kind, "object.kind"), placements };
  });
  const decks = v.decks.map((d: unknown) => {
    if (!isRecord(d) || !isRecord(d.range)) throw new Error("not a deck");
    return { id: str(d.id, "deck.id"), name: str(d.name, "deck.name"), range: { bottom: num(d.range.bottom, "bottom"), top: num(d.range.top, "top") } };
  });
  return { states, objects, decks };
}

test("the tiny-house sample, start to finish: partition, loft and a mattress dropped on it from the loft's view (a bed refused under 2.85), a hollow platform with a roll-out bed by Day and Night, then Claude's platform and sofa (AC-17, levels AC-13)", async ({ browser }) => {
  test.setTimeout(180_000);
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const canvas = canvasOf(page);

  // The shell, the ceiling, the partition lowered to 2.03 with its door, two windows. The 10 cm step: the Auto step
  // at this zoom would put a click at y 2.5 on 2.6.
  await page.locator('[data-snap-step="0.1"]').click();
  await drawChain(page, project, [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 2.5 }, { x: 0, y: 2.5 }, { x: 0, y: 0 }], [1, 1, 1, 1]);
  await setField(page, "ceiling.height", "3.05");
  const shell = await wallCount(project);
  await drawChain(page, project, [{ x: 1.5, y: 0 }, { x: 1.5, y: 2.5 }], [3]); // both walls split, plus the partition
  expect(await wallCount(project)).toBe(shell + 3);
  await clickAt(page, canvas, { x: 1.5, y: 0.6 });
  await page.locator('[data-field-id="toCeiling"]').click();
  await waitSaved(page);
  await setField(page, "top", "2.03");
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  await clickAt(page, canvas, { x: 1.5, y: 1.6 }); // a door in the 2.03 m partition
  await waitSaved(page);
  await pickOpeningKind(page, "window");
  await clickAt(page, canvas, { x: 3.6, y: 2.45 }); // over the platform
  await waitSaved(page);
  await clickAt(page, canvas, { x: 5.75, y: 0.05 }); // Claude's
  await waitSaved(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expectNoToast(page);
  const built = await storedDocument(project);
  expect(Object.values(built.walls).map((w) => w.top).filter((t) => t !== "ceiling")).toEqual([2.03]);
  expect(Object.values(built.openings).map((o) => o.kind).sort()).toEqual(["swing", "window", "window"]);
  expect(Object.values(built.ceilings).map((c) => c.height)).toEqual([3.05]);
  expect(Math.max(...Object.values(built.joints).map((j) => num(j.y, "joint.y")))).toBe(2.5);

  // The loft across the partition; the strip's Loft row views it. A default bed (1.00 tall) clicked over it under a 2.85
  // ceiling, where even its 3/4 doesn't fit, would reach 3.15 and is refused; back under 3.05 a mattress (1.60 × 2.00,
  // 0.25 tall) stands on it, 2.15–2.40: no Height, no Stands on (levels AC-13, cleanup AC-07). Page Down returns to the floor.
  await drawDeck(page, "loft", { x: 0.1, y: 0.1 }, { x: 2.5, y: 2.4 });
  const loft = await onlyDeck(project, "Loft");
  expect(loft).toMatchObject({ top: 2.15, solid: false, w: 2.4, d: 2.3 });
  const level = (id: string) => page.locator(`[data-testid="level-strip"] button[data-level="${id}"]`);
  await level(loft.id).click();
  await expect(level(loft.id)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await setField(page, "ceiling.height", "2.85");
  await pickCard(page, "bed");
  await clickAt(page, canvas, { x: 1, y: 1.25 });
  await expect(toast(page)).toHaveText("Bed reaches 3.15 m in Layout; the ceiling is 2.85 m"); // a positive check may retry
  await page.keyboard.press("Escape");
  expect(await storedPieces(project)).toEqual([]);
  await setField(page, "ceiling.height", "3.05");
  await expect(toast(page)).toHaveCount(0, { timeout: 8_000 }); // a wait for the refusal to fade, so later checks read none
  await place(page, "mattress", { x: 1, y: 1.25 });
  const states = Object.values((await storedDocument(project)).states);
  expect(states).toHaveLength(1);
  const [mattress] = await storedPieces(project);
  // Flush with the left wall, the corner turn sets its back to it: 2.00 along x, 1.60 along y (cleanup.19).
  expect([mattress]).toMatchObject([{ kind: "mattress", deck: loft.id, rotation: 90, w: 1.6, d: 2, h: 0.25, state: str(states[0]?.id, "state id") }]);
  const mattressAt = mattress?.centre ?? { x: 0, y: 0 };
  await page.keyboard.press("PageDown");
  await expect(level("floor")).toHaveAttribute("aria-pressed", "true");

  // The hollow platform under the top window, and the roll-out bed in front of it.
  await drawDeck(page, "platform", { x: 2.6, y: 2.4 }, { x: 4.6, y: 1.3 });
  await clickAt(page, canvas, { x: 4.3, y: 1.5 });
  await page.locator('[data-field-id="solid"]').click();
  await waitSaved(page);
  const platform = await onlyDeck(project, "Platform");
  expect(platform).toMatchObject({ top: 0.45, solid: false, w: 2, d: 1.1 });
  await place(page, "bed", NIGHT_BED, { size: SMALL_SINGLE, turns: 1 });
  await clickAt(page, canvas, NIGHT_BED);
  await setField(page, "height.standard", "0.3");
  await page.keyboard.press("Escape");

  // Day and Night: the copy keeps the bed in front; by Day it slides under the platform (0.30 under its 0.33 underside).
  // The bed is linked across the layouts (review.05), so by Day it is made Day's own first ("Every layout" off).
  await page.getByTestId("state-name").fill("Day");
  await page.getByTestId("state-name").press("Enter");
  await waitSaved(page);
  await page.getByTestId("state-add").click();
  await waitSaved(page);
  await page.getByTestId("state-name").fill("Night");
  await page.getByTestId("state-name").press("Enter");
  await waitSaved(page);
  const pill = page.locator('[data-testid="state-pill"] button[data-state-id]');
  await pill.first().click(); // Day
  await expect(page.getByTestId("state-name")).toHaveValue("Day");
  await clickAt(page, canvas, NIGHT_BED);
  const everyLayout = page.locator('[data-field-id="linked"]');
  await expect(everyLayout).toHaveAttribute("aria-checked", "true");
  await everyLayout.click();
  await waitSaved(page);
  await expect(everyLayout).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await dragFromTo(page, canvas, NIGHT_BED, { x: NIGHT_BED.x, y: NIGHT_BED.y + 1 });
  await waitSaved(page);
  await expectNoToast(page);
  const doc = await storedDocument(project);
  const stateId = (name: string): string => str(Object.values(doc.states).find((s) => s.name === name)?.id, `${name}'s id`);
  const [day, night] = [stateId("Day"), stateId("Night")];
  const rollOut = (await storedPieces(project)).filter((p) => p.kind === "bed" && p.deck === null);
  const byDay = rollOut.find((p) => p.state === day);
  const atNight = rollOut.find((p) => p.state === night);
  expect(rollOut).toHaveLength(2);
  expect(byDay?.h).toBe(0.3);
  expect(byDay?.centre.y ?? 0).toBeGreaterThan(1.3 + 0.425 - 0.001); // wholly under the platform (y 1.3–2.4)
  expectNear(atNight?.centre ?? { x: 0, y: 0 }, { x: byDay?.centre.x ?? 0, y: atNight?.centre.y ?? 0 });
  expect(atNight?.centre.y ?? 9).toBeLessThan(1.3 - 0.425 + 0.001); // wholly in front of it
  expect((await storedPieces(project)).filter((p) => p.deck === loft.id)).toHaveLength(2); // the mattress, in both layouts

  // The 3D panel: the mattress's top at 2.15 + 0.175 by Day (its pillows rise to 2.40 at the head, parts.26); the
  // roll-out bed's front face appears at Night. Seen from the south-west, a top drawn lower slides down the picture: 5 cm
  // inside its far (north) edge at 2.325 is the top only while it is drawn within about 5 cm of 2.325, and 5 cm beyond
  // that edge never is.
  await open3d(page);
  await page.keyboard.press("PageUp"); // the mattress is selected at its own level (shown.02)
  await clickAt(page, canvas, mattressAt);
  const farEdge = mattressAt.y + 1.6 / 2; // turned 90°: its width runs along y
  await expect3d(page, STUDIO, { x: mattressAt.x, y: farEdge - 0.05, z: 2.325 }, COLORS.objectSelected, "the mattress's top at 2.15 + 0.175, by its far edge");
  const beyond = await probe3d(page, STUDIO, { x: mattressAt.x, y: farEdge + 0.05, z: 2.325 });
  expect(distance(beyond, COLORS.objectSelected), "beyond the top's far edge, not the mattress").toBeGreaterThan(14);
  await page.keyboard.press("Escape");
  await page.keyboard.press("PageDown");
  // The middle of the mattress's side on its south face (z 0.09–0.165 on a 0.30 bed, bedBody), where the bed stands at
  // Night: its ghost snaps to the floor's own pieces and lines only, not to the loft's mattress (shown.02).
  const nightCentre = atNight?.centre ?? NIGHT_BED;
  const bedFront: Point3 = { x: nightCentre.x, y: nightCentre.y - 0.425, z: 0.13 };
  await expect3d(page, STUDIO, bedFront, STYLE_3D.floor, "by Day the floor where the bed stands at Night");
  await pill.last().click(); // Night: the flip slides the bed out
  await expect(page.getByTestId("state-name")).toHaveValue("Night");
  await expect.poll(() => nearest3d(page, STUDIO, bedFront, [STYLE_3D.slots.linen.lit, STYLE_3D.slots.linen.shaded]), { message: "at Night the bed's front face" }).toBeLessThanOrEqual(14);

  // Claude's beat, through a real stdio MCP process: "add a 0.45 m platform under the window with a sofa on it". The
  // default deck (2.00 wide) can't hold the default sofa (2.10), and the sofa turns 180° to face the room.
  const claude = await startMcp(SERVER);
  let deckId = "";
  try {
    const listed: unknown = await claude.call("list_projects");
    const id = isRecord(listed) && Array.isArray(listed.projects) ? listed.projects.find((p: unknown) => isRecord(p) && p.name === project)?.id : undefined;
    await claude.call("open_project", { id: str(id, "project id") });
    const dayId = drawingOf(await claude.call("get_drawing")).states.find((st) => st.name === "Day")?.id;
    const added: unknown = await claude.call("add_deck", { centre: { x: 5.75, y: 0.72 }, width: 2.2, depth: 1.2, top: 0.45 });
    deckId = isRecord(added) && isRecord(added.result) ? str(added.result.deck, "deck id") : "";
    const placed: unknown = await claude.call("place_object", { layout: dayId, kind: "sofa", centre: { x: 5.75, y: 0.62 }, rotation: 180 });
    const sofaId = isRecord(placed) && isRecord(placed.result) ? str(placed.result.object, "object id") : "";
    const drawing = drawingOf(await claude.call("get_drawing"));
    expect(drawing.decks.find((d) => d.id === deckId)).toMatchObject({ name: "Platform 2", range: { bottom: 0, top: 0.45 } });
    expect(drawing.objects.find((o) => o.id === sofaId)?.placements[dayId ?? ""]?.on).toBe(deckId);
    const look = await claude.content("look", { view: "3d" });
    expect(look[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(look[0]?.data ?? "", "base64").subarray(1, 4).toString("latin1")).toBe("PNG");
  } finally {
    claude.close();
  }

  // The browser shows them: by Day the new platform's tint in front of the sofa, and the sofa standing on it.
  await pill.first().click(); // Day
  await expect(page.getByTestId("state-name")).toHaveValue("Day");
  await expectPixel(page, canvas, { x: 6.6, y: 1.22 }, COLORS.deck); // right of "Platform 2 +0.45" and its plate (cleanup.05)
  await clickAt(page, canvas, { x: 5.75, y: 0.62 });
  await expect(page.locator('select[data-field-id="standsOn"]')).toHaveValue(deckId);
  await expect3d(page, STUDIO, { x: 5.75, y: 1.0, z: 0.88 }, COLORS.objectSelected, "the sofa's middle cushion top at 0.45 + 0.43, its front half (the back hides the rest from the south-west)");

  // The record: the end state as the user sees it and as exported (kept with the test's output).
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);
  await page.screenshot({ path: test.info().outputPath("studio-3d.png") });
  await page.locator('[data-action="close3d"]').click();
  await page.screenshot({ path: test.info().outputPath("studio-plan.png") });
  const download = async (format: "svg" | "pdf"): Promise<string> => {
    await page.getByTestId("export-button").click();
    await expect(page.getByTestId("sheets-view")).toBeVisible();
    if (format === "svg") await page.getByTestId("images-button").click();
    const save = format === "svg" ? page.locator('[data-format="svg"]') : page.getByTestId("sheets-save-pdf");
    const [d] = await Promise.all([page.waitForEvent("download"), save.click()]);
    const path = test.info().outputPath(`studio.${format}`);
    await d.saveAs(path);
    await page.getByTestId("sheets-close").click();
    await expect(page.getByTestId("sheets-view")).toBeHidden();
    return path;
  };
  const svg = await readFile(await download("svg"), "utf8");
  for (const label of ["Loft +2.15", "Platform +0.45", "Platform 2 +0.45"]) expect(svg).toContain(`>${label}<`);
  const pdf = (await readFile(await download("pdf"))).toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(4); // Day and Night, each at the floor and at the loft with the mattress (AC-01)
});
