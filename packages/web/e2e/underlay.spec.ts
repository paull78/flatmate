import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openSection } from "./support/sections";
import { COLORS } from "@fm/editor";
import { MAX_UNDERLAY_DATA_CHARS, UNDERLAY_LONG_SIDE } from "@fm/protocol";
import { dragFromTo, toScreen, ZOOM, type WorldPoint } from "./support/canvas";
import { openProject, waitSaved } from "./support/app-driver";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { deleteProjects, storedDocument, storedUnderlay, type StoredUnderlay } from "./support/stored";
import {
  PICTURE_A,
  PICTURE_B,
  QUADRANTS,
  choosePicture,
  dropPicture,
  faded,
  offGrid,
  onPicture,
  viewTopLeft,
  type PictureSpec,
} from "./support/underlay";
import { SERVER } from "./support/server";
import { expectNoToast } from "./support/toasts";
import { pickCard } from "./support/palette";

// The plan underlay in the browser (spec AC-01 to AC-06, AC-13; import.06, .11, .13, .15): a picture dropped or
// chosen lands top-left at the view, unscaled, under the walls and the grid, on every browser; Scale, replace and
// Remove are shared undoable edits, fade and show/hide stay this viewer's own. Canvas2D, the default renderer. The
// stored row is read from the server. These pixel probes check the y flip and the stretch end to end.

const [TL, TR, BL, BR] = QUADRANTS;
const MPP = 0.01; // the provisional scale a new picture lands at
const BACKGROUND = COLORS.background;

const canvasOf = (page: Page) => page.getByTestId("canvas");
const section = (page: Page) => page.getByTestId("underlay-section");
const button = (page: Page, name: string) => section(page).getByRole("button", { name, exact: true });

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
  const name = `zz-underlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(name);
  return name;
}

/** Moves the pointer clear of every probe, so hover, snap marks and presence cursors stay off them. */
async function park(page: Page): Promise<void> {
  const box = await canvasOf(page).boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  await page.mouse.move(box.x + 600, box.y + 500);
}

async function probe(page: Page, p: WorldPoint, hex: string): Promise<void> {
  await expectPixel(page, canvasOf(page), offGrid(p), hex);
}

/** Clicks the whole page pixel nearest `p` and returns its world point, the point the editor gets. */
async function clickPixel(page: Page, p: WorldPoint): Promise<WorldPoint> {
  const canvas = canvasOf(page);
  const s = await toScreen(canvas, p);
  const px = { x: Math.round(s.x), y: Math.round(s.y) };
  await page.mouse.move(px.x, px.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  const centre = await toScreen(canvas, { x: 0, y: 0 });
  return { x: (px.x - centre.x) / ZOOM, y: -(px.y - centre.y) / ZOOM };
}

/** Waits for the import to reach the server: a row whose pictureId differs from `previous`. */
async function landed(project: string, previous: string | null = null): Promise<StoredUnderlay> {
  await expect.poll(async () => (await storedUnderlay(project))?.pictureId ?? null, { timeout: 15_000 }).not.toBe(previous);
  const row = await storedUnderlay(project);
  if (row === null) throw new Error("no underlay row");
  return row;
}

/** A chain of walls through `points`, drawn with the Wall tool; each segment is saved before the next click. */
async function drawWalls(page: Page, project: string, points: WorldPoint[]): Promise<void> {
  const count = async () => Object.keys((await storedDocument(project)).walls).length;
  const start = await count();
  await page.keyboard.press("w");
  for (const [i, p] of points.entries()) {
    await clickPixel(page, p);
    if (i > 0) await expect.poll(count).toBe(start + i);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitSaved(page);
}

/** The stored ends of the lowest wall (least mean y). */
async function lowestWall(project: string): Promise<[WorldPoint, WorldPoint]> {
  const doc = await storedDocument(project);
  const point = (id: unknown): WorldPoint => {
    const j = typeof id === "string" ? doc.joints[id] : undefined;
    if (j === undefined || typeof j.x !== "number" || typeof j.y !== "number") throw new Error("no joint");
    return { x: j.x, y: j.y };
  };
  const ends = Object.values(doc.walls).map((w): [WorldPoint, WorldPoint] => [point(w.a), point(w.b)]);
  ends.sort(([a, b], [c, d]) => a.y + b.y - (c.y + d.y));
  const [lowest] = ends;
  if (lowest === undefined) throw new Error("no wall");
  return lowest;
}

/** Picture A's colour at its pixel (u, v): A is 480 × 704. */
function quadrantOf(u: number, v: number): string {
  if (v < 352) return u < 240 ? TL : TR;
  return u < 240 ? BL : BR;
}

type Scaled = { tl: WorldPoint; a: WorldPoint; after: StoredUnderlay };

/**
 * Drops A and scales it: Scale, a = A px (120, 352) on the TL/BL split, b = A px (440, 592), 400 px away, then 5 m.
 * The probes pair a point that must hold (either side of a) with points that must change.
 */
async function dropAndScale(page: Page, project: string): Promise<Scaled> {
  const tl = await viewTopLeft(canvasOf(page));
  await dropPicture(page, PICTURE_A);
  await landed(project);
  await waitSaved(page);
  await park(page);
  const aAt = onPicture(tl, MPP, 120, 352);
  await probe(page, { x: aAt.x, y: aAt.y + 0.3 }, faded(TL));
  await probe(page, { x: aAt.x, y: aAt.y - 0.3 }, faded(BL));
  await probe(page, { x: tl.x + 2.55, y: aAt.y + 0.6 }, faded(TR));
  await probe(page, { x: tl.x + 5.25, y: aAt.y - 1.5 }, BACKGROUND);

  await openSection(section(page));
  await button(page, "Scale").click();
  const a = await clickPixel(page, aAt);
  await clickPixel(page, onPicture(tl, MPP, 440, 592));
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await storedUnderlay(project))?.scaled).toBe(true);
  await waitSaved(page);
  const after = await storedUnderlay(project);
  if (after === null) throw new Error("no underlay row");

  await park(page);
  await probe(page, { x: a.x, y: a.y + 0.3 }, faded(TL)); // the first point stayed put
  await probe(page, { x: a.x, y: a.y - 0.3 }, faded(BL));
  await probe(page, { x: tl.x + 2.55, y: a.y + 0.6 }, faded(TL)); // the split moved from tl.x + 2.4 to + 2.7
  await probe(page, { x: tl.x + 5.25, y: a.y - 1.5 }, faded(BR)); // the right edge moved from 4.8 to 5.7
  await probe(page, { x: tl.x + 5.9, y: a.y - 1.5 }, BACKGROUND);
  return { tl, a, after };
}

test("Choose picture… places A top-left at the view, unscaled, and a second browser sees it; fade and show/hide are the viewer's own and Undo leaves them alone (AC-01, AC-05)", async ({ browser }) => {
  const project = newProject();
  const alice = await openAs(browser, "Alice", project);
  await openSection(section(alice)); // closed until opened (inherit step 06)
  await expect(button(alice, "Scale")).toBeDisabled();
  await expect(button(alice, "Remove")).toBeDisabled();

  const tl = await viewTopLeft(canvasOf(alice));
  await choosePicture(alice, PICTURE_A);
  const row = await landed(project);
  await waitSaved(alice);
  expect(row).toMatchObject({ mime: "image/jpeg", width: 480, height: 704, metresPerPixel: MPP, scaled: false });
  expect(row.at.x).toBeCloseTo(tl.x, 6);
  expect(row.at.y).toBeCloseTo(tl.y, 6);
  expect(Object.keys((await storedDocument(project)).underlays)).toHaveLength(1);

  const centres: [number, number, string][] = [[120, 176, TL], [360, 176, TR], [120, 528, BL], [360, 528, BR]];
  await park(alice);
  for (const [u, v, hex] of centres) await probe(alice, onPicture(tl, MPP, u, v), faded(hex));
  // The edges pin 0.01 m/px: another scale moves an edge across one of these.
  await probe(alice, { x: tl.x + 4.6, y: tl.y - 5.28 }, faded(BR));
  await probe(alice, { x: tl.x + 5.0, y: tl.y - 5.28 }, BACKGROUND);
  await probe(alice, { x: tl.x + 1.2, y: tl.y - 6.84 }, faded(BL));
  await probe(alice, { x: tl.x + 1.2, y: tl.y - 7.24 }, BACKGROUND);
  // A minor grid line through TL draws over the picture: picture on top, it would read faded TL.
  const k = Math.round((tl.x + 1.2) / 0.2);
  const onGrid = { x: (k % 5 === 0 ? k + 1 : k) * 0.2, y: offGrid({ x: 0, y: tl.y - 1.76 }).y };
  await expect
    .poll(async () => distance(await pixelAt(alice, canvasOf(alice), onGrid), faded(TL)), { message: "the grid draws over the picture" })
    .toBeGreaterThan(40);

  const bob = await openAs(browser, "Bob", project);
  await park(bob);
  for (const [u, v, hex] of centres) await probe(bob, onPicture(tl, MPP, u, v), faded(hex));

  const tlProbe = onPicture(tl, MPP, 120, 176);
  const before = await storedDocument(project);
  await section(alice).getByRole("slider", { name: "Fade" }).fill("0"); // fade 0 is full strength
  await probe(alice, tlProbe, TL);
  await probe(bob, tlProbe, faded(TL));
  expect(await storedDocument(project)).toEqual(before);

  await button(alice, "Hide").click();
  await probe(alice, tlProbe, BACKGROUND);
  await probe(bob, tlProbe, faded(TL));

  await alice.locator('[data-action="undo"]').click(); // undoes the placement, not the fade or the hide
  await expect.poll(() => storedUnderlay(project)).toBeNull();
  await waitSaved(alice);
  await probe(bob, tlProbe, BACKGROUND);
  await alice.locator('[data-action="redo"]').click();
  await waitSaved(alice);
  await probe(bob, tlProbe, faded(TL));

  await probe(alice, tlProbe, BACKGROUND); // still hidden
  await button(alice, "Show").click();
  await probe(alice, tlProbe, TL); // still full strength
});

test("Scale: two clicks 400 picture pixels apart and a typed 5 give 0.0125 m per pixel about the first point; walls stay; Undo restores (AC-03)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const tl = await viewTopLeft(canvasOf(page));
  await drawWalls(page, project, [{ x: tl.x + 6.5, y: tl.y - 2 }, { x: tl.x + 6.5, y: tl.y - 5 }]);
  const { joints, walls } = await storedDocument(project);
  expect(Object.keys(walls)).toHaveLength(1);

  const { a, after } = await dropAndScale(page, project);
  expect(after.metresPerPixel).toBeCloseTo(0.0125, 9);
  expect(after.scaled).toBe(true);
  expect(after.at.x).toBeCloseTo(a.x + (tl.x - a.x) * 1.25, 6);
  expect(after.at.y).toBeCloseTo(a.y + (tl.y - a.y) * 1.25, 6);
  const doc = await storedDocument(project);
  expect(doc.joints).toEqual(joints);
  expect(doc.walls).toEqual(walls);

  await page.locator('[data-action="undo"]').click();
  await expect.poll(async () => (await storedUnderlay(project))?.scaled).toBe(false);
  await waitSaved(page);
  const undone = await storedUnderlay(project);
  expect(undone?.metresPerPixel).toBe(MPP);
  expect(undone?.at.x).toBeCloseTo(tl.x, 6);
  expect(undone?.at.y).toBeCloseTo(tl.y, 6);
  await park(page);
  await probe(page, { x: tl.x + 2.55, y: a.y + 0.6 }, faded(TR));
  await probe(page, { x: tl.x + 5.25, y: a.y - 1.5 }, BACKGROUND);
});

test("a dropped picture replaces the scaled one fresh in one undo step; Remove and Undo bring it back with its scale (AC-06)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const { tl, a, after: scaled } = await dropAndScale(page, project);

  await dropPicture(page, PICTURE_B);
  const b = await landed(project, scaled.pictureId);
  await waitSaved(page);
  expect(Object.keys((await storedDocument(project)).underlays)).toHaveLength(1);
  expect(b).toMatchObject({ width: 320, height: 256, metresPerPixel: MPP, scaled: false });
  expect(b.at.x).toBeCloseTo(tl.x, 6);
  expect(b.at.y).toBeCloseTo(tl.y, 6);
  const bProbe = onPicture(tl, MPP, 160, 200);
  const brProbe = { x: tl.x + 5.25, y: a.y - 1.5 };
  await park(page);
  await probe(page, bProbe, faded("#ff0000"));
  await probe(page, { x: tl.x + 1.6, y: tl.y - 2.76 }, BACKGROUND); // just below B, where the scaled A showed TL
  await probe(page, brProbe, BACKGROUND);

  await page.locator('[data-action="undo"]').click(); // one step back to the scaled A
  await expect.poll(async () => (await storedUnderlay(project))?.pictureId).toBe(scaled.pictureId);
  await waitSaved(page);
  expect(await storedUnderlay(project)).toMatchObject({ metresPerPixel: scaled.metresPerPixel, scaled: true });
  await probe(page, bProbe, faded(TL));
  await probe(page, brProbe, faded(BR));

  await openSection(section(page));
  await button(page, "Remove").click();
  await expect.poll(async () => Object.keys((await storedDocument(project)).underlays).length).toBe(0);
  await waitSaved(page);
  for (const p of [bProbe, brProbe, { x: a.x, y: a.y + 0.3 }, { x: a.x, y: a.y - 0.3 }]) await probe(page, p, BACKGROUND);
  await expect(button(page, "Scale")).toBeDisabled();
  await expect(button(page, "Remove")).toBeDisabled();

  await page.locator('[data-action="undo"]').click();
  await expect.poll(async () => (await storedUnderlay(project))?.pictureId).toBe(scaled.pictureId);
  await waitSaved(page);
  expect((await storedUnderlay(project))?.metresPerPixel).toBeCloseTo(0.0125, 9);
  await probe(page, { x: a.x, y: a.y + 0.3 }, faded(TL));
  await probe(page, { x: a.x, y: a.y - 0.3 }, faded(BL));
});

test("a click, a box and Delete over the underlay act on the drawing only (AC-04, and AC-01's beneath the walls)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const tl = await viewTopLeft(canvasOf(page));
  await dropPicture(page, PICTURE_A);
  const row = await landed(project);
  await waitSaved(page);
  // A 3.6 × 2 m room over the picture's lower half; a box selects furniture only, so a desk goes in it.
  const corner = (dx: number, dy: number) => ({ x: tl.x + dx, y: tl.y + dy });
  await drawWalls(page, project, [corner(0.6, -6.4), corner(4.2, -6.4), corner(4.2, -4.4), corner(0.6, -4.4), corner(0.6, -6.4)]);
  await pickCard(page, "desk");
  await clickPixel(page, corner(2.4, -5.4));
  await expect.poll(async () => Object.keys((await storedDocument(project)).placements).length).toBe(1);
  await waitSaved(page);

  // A point on the bottom wall a sixth of the way along, over BL: its midpoint would sit on the BL/BR split.
  const [ja, jb] = await lowestWall(project);
  const onWall = { x: ja.x + (jb.x - ja.x) / 6, y: ja.y + (jb.y - ja.y) / 6 };
  const under = quadrantOf((onWall.x - row.at.x) / MPP, (row.at.y - onWall.y) / MPP);
  const mid = { x: (ja.x + jb.x) / 2, y: (ja.y + jb.y) / 2 };
  await park(page);
  await probe(page, onWall, COLORS.wall); // the wall draws over the picture

  await page.keyboard.press("v");
  const length = page.locator('[data-field-id="length"]');
  const kind = page.locator('[data-field-id="kind"]');
  await clickPixel(page, mid);
  await expect(length).toBeVisible();
  await clickPixel(page, onPicture(tl, MPP, 120, 176)); // the picture is never selected: this clears the selection
  await expect(length).toBeHidden();
  await openSection(section(page));
  await expect(button(page, "Remove")).toBeEnabled();

  await dragFromTo(page, canvasOf(page), corner(1.0, -4.7), corner(3.8, -6.1)); // from the room's floor, around the desk
  await expect(kind).toHaveValue("desk");
  await page.keyboard.press("Delete");
  await expect.poll(async () => Object.keys((await storedDocument(project)).placements).length).toBe(0);
  await waitSaved(page);
  expect(Object.keys((await storedDocument(project)).walls)).toHaveLength(4);
  expect((await storedUnderlay(project))?.pictureId).toBe(row.pictureId);

  await clickPixel(page, mid);
  await expect(length).toBeVisible();
  await page.keyboard.press("Delete");
  await expect.poll(async () => Object.keys((await storedDocument(project)).walls).length).toBe(3);
  await waitSaved(page);
  expect((await storedUnderlay(project))?.pictureId).toBe(row.pictureId);
  await park(page);
  await probe(page, onWall, faded(under));

  await page.keyboard.press("Delete"); // nothing selected: nothing to delete, the picture included
  // Had that Delete removed the picture, Undo would bring the picture back, not the wall.
  await page.locator('[data-action="undo"]').click();
  await expect.poll(async () => Object.keys((await storedDocument(project)).walls).length).toBe(4);
  await waitSaved(page);
  expect((await storedUnderlay(project))?.pictureId).toBe(row.pictureId);
});

test("a PDF, a text file or a broken PNG is refused with a toast naming the supported types; the drawing and the other browser are unchanged (AC-13)", async ({ browser }) => {
  test.setTimeout(60_000); // three 6 s toasts waited out take 20 s alone, of the default 30
  const project = newProject();
  const alice = await openAs(browser, "Alice", project);
  const tl = await viewTopLeft(canvasOf(alice));
  await dropPicture(alice, PICTURE_A);
  await landed(project);
  await waitSaved(alice);
  const bob = await openAs(browser, "Bob", project);
  const snapshot = await storedDocument(project);
  const tlProbe = onPicture(tl, MPP, 120, 176);
  await park(alice);
  await park(bob);

  const inputs: [string, (spec: PictureSpec) => Promise<void>, PictureSpec][] = [
    ["drop", (s) => dropPicture(alice, s), { kind: "bytes", name: "plan.pdf", type: "application/pdf", text: "%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n" }],
    ["choose", (s) => choosePicture(alice, s), { kind: "bytes", name: "notes.txt", type: "text/plain", text: "Kitchen 3.2 x 2.8\n" }],
    ["drop", (s) => dropPicture(alice, s), { kind: "bytes", name: "broken.png", type: "image/png", randomBytes: 4096 }],
  ];
  for (const [, give, spec] of inputs) {
    await give(spec);
    const toast = alice.locator(".toast");
    for (const type of ["PNG", "JPEG", "WebP", "GIF"]) await expect(toast).toContainText(type);
    expect(await storedDocument(project)).toEqual(snapshot);
    await park(alice);
    await probe(alice, tlProbe, faded(TL));
    await probe(bob, tlProbe, faded(TL));
    await expectNoToast(bob); // read once: a retrying count of 0 would wait out a toast (levels.55)
    await expect(toast).toHaveCount(0, { timeout: 8_000 }); // gone before the next input (6 s, clarity.16), so each one has to raise its own
  }
});

test("a 4000×3000 picture is stored at most 2000 px long within the cap; a noisy one comes in under the cap or is refused with the toast, never a too-large submit (AC-02)", async ({ browser }) => {
  test.setTimeout(90_000);
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  await dropPicture(page, { kind: "quadrants", name: "big.png", width: 4000, height: 3000, colours: QUADRANTS, type: "image/png" });
  const plain = await landed(project);
  await waitSaved(page);
  expect(plain).toMatchObject({ width: 2000, height: 1500, mime: "image/jpeg" });
  expect(plain.data.startsWith("/9j/")).toBe(true);
  expect(plain.data.length).toBeLessThanOrEqual(MAX_UNDERLAY_DATA_CHARS);

  // Seeded noise, the worst case for JPEG. Chromium stores it only after the budget has shrunk it below the long-side
  // cap, so this half proves the adapter runs the retries; a refusal here means the encoder changed: re-measure.
  const started = Date.now();
  await dropPicture(page, { kind: "noise", name: "noise.jpg", width: 4000, height: 3000, seed: 1, type: "image/jpeg", quality: 0.95 });
  const toasts = page.locator(".toast");
  await expect
    .poll(async () => (await toasts.count()) > 0 || (await storedUnderlay(project))?.pictureId !== plain.pictureId, { timeout: 60_000 })
    .toBe(true);
  expect(await toasts.filter({ hasText: "The change is too large" }).allTextContents(), "no too-large toast").toEqual([]); // read once (levels.55)
  const row = await storedUnderlay(project);
  const ms = Date.now() - started;
  if (row === null || row.pictureId === plain.pictureId) {
    for (const type of ["PNG", "JPEG", "WebP", "GIF"]) await expect(toasts).toContainText(type);
    expect(row?.pictureId).toBe(plain.pictureId);
    throw new Error(`the noisy picture was refused after ${ms} ms; Chromium stored it at 1600×1200 when measured: re-measure`);
  }
  expect(Math.max(row.width, row.height)).toBeGreaterThanOrEqual(1000);
  expect(Math.max(row.width, row.height)).toBeLessThan(UNDERLAY_LONG_SIDE); // at least one shrink ran
  expect(Math.abs(row.width / row.height - 4 / 3)).toBeLessThan(0.01);
  expect(row.data.length).toBeLessThanOrEqual(MAX_UNDERLAY_DATA_CHARS);
  await waitSaved(page);
  test.info().annotations.push({ type: "noisy", description: `stored ${row.width}×${row.height}, ${row.data.length} chars, ${ms} ms` });
});

