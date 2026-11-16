import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clickAt, dragFromTo, drawRectRoom, moveTo, toScreen, type View, type WorldPoint } from "./support/canvas";
import { openProject, waitSaved } from "./support/app-driver";
import { expectPixel } from "./support/pixels";
import { drawChain, pieces, wallCount, type Piece } from "./support/pieces";
import { deleteProjects, storedDocument, storedUnderlay, type StoredUnderlay } from "./support/stored";
import { PICTURE_A, QUADRANTS, dropPicture, faded, offGrid, onPicture, viewTopLeft, type PictureSpec } from "./support/underlay";
import { SERVER } from "./support/server";
import { pickCard } from "./support/palette";

// Milestone 1 of the furnish cycle in a real browser (step 09): a wardrobe drawn into a niche and a bed into an alcove
// (AC-05), a single bed from the size picker flush in a 1.20 m room (AC-01, AC-07), the Kind field (AC-06), and a big
// picture framed in the importing browser only (AC-09). Server mode except the Kind test; stored rows are read from the
// server.

const [TL, TR, BL, BR] = QUADRANTS;
const MPP = 0.01; // the provisional scale a new picture lands at
const FRAME_MARGIN_PX = 48; // editor/src/underlay.ts: frameBox keeps the framed picture 48 px inside the canvas

const canvasOf = (page: Page) => page.getByTestId("canvas");
const undoButton = (page: Page) => page.locator('[data-testid="floating-bar"] [data-action="undo"]');

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function openAs(browser: Browser, name: string, project: string): Promise<Page> {
  const context = await browser.newContext();
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
  const name = `zz-furnish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(name);
  return name;
}

/** The one stored piece; fails when there is not exactly one. */
async function onlyPiece(project: string): Promise<Piece> {
  const all = await pieces(project);
  expect(all).toHaveLength(1);
  const [piece] = all;
  if (piece === undefined) throw new Error("no piece");
  return piece;
}

function expectNear(p: WorldPoint, want: WorldPoint, within = 0.001): void {
  expect(Math.abs(p.x - want.x), `x ${p.x} vs ${want.x}`).toBeLessThanOrEqual(within);
  expect(Math.abs(p.y - want.y), `y ${p.y} vs ${want.y}`).toBeLessThanOrEqual(within);
}

test("a wardrobe drawn into a niche fills it, back on the back wall; a bed drawn into an alcove has its head at the closed end; one Undo removes a drawn piece (AC-05)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const canvas = canvasOf(page);
  // A 4 × 3 m room: inner faces x 0.1 / 3.9, y 0.1 / 2.9.
  await drawChain(page, project, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 0 }], [1, 1, 1, 1]);
  // Stubs hung from the top wall on the 10 cm step: the Auto lattice's faces sit at odd tenths, so a 0.6 m niche
  // needs y 2.3. Stub A and B make the niche x 1.1–2.3, y 2.3–2.9 (1.20 × 0.60); stub C the alcove x 3.0–3.9, y 0.9–2.9.
  // B goes first: once A splits the top wall at x 1, the midpoint snap of x 1–4 (x 2.5) would catch a click at 2.4.
  await page.locator('[data-snap-step="0.1"]').click();
  await drawChain(page, project, [{ x: 2.4, y: 3.0 }, { x: 2.4, y: 2.3 }], [2]);
  await drawChain(page, project, [{ x: 1.0, y: 3.0 }, { x: 1.0, y: 2.3 }], [2]);
  await drawChain(page, project, [{ x: 2.9, y: 3.0 }, { x: 2.9, y: 0.9 }], [2]);
  await page.locator('[data-snap-step="auto"]').click();
  expect(await wallCount(project)).toBe(10);

  // Each pointer end sits 1.6 px inside a niche corner: the corner snap makes it exact.
  await pickCard(page, "wardrobe");
  await dragFromTo(page, canvas, { x: 1.12, y: 2.88 }, { x: 2.28, y: 2.32 });
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  const wardrobe = await onlyPiece(project);
  expect(wardrobe.kind).toBe("wardrobe");
  expect(wardrobe.w).toBeCloseTo(1.2, 6);
  expect(wardrobe.d).toBeCloseTo(0.6, 6);
  expect(wardrobe.rotation).toBe(0); // the back on the top wall, not on a stub (90 or 270)
  expectNear(wardrobe.at, { x: 1.7, y: 2.9 }); // the middle of the back edge, on the top wall's face

  await undoButton(page).click();
  await expect.poll(() => pieces(project)).toEqual([]);
  await waitSaved(page);
  expect((await storedDocument(project)).objects).toEqual({});

  await pickCard(page, "bed");
  // Release by stub C's end corner (3.0, 0.9): (3.9, 0.9) is no face corner, the room's face runs on below it.
  await dragFromTo(page, canvas, { x: 3.88, y: 2.88 }, { x: 3.02, y: 0.92 });
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  const bed = await onlyPiece(project);
  expect(bed.kind).toBe("bed");
  expect(bed.w).toBeCloseTo(0.9, 6); // a "longest walled side" rule gives w 2.0, d 0.9
  expect(bed.d).toBeCloseTo(2.0, 6);
  expect(bed.rotation).toBe(0);
  expectNear(bed.at, { x: 3.45, y: 2.9 }); // the head at the closed end

  // Across stub A's body (x 0.9–1.1): red, nothing placed.
  const before = await storedDocument(project);
  await dragFromTo(page, canvas, { x: 0.5, y: 2.8 }, { x: 1.5, y: 2.4 });
  await expect(page.locator(".fm-toast")).toBeVisible(); // the refusal
  await waitSaved(page);
  expect(await pieces(project)).toHaveLength(1);
  expect(await storedDocument(project)).toEqual(before);
});

test("a single bed picked in the size picker goes into a 1.20 m room, flush on the head wall, not turned; the pick is remembered (AC-01, AC-07, AC-05 drag under 4 px)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const canvas = canvasOf(page);
  // Inner faces x 0.1 / 1.3, y 0.1 / 2.7: a clear 1.20 × 2.60 room.
  await drawChain(page, project, [{ x: 0, y: 0 }, { x: 1.4, y: 0 }, { x: 1.4, y: 2.8 }, { x: 0, y: 2.8 }, { x: 0, y: 0 }], [1, 1, 1, 1]);

  await pickCard(page, "bed");
  const picker = page.getByTestId("size-picker-select");
  await expect(page.getByTestId("size-picker")).toContainText("Size:");
  await expect(picker).toHaveValue("King 170 × 210");

  await clickAt(page, canvas, { x: 0.7, y: 1.4 }); // a 1.70 m bed can't fit a 1.20 m room
  await expect(page.locator(".fm-toast")).toBeVisible();
  expect(await pieces(project)).toEqual([]);

  await picker.selectOption("Single 100 × 210");
  // Sweep across the centre line, both side gaps within 10 px: the bed never turns towards a side wall.
  for (const x of [0.62, 0.78, 0.7]) await moveTo(page, canvas, { x, y: 1.6 });
  // Left gap 0.05, right gap 0.15: only the left wall is within the 0.125 m tolerance. The back is at 2.67.
  await moveTo(page, canvas, { x: 0.65, y: 1.62 });
  const s = await toScreen(canvas, { x: 0.65, y: 1.62 });
  await page.mouse.down();
  await page.mouse.move(s.x, s.y + 3); // a press-and-drag under 4 px places like a click; the back is 0.0675 off
  await page.mouse.up();
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  const bed = await onlyPiece(project);
  expect(bed.kind).toBe("bed");
  expect(bed.w).toBeCloseTo(1, 6);
  expect(bed.d).toBeCloseTo(2.1, 6);
  expect(bed.rotation).toBe(0); // never 90 or 270
  expectNear(bed.at, { x: 0.6, y: 2.7 }); // back edge on the head wall's face, left side in the corner

  await page.keyboard.press("v");
  await pickCard(page, "bed");
  await expect(picker).toHaveValue("Single 100 × 210");
});

/** Local mode: a 6 × 4 room (inner faces 0.1 and 5.9 / 3.9), labelled, as smart.spec.ts does. */
async function labelledRoom(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.goto("/?name=Alice&server=off");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 6, 4);
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 0.6, y: 0.6 });
}

async function placeTile(page: Page, kind: string, at: WorldPoint): Promise<void> {
  await pickCard(page, kind);
  await clickAt(page, canvasOf(page), at);
}

async function select(page: Page, at: WorldPoint): Promise<void> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), at);
}

test("the Kind field switches a wardrobe to a chest of drawers in one undo step, keeping its size, and resets its zones in every layout; a sofa bed's Kind is read-only (AC-06)", async ({ page }) => {
  await labelledRoom(page);
  const kind = page.locator('select[data-field-id="kind"]');
  const front = page.locator('[data-field-id="sides.front"]');
  const wardrobe = { x: 3, y: 3.6 };
  await placeTile(page, "wardrobe", { x: 3, y: 3.58 }); // its back flushes to the top face: x 2.4–3.6, y 3.3–3.9
  await page.getByTestId("state-name").fill("Day");
  await page.getByTestId("state-name").press("Enter");
  await select(page, wardrobe);

  await expect(kind).toHaveValue("wardrobe");
  await expect(kind.locator('option[value="drawers"]')).toHaveCount(1);
  for (const other of ["sofaBed", "murphyBed", "foldingTable", "extendingTable", "builtInTable", "kitchenBlock", "bathroomBlock"]) {
    await expect(kind.locator(`option[value="${other}"]`)).toHaveCount(0); // two configurations, or retired (furnish.13)
  }
  await expect(kind.locator('option[value="toilet"]')).toHaveCount(1); // any single-configuration kind (furnish.17)
  await front.click();
  await expect(front).toHaveAttribute("aria-checked", "false");

  await page.getByTestId("state-add").click(); // the copy is active, and the selection cleared
  await select(page, wardrobe);
  await expect(front).toHaveAttribute("aria-checked", "false");

  await kind.selectOption("drawers");
  await expect(kind).toHaveValue("drawers");
  await expect(page.locator('[data-field-id="name"]')).toHaveValue("Chest of drawers");
  await expect(page.locator('[data-field-id="width"]')).toHaveValue("1.20");
  await expect(page.locator('[data-field-id="depth"]')).toHaveValue("0.60");
  await expect(front).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await select(page, wardrobe);
  await expect(kind).toHaveValue("drawers"); // the reset reached the other layout
  await expect(front).toHaveAttribute("aria-checked", "true");

  await page.keyboard.press("Control+z"); // one step undoes the switch in both layouts
  await expect(kind).toHaveValue("wardrobe");
  await expect(front).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-field-id="width"]')).toHaveValue("1.20");

  await placeTile(page, "sofaBed", { x: 3, y: 1.5 });
  await select(page, { x: 3, y: 1.5 });
  await expect(page.locator('[data-field-id="kind"]')).toHaveValue("Sofa bed");
  await expect(kind).toHaveCount(0);
});

/** Moves the pointer clear of every probe, so hover, snap marks and presence cursors stay off them. */
async function park(page: Page): Promise<void> {
  const box = await canvasOf(page).boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  await page.mouse.move(box.x + 600, box.y + 500);
}

/** Waits for the import to reach the server: a row whose pictureId differs from `previous`. */
async function landed(project: string, previous: string | null = null): Promise<StoredUnderlay> {
  await expect.poll(async () => (await storedUnderlay(project))?.pictureId ?? null, { timeout: 15_000 }).not.toBe(previous);
  const row = await storedUnderlay(project);
  if (row === null) throw new Error("no underlay row");
  return row;
}

/** The middle of the 0.5 m grid cell holding `c`: keeps a framed probe off the grid lines. */
const midCell = (c: number): number => Math.floor(c / 0.5) * 0.5 + 0.25;

test("an imported picture that doesn't fit frames itself in the importing browser; one that fits leaves the view; Bob's view never moves (AC-09)", async ({ browser }) => {
  const project = newProject();
  const alice = await openAs(browser, "Alice", project);
  const bob = await openAs(browser, "Bob", project);
  const canvas = canvasOf(alice);
  const tl = await viewTopLeft(canvas); // (−1.25, 6.5) on the 680 × 720 canvas
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  const BIG: PictureSpec = { kind: "quadrants", name: "big-plan.png", width: 2000, height: 1500, colours: QUADRANTS, type: "image/png" };
  // frameBox: the 20 × 15 m picture centred, 48 px clear on its tighter axis: zoom 29.2, centre (8.75, −1).
  const framed: View = {
    center: { x: tl.x + 10, y: tl.y - 7.5 },
    zoom: Math.min((box.width - 2 * FRAME_MARGIN_PX) / 20, (box.height - 2 * FRAME_MARGIN_PX) / 15),
  };
  await expect(alice.getByTestId("grid-step")).toHaveText("0.20 m");
  await expect(bob.getByTestId("grid-step")).toHaveText("0.20 m");

  // A is 480 × 704 px, 384 × 563 on screen: it fits, and the camera stays.
  await dropPicture(alice, PICTURE_A);
  const a = await landed(project);
  await waitSaved(alice);
  await park(alice);
  await park(bob);
  await expect(alice.getByTestId("grid-step")).toHaveText("0.20 m");
  await expectPixel(alice, canvas, offGrid(onPicture(tl, MPP, 120, 176)), faded(TL));
  await expectPixel(alice, canvas, offGrid(onPicture(tl, MPP, 360, 176)), faded(TR));
  const bobProbe = offGrid(onPicture(tl, MPP, 300, 300)); // in A's TR quadrant, in BIG's TL
  await expectPixel(bob, canvasOf(bob), bobProbe, faded(TR));

  await dropPicture(alice, BIG);
  const big = await landed(project, a.pictureId);
  await waitSaved(alice);
  expect(big).toMatchObject({ width: 2000, height: 1500, metresPerPixel: MPP });
  expect(big.at.x).toBeCloseTo(tl.x, 6); // still lands at the view's top-left
  expect(big.at.y).toBeCloseTo(tl.y, 6);

  await park(alice);
  await park(bob);
  await expect(alice.getByTestId("grid-step")).toHaveText("1.00 m"); // 1 m for any zoom in [16, 32)
  const corners: [number, number, string][] = [[60, 60, TL], [1940, 60, TR], [60, 1440, BL], [1940, 1440, BR]];
  for (const [u, v, hex] of corners) {
    const p = onPicture(tl, MPP, u, v);
    await expectPixel(alice, canvas, { x: midCell(p.x), y: midCell(p.y) }, faded(hex), 12, framed);
  }

  // Bob sees the new picture through his own unmoved camera, at the spot where A showed TR.
  await expect(bob.getByTestId("grid-step")).toHaveText("0.20 m");
  await expectPixel(bob, canvasOf(bob), bobProbe, faded(TL));
});
