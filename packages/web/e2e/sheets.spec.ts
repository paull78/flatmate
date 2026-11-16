import { execFile } from "node:child_process";
import { openSection } from "./support/sections";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { clickAt, drawRectRoom } from "./support/canvas";
import { openProject, waitSaved } from "./support/app-driver";
import { SERVER } from "./support/server";
import { deleteProjects, storedDocument } from "./support/stored";
import { makeFileInPage, type PictureSpec } from "./support/underlay";

// The sheet list by hand (sheetset.13, .14; AC-03, AC-12): focus, the menu and native drag, which web tests can't reach
// without a DOM (layout-states.38). No server: a local drawing, whose list is in memory.

const ROW = '[data-testid="sheet-row"]';

async function openList(page: Page, layouts = 3): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 5, 4);
  for (let i = 1; i < layouts; i++) await page.getByTestId("state-add").click();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(layouts);
}
const rowIds = (page: Page) => page.getByTestId("sheet-row").evaluateAll((rows) => rows.map((r) => (r instanceof HTMLElement ? (r.dataset["sheetRow"] ?? "") : "")));
const row = (page: Page, id: string) => page.locator(`${ROW}[data-sheet-row="${id}"]`);
const FIRST = "auto/0";
const SECOND = "auto/1";
const THIRD = "auto/2";

/** A real drag along a path, ending `part` of the way down a row, as a hand does. */
async function dragRow(page: Page, from: string, to: string, part: number): Promise<void> {
  const a = await row(page, from).boundingBox();
  const b = await row(page, to).boundingBox();
  if (!a || !b) throw new Error("no row");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 3 });
  const end = { x: b.x + b.width / 2, y: b.y + b.height * part };
  await page.mouse.move(end.x, end.y, { steps: 8 });
  // A browser repeats dragover while a hand rests; Playwright sends one per move, and an early one can be all that lands.
  for (let i = 1; i <= 3; i++) {
    await page.waitForTimeout(50);
    await page.mouse.move(end.x + i, end.y);
  }
}

test("arrows move focus, and Alt + arrows move the sheet and keep the focus on it", async ({ page }) => {
  await openList(page);
  await row(page, FIRST).focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, SECOND)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, THIRD)).toBeFocused();
  await page.keyboard.press("ArrowDown"); // the end
  await expect(row(page, THIRD)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(row(page, SECOND)).toBeFocused();
  expect(await rowIds(page)).toEqual([FIRST, SECOND, THIRD]); // focus alone moves nothing

  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => rowIds(page)).toEqual([SECOND, FIRST, THIRD]);
  await expect(row(page, SECOND)).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => rowIds(page)).toEqual([FIRST, THIRD, SECOND]);
  await expect(row(page, SECOND)).toBeFocused();

  // Enter selects; ⌘Z, from the row, undoes one move at a time.
  await page.keyboard.press("Enter");
  await expect(row(page, SECOND)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => rowIds(page)).toEqual([FIRST, SECOND, THIRD]);
});

test("Delete on a row deletes the sheet, stays in the list, and never reaches the plan", async ({ page }) => {
  await openList(page);
  await row(page, SECOND).click();
  await row(page, SECOND).focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => rowIds(page)).toEqual([FIRST, THIRD]);
  await expect(row(page, THIRD)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, THIRD)).toBeFocused();
  await expect(page.getByTestId("sheets-view")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => rowIds(page)).toEqual([FIRST, SECOND, THIRD]);
  // The walls are all there: undo above took the sheet back, and the plan's Delete did nothing.
  await page.getByTestId("sheets-close").click();
  await expect(page.getByTestId("export-button")).toBeEnabled();
});

test("the last sheet stays, saying why", async ({ page }) => {
  await openList(page, 1);
  await row(page, FIRST).focus();
  await page.keyboard.press("Delete");
  await expect(page.getByText("A project keeps at least one sheet")).toBeVisible();
  expect(await rowIds(page)).toEqual([FIRST]);
});

test("the menu opens on its first item, goes round, and closes on Esc, returning focus", async ({ page }) => {
  await openList(page, 2);
  const add = page.getByTestId("sheets-add");
  const menu = page.getByTestId("sheets-add-menu");
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(add).toHaveAttribute("aria-expanded", "true");
  const item = (kind: string) => menu.locator(`[data-kind="${kind}"]`);
  await expect(item("plan")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("compare")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(item("report")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.getByTestId("sheets-view")).toBeVisible(); // Escape shut the menu, not the view

  // A press elsewhere shuts it too, and Escape from the view then leaves.
  await add.click();
  await expect(menu).toBeVisible();
  await page.getByTestId("sheets-desk").click({ position: { x: 4, y: 4 } });
  await expect(menu).toBeHidden();
});

test("with one layout, Compare is off and the arrows skip it", async ({ page }) => {
  await openList(page, 1);
  await page.getByTestId("sheets-add").click();
  const menu = page.getByTestId("sheets-add-menu");
  await expect(menu.locator('[data-kind="compare"]')).toBeDisabled();
  await expect(menu.locator('[data-kind="plan"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator('[data-kind="cover"]')).toBeFocused();
});

test("adding from the menu puts the new sheet after the selected one, focused and selected", async ({ page }) => {
  await openList(page, 3);
  await row(page, FIRST).click();
  await page.getByTestId("sheets-add").click();
  await page.getByTestId("sheets-add-menu").locator('[data-kind="report"]').click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(4);
  const second = page.getByTestId("sheet-row").nth(1);
  await expect(second).toContainText("Project report");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(second).toBeFocused();
  await page.locator('[data-action="sheets-undo"]').click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  await expect(row(page, FIRST)).toHaveAttribute("aria-selected", "true");
});

test("a drag reorders, shows its line, and undoes in one step", async ({ page }) => {
  await openList(page);
  await dragRow(page, FIRST, THIRD, 0.8);
  await expect(row(page, THIRD)).toHaveClass(/drop-after/);
  await expect(row(page, FIRST)).toHaveClass(/dragging/);
  await page.mouse.up();
  await expect.poll(() => rowIds(page)).toEqual([SECOND, THIRD, FIRST]);
  await expect(row(page, THIRD)).not.toHaveClass(/drop-after/);
  await expect(row(page, FIRST)).not.toHaveClass(/dragging/);
  await expect(row(page, FIRST)).toHaveAttribute("aria-selected", "true"); // what's dragged is what's in hand

  await dragRow(page, FIRST, SECOND, 0.2); // onto a row's upper half: before it
  await expect(row(page, SECOND)).toHaveClass(/drop-before/);
  await page.mouse.up();
  await expect.poll(() => rowIds(page)).toEqual([FIRST, SECOND, THIRD]);

  await page.locator('[data-action="sheets-undo"]').click();
  await expect.poll(() => rowIds(page)).toEqual([SECOND, THIRD, FIRST]);
  await page.locator('[data-action="sheets-undo"]').click();
  await expect.poll(() => rowIds(page)).toEqual([FIRST, SECOND, THIRD]);
  await page.locator('[data-action="sheets-redo"]').click();
  await expect.poll(() => rowIds(page)).toEqual([SECOND, THIRD, FIRST]);
});

test("a drag let go off the list moves nothing", async ({ page }) => {
  await openList(page);
  await dragRow(page, FIRST, THIRD, 0.8);
  await page.mouse.move(800, 300, { steps: 6 });
  await page.mouse.up();
  expect(await rowIds(page)).toEqual([FIRST, SECOND, THIRD]);
  await expect(page.locator('[data-action="sheets-undo"]')).toBeEnabled(); // the walls' own undo: nothing about the list to prove here
  await expect(row(page, FIRST)).not.toHaveClass(/dragging/);
});

test("the checkbox ticks without selecting, numbers follow, and the page leaves the desk", async ({ page }) => {
  await openList(page);
  await row(page, SECOND).click();
  await expect(row(page, SECOND)).toContainText("02");
  await row(page, FIRST).getByRole("checkbox").click();
  await expect(row(page, FIRST)).toContainText("Not in PDF");
  await expect(row(page, SECOND)).toContainText("01");
  await expect(row(page, THIRD)).toContainText("02");
  await expect(row(page, SECOND)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-sheet-id="auto/0"]')).toHaveCount(0);
  await row(page, FIRST).getByRole("checkbox").click();
  await expect(page.locator('[data-sheet-id="auto/0"]')).toHaveCount(1);
  await expect(row(page, SECOND)).toContainText("02");
});

test("None leaves Save PDF off, and All brings it back", async ({ page }) => {
  await openList(page);
  await expect(page.getByTestId("sheets-all-none")).toHaveText("None");
  await page.getByTestId("sheets-all-none").click();
  await expect(page.getByTestId("sheets-save-pdf")).toBeDisabled();
  await expect(page.getByTestId("sheets-list")).toContainText("0 of 3 in PDF");
  await expect(page.getByTestId("sheets-all-none")).toHaveText("All");
  await page.getByTestId("sheets-all-none").click();
  await expect(page.getByTestId("sheets-save-pdf")).toBeEnabled();
});

test("a row selects and scrolls to its page; a page selects its row and keeps its place; the ring shows which", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await openList(page, 4);
  const desk = page.getByTestId("sheets-desk");
  const top = () => desk.evaluate((d) => d.scrollTop);
  expect(await top()).toBe(0);
  await row(page, "auto/3").click();
  await expect(row(page, "auto/3")).toHaveAttribute("aria-selected", "true");
  await expect.poll(top).toBeGreaterThan(0);
  await expect(page.locator('[data-sheet-id="auto/3"]')).toBeInViewport({ ratio: 0.9 });
  await expect(page.locator('[data-sheet-id="auto/3"]')).toHaveClass(/picked/);
  await expect(page.locator('[data-sheet-id="auto/0"]')).not.toHaveClass(/picked/);

  // A page partly in view, clicked, doesn't jump.
  const before = await top();
  const partly = await page.locator('[data-sheet-id="auto/2"]').getByTestId("sheet-canvas").boundingBox();
  if (!partly) throw new Error("no page");
  await page.mouse.click(partly.x + 40, partly.y + partly.height - 20); // by hand: Playwright's own click would scroll to it
  await expect(row(page, "auto/2")).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(100);
  expect(await top()).toBe(before);
  await expect(page.locator('[data-sheet-id="auto/2"]')).toHaveClass(/picked/);
});

test("the desk opens fitted to its width on every paper, and 100% and the steps stay offered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openList(page, 1);
  const paper = page.getByTestId("sheets-paper");
  const desk = page.getByTestId("sheets-desk");
  for (const size of ["A3", "A2", "A1", "Letter", "A4"]) {
    await paper.selectOption(size);
    await expect.poll(() => desk.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
    const fills = await desk.evaluate((d) => d.clientWidth - 40);
    await expect.poll(async () => (await page.getByTestId("sheet-canvas").boundingBox())?.width).toBe(fills);
  }
  await paper.selectOption("A3");
  await expect(page.getByTestId("sheets-zoom")).toHaveText(/^9\d%$/); // not 100%: that scrolls sideways on A3 at 1440
  await page.getByTestId("sheets-zoom-in").click();
  await expect(page.getByTestId("sheets-zoom")).toHaveText("100%");
  await expect.poll(async () => (await page.getByTestId("sheet-canvas").boundingBox())?.width).toBe(840);
  await page.getByTestId("sheets-zoom-in").click();
  await expect(page.getByTestId("sheets-zoom")).toHaveText("125%");
  await page.getByTestId("sheets-zoom-out").click();
  await expect(page.getByTestId("sheets-zoom")).toHaveText("100%");
  // A step chosen stays through a change of paper; the desk only follows the fit until then.
  await paper.selectOption("A4");
  await expect(page.getByTestId("sheets-zoom")).toHaveText("100%");
});

test("a thumbnail is the real page, drawn on screen, and redrawn when it changes", async ({ page }) => {
  await openList(page, 1);
  const thumb = page.getByTestId("sheet-thumb").first();
  await expect.poll(() => thumb.evaluate((c) => (c instanceof HTMLElement ? Number(c.dataset["draws"] ?? 0) : 0))).toBe(1);
  const ink = await thumb.evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) return 0;
    const data = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 180) dark++;
    return dark;
  });
  expect(ink).toBeGreaterThan(20);
  const box = await thumb.boundingBox();
  expect(box?.width).toBe(60);
  await page.getByTestId("sheets-paper").selectOption("A3");
  await expect.poll(() => thumb.evaluate((c) => (c instanceof HTMLElement ? Number(c.dataset["draws"] ?? 0) : 0))).toBeGreaterThan(1);
});

// The right panel and the framing drag (sheetset.15, .17; AC-05, AC-06, AC-12).

const FRAME = '[data-testid="sheet-frame"]';
const sheetOnDesk = (page: Page, id: string) => page.locator(`[data-sheet-id="${id}"]`);
const draws = (el: ReturnType<Page["locator"]>) => el.evaluate((c) => (c instanceof HTMLElement ? Number(c.dataset["draws"] ?? 0) : 0));
const scaleChoice = (page: Page, name: string) => page.getByRole("group", { name: "Scale" }).getByRole("button", { name, exact: true });

/** The ink's box in the canvas's upper part, clear of the frame's edge, the title's plate and the column: where the plan is. */
async function planInk(page: Page, id: string): Promise<{ left: number; right: number; top: number; bottom: number } | null> {
  const box = await sheetOnDesk(page, id).locator(FRAME).boundingBox();
  const canvas = await sheetOnDesk(page, id).getByTestId("sheet-canvas").boundingBox();
  if (!box || !canvas) throw new Error("no frame");
  const area = { x: box.x - canvas.x + 6, y: box.y - canvas.y + 6, w: box.width - 12, h: box.height * 0.8 };
  return sheetOnDesk(page, id).getByTestId("sheet-canvas").evaluate((c, a) => {
    if (!(c instanceof HTMLCanvasElement)) return null;
    const { data } = c.getContext("2d")?.getImageData(a.x, a.y, a.w, a.h) ?? { data: new Uint8ClampedArray() };
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let y = 0; y < a.h; y++) {
      for (let x = 0; x < a.w; x++) {
        if ((data[(y * a.w + x) * 4] ?? 255) < 120) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return left === Infinity ? null : { left: left + a.x, right: right + a.x, top: top + a.y, bottom: bottom + a.y };
  }, { x: Math.round(area.x), y: Math.round(area.y), w: Math.round(area.w), h: Math.round(area.h) });
}

/** Holds the frame and moves along a path, as a hand does; the release is the caller's, so it can look in between. */
async function grab(page: Page, id: string, by: { x: number; y: number }): Promise<void> {
  const box = await sheetOnDesk(page, id).locator(FRAME).boundingBox();
  if (!box) throw new Error("no frame");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + by.x, start.y + by.y, { steps: 8 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

test("a click selects a page, without jumping, and the ring follows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await openList(page, 2);
  const desk = page.getByTestId("sheets-desk");
  await expect(sheetOnDesk(page, FIRST)).toHaveClass(/picked/);
  await expect(sheetOnDesk(page, SECOND)).not.toHaveClass(/picked/);
  await expect(sheetOnDesk(page, SECOND).locator(FRAME)).toBeVisible();
  await desk.evaluate((d) => {
    d.scrollTop = 30;
  });
  const scrolled = await desk.evaluate((d) => d.scrollTop);
  // The second page only shows its top here, so a scroll to it would move the desk.
  const box = await sheetOnDesk(page, SECOND).locator(FRAME).boundingBox();
  const view = await desk.boundingBox();
  if (!box || !view) throw new Error("no frame");
  expect(box.y + box.height).toBeGreaterThan(view.y + view.height);
  await page.mouse.click(box.x + box.width / 2, box.y + 10);
  await expect(sheetOnDesk(page, SECOND)).toHaveClass(/picked/);
  await expect(sheetOnDesk(page, FIRST)).not.toHaveClass(/picked/);
  await expect(row(page, SECOND)).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await desk.evaluate((d) => d.scrollTop)).toBe(scrolled);
  // And selecting in the list does scroll to it.
  await row(page, FIRST).click();
  await expect.poll(() => desk.evaluate((d) => d.scrollTop)).toBeLessThan(scrolled);
});

test("a drag draws live inside the frame, commits once on release, and undoes as one step", async ({ page }) => {
  await openList(page, 2);
  await expect(sheetOnDesk(page, FIRST).locator(FRAME)).toBeVisible();
  const canvas = sheetOnDesk(page, FIRST).getByTestId("sheet-canvas");
  const thumb = row(page, FIRST).getByTestId("sheet-thumb");
  const undo = page.locator('[data-action="sheets-undo"]');
  const redo = page.locator('[data-action="sheets-redo"]');
  await expect.poll(() => draws(thumb)).toBeGreaterThan(0);
  const before = await planInk(page, FIRST);
  if (!before) throw new Error("no plan on the page");
  const pageDraws = await draws(canvas);
  const thumbDraws = await draws(thumb);

  await grab(page, FIRST, { x: 60, y: 30 });
  const live = await planInk(page, FIRST);
  expect(live?.left).toBeCloseTo(before.left + 60, -1);
  expect(live?.top).toBeCloseTo(before.top + 30, -1);
  expect(await draws(canvas)).toBeGreaterThan(pageDraws); // drawn live
  expect(await draws(canvas)).toBeLessThan(pageDraws + 8 + 2); // at most once a frame, whatever the moves
  expect(await draws(thumb)).toBe(thumbDraws); // nothing committed yet
  await expect(page.getByTestId("sheet-centre")).toBeDisabled();

  await page.mouse.up();
  await expect.poll(() => draws(thumb)).toBeGreaterThan(thumbDraws);
  const placed = await planInk(page, FIRST);
  expect(Math.abs((placed?.left ?? 0) - (before.left + 60))).toBeLessThanOrEqual(1); // where it was let go
  expect(Math.abs((placed?.top ?? 0) - (before.top + 30))).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("sheet-centre")).toBeEnabled();

  await expect(redo).toBeDisabled();
  await undo.click();
  await expect.poll(async () => (await planInk(page, FIRST))?.left).toBe(before.left); // one undo is the whole drag
  await expect(page.getByTestId("sheet-centre")).toBeDisabled();
  await expect(redo).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(redo).toBeDisabled();
  await expect.poll(async () => (await planInk(page, FIRST))?.left).toBe(placed?.left);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await planInk(page, FIRST))?.left).toBe(before.left);
});

test("a drag leaves the title block alone, and clips the plan at the frame", async ({ page }) => {
  await openList(page, 1);
  await expect(sheetOnDesk(page, FIRST).locator(FRAME)).toBeVisible();
  const canvas = sheetOnDesk(page, FIRST).getByTestId("sheet-canvas");
  await expect.poll(() => draws(canvas)).toBeGreaterThan(0);
  const box = await sheetOnDesk(page, FIRST).locator(FRAME).boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!box || !canvasBox) throw new Error("no frame");
  // Everything right of the frame: the title block, and whatever a plan would spill onto if it weren't clipped.
  const rightOfFrame = (): Promise<string> =>
    canvas.evaluate((c, x) => {
      if (!(c instanceof HTMLCanvasElement)) return "";
      const { data } = c.getContext("2d")?.getImageData(x, 0, c.width - x, c.height) ?? { data: new Uint8ClampedArray() };
      return Array.from(data).join(",");
    }, Math.ceil(box.x - canvasBox.x + box.width + 2));
  const column = await rightOfFrame();
  await grab(page, FIRST, { x: box.width * 0.7, y: 0 });
  expect(await rightOfFrame()).toBe(column);
  await page.mouse.up();
  await expect(page.getByTestId("sheet-note")).toContainText("Shows part of the plan");
  await expect(row(page, FIRST).locator(".sheets-row-sub")).toContainText("cropped");
  expect(await rightOfFrame()).toBe(column); // the plan's past the frame now, on paper's rules too

  await page.locator('[data-shortcut="centre"]').click();
  await expect(page.getByTestId("sheet-note")).toHaveCount(0);
  await expect(page.getByTestId("sheet-centre")).toBeDisabled();
});

test("a drag of the same pixels moves the plan by those pixels at any zoom", async ({ page }) => {
  await openList(page, 1);
  await expect(sheetOnDesk(page, FIRST).locator(FRAME)).toBeVisible();
  await page.getByTestId("sheets-zoom-out").click();
  await expect(page.getByTestId("sheets-zoom")).toHaveText(/%$/);
  await expect.poll(async () => (await planInk(page, FIRST)) !== null).toBe(true);
  const small = await planInk(page, FIRST);
  await grab(page, FIRST, { x: 40, y: 0 });
  await page.mouse.up();
  await expect(page.getByTestId("sheet-centre")).toBeEnabled();
  await expect.poll(async () => Math.abs(((await planInk(page, FIRST))?.left ?? 0) - (small?.left ?? 0) - 40)).toBeLessThanOrEqual(1);
  // The stored framing is on paper: a larger zoom draws it proportionally further from the same place on the page.
  const atSmall = await planInk(page, FIRST);
  const widthSmall = (await sheetOnDesk(page, FIRST).getByTestId("sheet-canvas").boundingBox())?.width ?? 1;
  await page.getByTestId("sheets-zoom-in").click();
  await page.getByTestId("sheets-zoom-in").click();
  await expect.poll(async () => (await sheetOnDesk(page, FIRST).getByTestId("sheet-canvas").boundingBox())?.width).toBeGreaterThan(widthSmall);
  await expect.poll(async () => {
    const width = (await sheetOnDesk(page, FIRST).getByTestId("sheet-canvas").boundingBox())?.width ?? 1;
    return Math.abs(((await planInk(page, FIRST))?.left ?? 0) / width - (atSmall?.left ?? 0) / widthSmall) * width;
  }).toBeLessThanOrEqual(2);
});

test("the panel leads with the selected sheet, and each choice is one step", async ({ page }) => {
  await openList(page, 2);
  const panel = page.getByTestId("sheets-settings");
  await expect(panel.getByRole("heading").first()).toHaveText("Plan sheet");
  await expect(page.getByTestId("sheet-title")).toHaveValue("Layout");
  await row(page, SECOND).click();
  await expect(page.getByTestId("sheet-title")).toHaveValue("Layout 2");

  // A dot, a pick allowed, the row in blue, and the note with its shortcuts.
  await expect(scaleChoice(page, "1:20")).toHaveClass("nofit");
  await expect(scaleChoice(page, "1:50")).not.toHaveClass("nofit");
  await expect(scaleChoice(page, "General")).toHaveAttribute("aria-pressed", "true");
  await scaleChoice(page, "1:20").click();
  await expect(scaleChoice(page, "1:20")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, SECOND).locator(".sheets-row-sub b")).toHaveText("1:20");
  await expect(page.getByTestId("sheet-note")).toContainText("Fit the whole plan (1:50)");
  await expect(page.getByTestId("sheet-note")).toContainText("Use A3");
  await expect(page.getByTestId("sheets-save-pdf")).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(scaleChoice(page, "General")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sheet-note")).toHaveCount(0);
  await expect(row(page, SECOND)).toHaveAttribute("aria-selected", "true"); // selection isn't undone

  await scaleChoice(page, "1:20").click();
  await page.locator('[data-shortcut="fit"]').click();
  await expect(scaleChoice(page, "1:50")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("sheet-note")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(scaleChoice(page, "1:20")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-shortcut="paper"]').click();
  await expect(page.getByTestId("sheets-paper")).toHaveValue("A3");
  await expect(page.getByTestId("sheet-note")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("sheets-paper")).toHaveValue("A4");

  // Finishes and Layout, each a step; a title naming its drawing follows the layout.
  await page.getByTestId("sheet-finishes").click();
  await expect(page.getByTestId("sheet-finishes")).not.toBeChecked();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("sheet-finishes")).toBeChecked();
  await panel.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Layout", exact: true }).click();
  await expect(page.getByTestId("sheet-title")).toHaveValue("Layout");
  await expect(row(page, SECOND).locator(".sheets-row-title")).toHaveText("Layout");
});

test("a title's own ⌘Z holds while it has the focus, and its text is one step on leaving", async ({ page }) => {
  await openList(page, 1);
  const title = page.getByTestId("sheet-title");
  const stored = row(page, FIRST).locator(".sheets-row-title");
  const undo = page.locator('[data-action="sheets-undo"]');
  const redo = page.locator('[data-action="sheets-redo"]'); // enabled by any undo of the document's, so it tells who took a ⌘Z
  await expect(title).toHaveCSS("user-select", "text");
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" detail");
  await expect(title).toHaveValue("Layout detail");
  await expect(stored).toHaveText("Layout"); // nothing stored while typing
  await page.keyboard.press("ControlOrMeta+z"); // the box's own
  await expect(title).not.toHaveValue("Layout detail");
  await expect(redo).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Bedroom detail");
  await page.keyboard.press("Enter");
  await expect(stored).toHaveText("Bedroom detail");
  await expect(sheetOnDesk(page, FIRST).locator(".sheets-title")).toHaveText("Bedroom detail");
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(title).toHaveValue("Layout");
  await expect(stored).toHaveText("Layout"); // one step, and the walls are still there
  await expect(redo).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(redo).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(stored).toHaveText("Layout");

  await title.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Gone");
  await page.keyboard.press("Escape"); // the box's own: the view stays
  await expect(title).toHaveValue("Layout");
  await expect(stored).toHaveText("Layout");
  await expect(page.getByTestId("sheets-view")).toBeVisible();
});

test("Fit goes back to the desk's width after a zoom step, and every sheet unticked says what to do", async ({ page }) => {
  await openList(page, 2);
  const zoom = page.getByTestId("sheets-zoom");
  const fit = page.getByTestId("sheets-zoom-fit");
  await expect(fit).toBeDisabled();
  const fitted = await zoom.innerText();
  await page.getByTestId("sheets-zoom-out").click();
  await expect(zoom).not.toHaveText(fitted);
  await expect(fit).toBeEnabled();
  await fit.click();
  await expect(zoom).toHaveText(fitted);
  await expect(fit).toBeDisabled();

  await expect(page.getByTestId("sheets-status")).toHaveText("Whole plans on every sheet");
  await page.getByTestId("sheets-all-none").click();
  await expect(page.getByTestId("sheets-status")).toHaveCount(0);
  await expect(page.getByTestId("sheets-save-reason")).toHaveText("Tick a sheet to save a PDF");
});

test("a compare sheet: its checks, its Split, and one drag moving all its panes (AC-07)", async ({ page }) => {
  await openList(page, 3);
  await page.getByRole("button", { name: "Add sheet" }).click();
  await page.locator('[data-kind="compare"]').click();
  const panes = page.getByTestId("sheet-pane");
  const selected = page.locator(".sheets-sheet.picked");
  const frames = selected.getByTestId("sheet-frame");
  await expect(panes).toHaveCount(3);
  await expect(frames).toHaveCount(2);

  // Two is the least: neither can go, and the third can come, with a title still naming them.
  await expect(panes.nth(0)).toBeDisabled();
  await expect(panes.nth(1)).toBeDisabled();
  await panes.nth(2).click();
  await expect(frames).toHaveCount(3);
  await expect(panes.nth(0)).toBeEnabled();
  await expect(page.getByTestId("sheet-title")).toHaveValue("Layout, Layout 2 and Layout 3");

  // Split: the frames say which.
  const panel = page.getByTestId("sheets-settings");
  const lies = async (): Promise<"stacked" | "sideBySide"> => {
    const [a, b] = await Promise.all([frames.nth(0).boundingBox(), frames.nth(1).boundingBox()]);
    if (!a || !b) throw new Error("no frames");
    return Math.abs(a.x - b.x) < 1 ? "stacked" : "sideBySide";
  };
  await panel.getByRole("group", { name: "Split" }).getByRole("button", { name: "Stacked" }).click();
  await expect.poll(lies).toBe("stacked");
  await panel.getByRole("group", { name: "Split" }).getByRole("button", { name: "Side by side" }).click();
  await expect.poll(lies).toBe("sideBySide");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(lies).toBe("stacked");

  // One framing: a drag on the last pane is one step, whichever pane it began on.
  const centre = page.getByTestId("sheet-centre");
  await expect(centre).toBeDisabled();
  const box = await frames.nth(2).boundingBox();
  if (!box) throw new Error("no frame");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await expect(centre).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(centre).toBeDisabled();
});

test("a row's actions sit on the title's line and leave the line under it readable", async ({ page }) => {
  await openList(page, 2);
  const first = row(page, FIRST);
  await first.click();
  const acts = await first.locator(".sheets-row-acts").boundingBox();
  const sub = await first.locator(".sheets-row-sub").boundingBox();
  const heading = await first.locator(".sheets-row-title").boundingBox();
  if (!acts || !sub || !heading) throw new Error("no row parts");
  expect(acts.y + acts.height).toBeLessThanOrEqual(sub.y + 0.5);
  expect(acts.y).toBeGreaterThanOrEqual(heading.y - 0.5);
});

const northSlider = (page: Page) => page.getByRole("slider", { name: "North angle" });
const northSwitch = (page: Page) => page.getByRole("switch", { name: "Show a north arrow" });
const northField = (page: Page) => page.getByRole("spinbutton", { name: "North angle in degrees" });
const expectNorth = async (page: Page, angle: number): Promise<void> => {
  await expect(northSlider(page)).toHaveAttribute("aria-valuenow", String(angle));
  await expect(northSwitch(page)).toBeChecked();
  await expect(northField(page)).toHaveValue(String(angle));
};
const expectNoNorth = async (page: Page): Promise<void> => {
  await expect(northSwitch(page)).not.toBeChecked();
  await expect(northField(page)).toBeDisabled();
};

/** Presses the dial and moves round it through `angles`, clockwise from up, stopping short of letting go. */
async function holdDial(page: Page, angles: readonly number[]): Promise<void> {
  const box = await northSlider(page).boundingBox();
  if (!box) throw new Error("no dial");
  const at = (angle: number) => {
    const r = (angle * Math.PI) / 180;
    return { x: box.x + box.width / 2 + 30 * Math.sin(r), y: box.y + box.height / 2 - 30 * Math.cos(r) };
  };
  const [first = 0, ...rest] = angles;
  await page.mouse.move(at(first).x, at(first).y);
  await page.mouse.down();
  for (const angle of rest) await page.mouse.move(at(angle).x, at(angle).y, { steps: 4 });
}

test("a drag commits once, on release, in 5° steps, and turns the arrow on", async ({ page }) => {
  await openList(page, 1);
  await expectNoNorth(page);
  await expect(page.locator('[data-action="sheets-redo"]')).toBeDisabled();
  await holdDial(page, [10, 30, 50, 70, 91]);
  await expect(northSlider(page)).toHaveAttribute("aria-valuenow", "90");
  await expect(northField(page)).toHaveValue("90");
  await page.mouse.up();
  await expectNorth(page, 90);
  await expect(northSlider(page)).toBeFocused();

  // One ⌘Z takes the whole drag: per-move commits would stop at an angle on the way, and Redo's state says it was ours (sheetset.35).
  await page.keyboard.press("ControlOrMeta+z");
  await expectNoNorth(page);
  await expect(page.locator('[data-action="sheets-redo"]')).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectNorth(page, 90);
});

test("a drag back to where it began is no step", async ({ page }) => {
  await openList(page, 1);
  await holdDial(page, [90]);
  await page.mouse.up();
  await expectNorth(page, 90);
  await holdDial(page, [90, 120, 90]);
  await page.mouse.up();
  await expectNorth(page, 90);
  await page.keyboard.press("ControlOrMeta+z"); // a second step would leave 90 here
  await expectNoNorth(page);
});

test("the switch clears it, one step, and turns on at up", async ({ page }) => {
  await openList(page, 1);
  await northSwitch(page).click();
  await expectNorth(page, 0);
  await expect(page.getByTestId("sheets-settings")).toContainText("Arrow on sheets");
  await northSlider(page).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expectNorth(page, 15);
  await northSwitch(page).click();
  await expectNoNorth(page);
  await expect(page.getByTestId("sheets-settings")).toContainText("No arrow");
  await page.keyboard.press("ControlOrMeta+z");
  await expectNorth(page, 15);
});

test("arrows turn it by 1° and Shift by 15°, each press one step, keeping the focus", async ({ page }) => {
  await openList(page, 1);
  await northSlider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expectNorth(page, 1);
  await page.keyboard.press("ArrowUp");
  await expectNorth(page, 2);
  await page.keyboard.press("Shift+ArrowLeft");
  await expectNorth(page, 347);
  await page.keyboard.press("ArrowDown");
  await expectNorth(page, 346);
  await expect(northSlider(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expectNorth(page, 347);
  await page.keyboard.press("ControlOrMeta+z");
  await expectNorth(page, 2);
  await expect(northSlider(page)).toBeFocused();
  await expect(row(page, FIRST)).toHaveAttribute("aria-selected", "true"); // the arrows never reached the list
});

test("a typed angle lands on leaving the box; a wrong one is refused, saying why, and a blank one does nothing", async ({ page }) => {
  await openList(page, 1);
  await northSwitch(page).click();
  await expectNorth(page, 0);
  await northField(page).fill("235");
  await northField(page).press("Enter");
  await expectNorth(page, 235);
  await expect(northField(page)).not.toBeFocused();

  await northField(page).fill("360");
  await northField(page).press("Enter");
  await expect(page.getByText("North must be a whole number of degrees from 0 to 359")).toBeVisible();
  await expectNorth(page, 235);

  await northField(page).fill("");
  await northField(page).press("Enter");
  await expectNorth(page, 235);

  await page.keyboard.press("ControlOrMeta+z");
  await expectNorth(page, 0);
});

test("the dial takes arrows through each edit's acknowledgement", async ({ page }) => {
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await openProject(page, `North ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`);
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 5, 4);
  await expect(page.getByTestId("export-button")).toBeEnabled();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(1);

  await northSlider(page).focus();
  for (let angle = 1; angle <= 6; angle++) {
    await page.keyboard.press("ArrowRight");
    await expectNorth(page, angle); // shown before its ack, and a press during one is refused (sheetset.41)
    await expect(northSlider(page)).toBeFocused();
    await expect(page.getByTestId("sheets-paper")).toBeEnabled(); // disabled until the ack
  }
  await northSwitch(page).focus();
  await page.keyboard.press("Space");
  await expectNoNorth(page);
  await expect(northSwitch(page)).toBeFocused();
});

const swatch = (page: Page, name: string) => page.getByRole("group", { name: "Accent" }).getByRole("button", { name });
const customColour = (page: Page) => page.getByLabel("Custom accent colour");
const SHEETS_REDO = '[data-action="sheets-redo"]';

/** How many of the first page's pixels are this colour over white, at any strength: the title's rule is thin, so antialiased. */
const pixelsOf = (page: Page, hex: string): Promise<number> =>
  page.getByTestId("sheet-canvas").first().evaluate((canvas, colour) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("not a canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D context");
    const ink = [1, 3, 5].map((i) => 255 - parseInt(colour.slice(i, i + 2), 16));
    const [r = 0, g = 0, b = 0] = ink;
    const length = r * r + g * g + b * b;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [dr, dg, db] = [255 - (data[i] ?? 0), 255 - (data[i + 1] ?? 0), 255 - (data[i + 2] ?? 0)];
      const t = (dr * r + dg * g + db * b) / length;
      if (t > 0.3 && Math.abs(dr - t * r) + Math.abs(dg - t * g) + Math.abs(db - t * b) < 12) count++;
    }
    return count;
  }, hex);
const expectPainted = (page: Page, hex: string, painted: boolean) => expect.poll(async () => (await pixelsOf(page, hex)) > 0).toBe(painted);

test("a swatch recolours the page, keeps its focus, and ⌘Z takes it back", async ({ page }) => {
  await openList(page, 1);
  const brick = "#b3261e";
  const blue = "#1d4ed8";
  await expect(swatch(page, "Brick red")).toHaveAttribute("aria-pressed", "true");
  await expectPainted(page, brick, true); // the title's rule
  await expectPainted(page, blue, false);
  await expect(page.locator(SHEETS_REDO)).toBeDisabled();

  await swatch(page, "Blue").click();
  await expect(swatch(page, "Blue")).toHaveAttribute("aria-pressed", "true");
  await expect(swatch(page, "Brick red")).toHaveAttribute("aria-pressed", "false");
  await expectPainted(page, blue, true);
  await expectPainted(page, brick, false);
  await expect(swatch(page, "Blue")).toBeFocused();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(swatch(page, "Brick red")).toHaveAttribute("aria-pressed", "true");
  await expectPainted(page, brick, true);
  await expectPainted(page, blue, false);
  await expect(page.locator(SHEETS_REDO)).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(swatch(page, "Blue")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(SHEETS_REDO)).toBeDisabled();
});

test("the swatch already on adds no undo step", async ({ page }) => {
  await openList(page, 1);
  await swatch(page, "Blue").click();
  await expect(swatch(page, "Blue")).toHaveAttribute("aria-pressed", "true");
  await swatch(page, "Blue").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(swatch(page, "Brick red")).toHaveAttribute("aria-pressed", "true"); // one press was enough
});

test("a custom colour is one step, however many colours the picker passes through", async ({ page }) => {
  await openList(page, 1);
  const input = customColour(page);
  await expect(input).toHaveValue("#7c3aed"); // not the current colour, or it reads as a second brick swatch
  await input.focus();
  // What the browser's picker sends: `input` per colour passed, `change` as it closes. Nothing here can open the real one.
  await input.evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
    // The prototype's setter, as the browser's own writes don't pass through React's watch on the element's value.
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    for (const value of ["#111111", "#222222", "#0a7d55"]) {
      write?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await expectPainted(page, "#0a7d55", false); // not stored until it closes
  await expect(page.locator(SHEETS_REDO)).toBeDisabled();
  await input.evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
  await expectPainted(page, "#0a7d55", true);
  await expectPainted(page, "#b3261e", false);
  for (const name of ["Brick red", "Blue", "Teal", "Black"]) await expect(swatch(page, name)).toHaveAttribute("aria-pressed", "false");
  await expect(input).toHaveValue("#0a7d55");

  // ⌘Z from the colour box itself is the document's, as it's not a box typed into; one press goes all the way back.
  await expect(input).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(swatch(page, "Brick red")).toHaveAttribute("aria-pressed", "true");
  await expect(input).toHaveValue("#7c3aed");
  await expectPainted(page, "#b3261e", true);
  await expect(page.locator(SHEETS_REDO)).toBeEnabled();
});

test("Tab walks through Project filling each field: focus moves on through each edit's acknowledgement, up to the logo", async ({ page }) => {
  await openShared(page, newName("Tabbing"), 1);
  await page.keyboard.press("Escape");
  const section = page.getByTestId("project-section");
  await openSection(section); // closed until opened (inherit step 06)
  const box = (key: string) => section.locator(`[data-field-id="project.${key}"]`);
  await box("studioName").click();
  for (const [key, next, value] of [["studioName", "studioAddress", "Atelier Bruni"], ["studioAddress", "studioContact", "Via Roma 1"]] as const) {
    await expect(box(key)).toBeFocused();
    await page.keyboard.type(value);
    await page.keyboard.press("Tab");
    await expect(box(next)).toBeFocused();
    await expect(box(key)).toHaveValue(value);
    await waitSaved(page);
    await expect(box(next)).toBeFocused(); // past the acknowledgement: a field going disabled would drop it to the body
  }
  await page.keyboard.type("studio@example.invalid");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("logo-choose")).toBeFocused();
  await waitSaved(page);
  await expect(page.getByTestId("logo-choose")).toBeFocused();
  await expect(box("studioContact")).toHaveValue("studio@example.invalid");
});

test("studio details and a date typed in Project reach the saved PDF, and a blank date prints today's", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2031-02-03T12:00:00Z")); // a blank date prints today's: not the real one
  await openList(page, 1);
  await page.keyboard.press("Escape");
  const section = page.getByTestId("project-section");
  await openSection(section); // closed until opened (inherit step 06)
  const fill = async (key: string, value: string): Promise<void> => {
    const box = section.locator(`[data-field-id="project.${key}"]`);
    await box.fill(value);
    await box.press("Enter");
    await expect(box).toHaveValue(value);
  };
  await expect(section.locator('[data-field-id="project.issueDate"]')).toHaveAttribute("placeholder", "Today");
  await fill("studioName", "Atelier Bruni");
  await fill("studioAddress", "Via Roma 1");
  await fill("issueDate", "14 sept 2026");

  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(1);
  const pdfText = async (): Promise<string> => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
    return (await readFile(await download.path())).toString("latin1");
  };
  const typed = await pdfText();
  for (const value of ["Atelier Bruni", "Via Roma 1", "14 sept 2026"]) expect(typed).toContain(value);

  await page.keyboard.press("Escape");
  await fill("issueDate", "");
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(1);
  const blank = await pdfText();
  expect(blank).not.toContain("14 sept 2026");
  expect(blank).toContain("2031-02-03");
});

test("a cover by hand: from the menu straight to first place, with a plan's settings, framed by drag, listed in its own index", async ({ page }) => {
  await openList(page, 2);
  await page.getByRole("button", { name: "Add sheet" }).click();
  await page.locator('[data-kind="cover"]').click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  const settings = page.getByTestId("sheets-settings");
  await expect(settings.getByRole("heading", { name: "Cover sheet" })).toBeVisible();
  for (const label of ["Layout", "Level", "Scale"]) await expect(settings.getByRole("group", { name: label })).toBeVisible();
  await expect(page.getByTestId("sheets-paper")).toBeEnabled(); // the add's ack

  // A new cover goes first, whichever sheet was selected (sheetset.70).
  await expect(page.getByTestId("sheet-row").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("sheet-row").first()).toContainText("01");
  await expect(page.getByTestId("sheet-row").first()).toContainText("Cover");
  await expect(page.getByTestId("sheets-paper")).toBeEnabled();

  // Its plan drags inside its clip, one undoable step; Centre comes on.
  const centre = page.getByTestId("sheet-centre");
  await expect(centre).toBeDisabled();
  const frame = page.getByTestId("sheet-frame").first();
  await frame.scrollIntoViewIfNeeded();
  const box = await frame.boundingBox();
  if (!box) throw new Error("no frame");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  await expect(centre).toBeEnabled();
  await expect(page.getByTestId("sheets-paper")).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(centre).toBeDisabled();
  await expect(page.getByTestId("sheets-paper")).toBeEnabled();

  // The file: its index and tint, and the next page's number counting it.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  const pdf = (await readFile(await download.path())).toString("latin1");
  expect(pdf).toContain("(SHEET INDEX)");
  expect(pdf).toContain("0.9686 0.9608 0.949 rg"); // the tint
  expect(pdf).toContain("(Sheet 02 / 03)");
  expect(pdf).not.toContain("(Sheet 01 / 03)");
});

// Writing the report (sheetset.07, .14; AC-03, AC-09, AC-14): real keys in a real box, whose own ⌘Z web tests can't reach.

const reportBox = (page: Page) => page.getByTestId("report-text");
const redoButton = (page: Page) => page.locator('[data-action="sheets-redo"]');
const styleButton = (page: Page, style: string) => page.locator(`[data-style="${style}"]`);
const DEFAULT_TEXT = "# Title\n\n## Heading\n\nWrite here.";

/** Adds a report after the selected sheet, and gives its ID. */
async function addReport(page: Page): Promise<string> {
  await page.getByTestId("sheets-add").click();
  await page.getByTestId("sheets-add-menu").locator('[data-kind="report"]').click();
  const id = await page.locator(`${ROW}[aria-selected="true"]`).getAttribute("data-sheet-row");
  if (id === null) throw new Error("no selected row");
  await expect(reportBox(page)).toHaveValue(DEFAULT_TEXT);
  return id;
}
/** Replaces the box's text as a person's keys do, a key at a time. */
async function typeAll(page: Page, text: string): Promise<void> {
  await reportBox(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
}
const canvasDraws = (page: Page, id: string) => sheetOnDesk(page, id).getByTestId("sheet-canvas").first().evaluate((c) => Number(c instanceof HTMLElement ? c.dataset["draws"] : 0));
async function savedPdf(page: Page): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  return (await readFile(await download.path())).toString("latin1");
}

test("a report's box: the page follows each key, its own ⌘Z holds, and its text is one step on leaving", async ({ page }) => {
  await openList(page, 1);
  const id = await addReport(page);
  const box = reportBox(page);
  await expect(box).toHaveCSS("user-select", "text");
  const redo = redoButton(page);

  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  const before = await canvasDraws(page, id);
  await page.keyboard.type("Fresh");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("Fresh");
  await expect.poll(() => canvasDraws(page, id)).toBeGreaterThanOrEqual(before + 5); // a redraw a key, with no command

  await page.keyboard.press("ControlOrMeta+z"); // the box's own
  await expect(box).not.toHaveValue("Fresh");
  await expect(redo).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Second words");
  await expect(redo).toBeDisabled();

  await page.keyboard.press("Tab"); // leaving: one step
  await expect(box).not.toBeFocused();
  await expect(box).toHaveValue("Second words");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(redo).toBeEnabled();
  await expect(box).toHaveValue(DEFAULT_TEXT); // all of it, and the sheet's still there
  await expect(row(page, id)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(box).toHaveValue("Second words");
  await expect(redo).toBeDisabled();
});

test("the style bar keeps the focus and the selection, marks against the words, and ⌘Z takes a style back", async ({ page }) => {
  await openList(page, 1);
  await addReport(page);
  const box = reportBox(page);
  await typeAll(page, "a big room");
  // " big " with its spaces, from the keyboard.
  for (let i = 0; i < "room".length; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < " big ".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await styleButton(page, "bold").click();
  await expect(box).toHaveValue("a **big** room");
  await expect(box).toBeFocused();
  expect(await box.evaluate((b) => (b instanceof HTMLTextAreaElement ? b.value.slice(b.selectionStart, b.selectionEnd) : ""))).toBe("big");

  await styleButton(page, "bold").click(); // off
  await expect(box).toHaveValue("a big room");
  await styleButton(page, "italic").click();
  await expect(box).toHaveValue("a *big* room");
  await page.keyboard.press("ControlOrMeta+z"); // the browser's own undo saw the style
  await expect(box).toHaveValue("a big room");

  await styleButton(page, "heading").click();
  await expect(box).toHaveValue("## a big room");
  await styleButton(page, "title").click();
  await expect(box).toHaveValue("# a big room");
  await styleButton(page, "bold").click(); // marks in a heading print as typed
  await expect(box).toHaveValue("# a big room");
  await expect(box).toBeFocused();

  // All that was one draft: no style left the box, so it's one step.
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(box).toHaveValue(DEFAULT_TEXT);
});

test("Escape leaves the box and keeps its text, the next one closes, and Edit in Properties comes back to it", async ({ page }) => {
  await openList(page, 1);
  const id = await addReport(page);
  const box = reportBox(page);
  await typeAll(page, "# Studio **plan**\n\nBody.");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sheets-view")).toBeVisible();
  await expect(box).not.toBeFocused();
  await expect(box).toHaveValue("# Studio **plan**\n\nBody.");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sheets-view")).toBeHidden();

  await openSection(page.getByTestId("project-section")); // closed until opened (inherit step 06)
  const line = page.locator('[data-field-id="project.report"]');
  await expect(line).toHaveValue("Studio **plan**"); // as a heading prints it (sheetset.50)
  await page.getByTestId("project-report-edit").click();
  await expect(page.getByTestId("sheets-view")).toBeVisible();
  await expect(row(page, id)).toHaveAttribute("aria-selected", "true");
  await expect(box).toHaveValue("# Studio **plan**\n\nBody.");
});

test("closing the view, or picking another sheet, with text in the box keeps it, as one step", async ({ page }) => {
  await openList(page, 1);
  const id = await addReport(page);
  const box = reportBox(page);
  await typeAll(page, "Typed, then another sheet");
  await row(page, FIRST).click();
  await expect(box).toBeHidden();
  await row(page, id).click();
  await expect(box).toHaveValue("Typed, then another sheet");

  await typeAll(page, "Typed, then closed");
  await page.getByTestId("sheets-close").click();
  await expect(page.getByTestId("sheets-view")).toBeHidden();
  await openSection(page.getByTestId("project-section")); // closed until opened (inherit step 06)
  await page.getByTestId("project-report-edit").click();
  await expect(box).toHaveValue("Typed, then closed");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(box).toHaveValue("Typed, then another sheet");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(box).toHaveValue(DEFAULT_TEXT);
});

test("past 20,000 characters nothing's lost: it says so at the box, leaving is refused, and cutting it saves", async ({ page }) => {
  await openList(page, 1);
  const id = await addReport(page);
  const box = reportBox(page);
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("word ".repeat(4001)); // a paste
  await expect(page.getByTestId("report-note")).toContainText("5 characters over the 20,000");
  await page.keyboard.press("Tab");
  await expect(page.locator(".toast")).toContainText("at most 20,000");
  await expect(box).toHaveValue("word ".repeat(4001));
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("word ".repeat(4000));
  await expect(page.getByTestId("report-note")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(row(page, id)).toContainText(/Report/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(box).toHaveValue(DEFAULT_TEXT);
});

test("a long report typed in the box numbers its pages, and the saved PDF prints them in its three faces", async ({ page }) => {
  await openList(page, 1);
  const id = await addReport(page);
  const box = reportBox(page);
  const lorem = "The plan fits a whole home into seven by two and a half metres, with a partition at the west end closing off the bathroom. ";
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("# Studio\n\n## Description\n\nThis is **strong** and *leaning*.\n\n");
  await page.keyboard.insertText(Array.from({ length: 60 }, (_, i) => `${i} ${lorem}`).join("\n\n"));
  await page.keyboard.press("Tab");
  await expect(sheetOnDesk(page, id).getByTestId("sheet-canvas").nth(2)).toBeAttached();
  const pages = await sheetOnDesk(page, id).getByTestId("sheet-canvas").count();

  const pdf = await savedPdf(page);
  const total = String(pages + 1).padStart(2, "0");
  expect(pdf).toContain(`(Sheet 02 / ${total})`);
  expect(pdf).toContain(`(Sheet ${total} / ${total})`);
  expect(pdf).toContain("(Studio)");
  expect(pdf).toMatch(/\/F2 [\d.]+ Tf .*\(strong ?\) Tj/);
  expect(pdf).toMatch(/\/F3 [\d.]+ Tf .*\(leaning\) Tj/);
  expect(pdf).toContain("(59 The plan fits");

  await page.getByRole("group", { name: "Body size" }).getByRole("button", { name: "Large", exact: true }).click();
  await expect(sheetOnDesk(page, id).getByTestId("sheet-canvas").nth(pages)).toBeAttached(); // larger type, more pages
  await page.keyboard.press("ControlOrMeta+z");
  await expect(sheetOnDesk(page, id).getByTestId("sheet-canvas")).toHaveCount(pages);
});

test("two clients: a text left reaches the other's page, typing keeps through each edit's acknowledgement and through another's text", async ({ page, browser }) => {
  const name = `Report ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await openProject(page, name);
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 5, 4);
  await expect(page.getByTestId("export-button")).toBeEnabled();
  await page.getByTestId("export-button").click();
  const id = await addReport(page);
  await expect(page.getByTestId("sheets-paper")).toBeEnabled();

  // Every key lands, though leaving and coming back sends an edit whose ack is on its way as the keys arrive.
  await typeAll(page, "One");
  await page.keyboard.press("Tab");
  await reportBox(page).focus();
  await page.keyboard.type(" two three four");
  await expect(reportBox(page)).toHaveValue("One two three four");
  await expect(page.getByTestId("sheets-paper")).toBeEnabled(); // leaving before that answer would hold the text ("Not saved yet"), sheetset.73
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("sheets-paper")).toBeEnabled();

  const bob = await (await browser.newContext()).newPage();
  await bob.goto(`/?name=Bob&server=${encodeURIComponent(SERVER)}`);
  await bob.getByTestId("project-list").getByRole("button", { name }).first().click();
  await expect(bob.getByTestId("export-button")).toBeEnabled();
  await bob.getByTestId("export-button").click();
  await row(bob, id).click();
  await expect(reportBox(bob)).toHaveValue("One two three four");

  // A collaborator's text comes into a box nobody's typing in. One being typed in keeps its words and says so, and leaving sends them: last writer wins.
  await typeAll(page, "Alice wrote this");
  await page.keyboard.press("Tab");
  await expect(reportBox(bob)).toHaveValue("Alice wrote this");
  await typeAll(bob, "Bob is typing");
  await typeAll(page, "Alice again");
  await expect(page.getByTestId("sheets-paper")).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(bob.locator(".toast")).toHaveText("Someone else changed this first");
  await expect(reportBox(bob)).toHaveValue("Bob is typing");
  await expect(bob.getByTestId("report-note")).toContainText("your text replaces theirs");
  await bob.keyboard.type(" still");
  await expect(reportBox(bob)).toHaveValue("Bob is typing still");
  await expect(bob.getByTestId("report-note")).toBeVisible();
  await bob.keyboard.press("Tab");
  await expect(bob.getByTestId("report-note")).toHaveCount(0);
  await expect(reportBox(page)).toHaveValue("Bob is typing still");
  await expect(reportBox(bob)).toHaveValue("Bob is typing still");
  await bob.context().close();
});

// The studio's logo (sheetset.18, .21; AC-13): from a file to the paper.

const LOGO: PictureSpec = { kind: "solid", name: "logo.png", width: 900, height: 300, colour: "#ff0000", type: "image/png" };

async function chooseLogo(page: Page, spec: PictureSpec): Promise<void> {
  const file = await page.evaluateHandle(makeFileInPage, spec);
  const b64 = await page.evaluate(
    (f) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(f);
      }),
    file,
  );
  await openSection(page.getByTestId("project-section")); // the logo sits in Project, closed until opened (inherit step 06)
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("logo-choose").click()]);
  await chooser.setFiles({ name: spec.name, mimeType: spec.type, buffer: Buffer.from(b64, "base64") });
}

/** How red the canvas is at a point given in page millimetres from its top left, of a page `widthMm` wide. */
const redAt = (canvas: ReturnType<Page["locator"]>, widthMm: number, mm: { x: number; y: number }) =>
  canvas.evaluate(
    (c, a) => {
      if (!(c instanceof HTMLCanvasElement)) return false;
      const k = c.width / a.widthMm;
      const [r = 0, g = 255, b = 255] = c.getContext("2d")?.getImageData(a.mm.x * k, a.mm.y * k, 1, 1).data ?? [];
      return r > 200 && g < 80 && b < 80;
    },
    { widthMm, mm },
  );

test("choose a JPEG, and the PDF holds an image", async ({ page }) => {
  await openList(page, 1);
  const canvas = page.getByTestId("sheet-canvas").first();
  const thumb = page.getByTestId("sheet-thumb").first();
  await expect.poll(() => draws(canvas)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("logo-state")).toHaveText("None");
  await expect(page.getByTestId("logo-remove")).toBeDisabled();

  await chooseLogo(page, LOGO);
  await expect(page.getByTestId("logo-state")).toHaveText("Set");
  await page.getByTestId("export-button").click();

  // A4 landscape, its column 60 mm wide inside a 10 mm margin: the logo's middle, on the page and its thumbnail.
  const middle = { x: 297 - 10 - 60 + 4 + 15, y: 10 + 3 + 5 };
  await expect.poll(() => redAt(canvas, 297, middle)).toBe(true);
  await expect.poll(() => redAt(thumb, 297, middle)).toBe(true);
  // It painted itself when decoded: no page drew again for it, and nothing keeps drawing.
  const settled = await draws(canvas);
  await page.waitForTimeout(300);
  expect(await draws(canvas)).toBe(settled);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  const path = await download.path();
  const pdf = (await readFile(path)).toString("latin1");
  expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(1);
  expect(pdf).toContain("/Filter /DCTDecode");
  expect(pdf).toContain("/Width 600");
  expect(pdf).toContain("/Height 200");
  const listed = await promisify(execFile)("pdfimages", ["-list", path]).then(({ stdout }) => stdout, () => null); // where poppler is installed
  if (listed !== null) expect(listed.split("\n").filter((line) => /\bjpeg\b/.test(line))).toHaveLength(1);

  // Undo takes it off the page, as one step; a repaint leaves no trace of it.
  await page.locator('[data-action="sheets-undo"]').click();
  await expect.poll(() => redAt(canvas, 297, middle)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("logo-state")).toHaveText("None");
});

test("Remove takes it off the paper", async ({ page }) => {
  await openList(page, 1);
  await page.keyboard.press("Escape");
  await chooseLogo(page, LOGO);
  await expect(page.getByTestId("logo-state")).toHaveText("Set");
  await page.getByTestId("logo-remove").click();
  await expect(page.getByTestId("logo-state")).toHaveText("None");
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  expect((await readFile(await download.path())).toString("latin1")).not.toContain("/Subtype /Image");
});

test("what isn't a picture is refused in the underlay's words, and changes nothing", async ({ page }) => {
  await openList(page, 1);
  await page.keyboard.press("Escape");
  await chooseLogo(page, { kind: "bytes", name: "plan.pdf", type: "application/pdf", text: "%PDF-1.4" });
  await expect(page.locator(".toast")).toContainText("Not a picture");
  await expect(page.getByTestId("logo-state")).toHaveText("None");
});

// The closing walk (step 15), on a shared project, each edit saved before the next, as a person works.

const newName = (what: string): string => `${what} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;

/** A shared project with a 5 x 4 m room and `layouts` layouts, its sheets view open. */
async function openShared(page: Page, name: string, layouts: number): Promise<void> {
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await openProject(page, name);
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await page.keyboard.press("w");
  const corners = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }];
  for (const [i, p] of corners.entries()) {
    await clickAt(page, canvas, p);
    if (i > 0) await expect.poll(async () => Object.keys((await storedDocument(name)).walls).length).toBe(i);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitSaved(page);
  for (let i = 1; i < layouts; i++) {
    await page.getByTestId("state-add").click();
    await waitSaved(page);
  }
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(layouts);
}

async function addSheet(page: Page, kind: "plan" | "compare" | "cover" | "report"): Promise<void> {
  await page.getByTestId("sheets-add").click();
  await page.getByTestId("sheets-add-menu").locator(`[data-kind="${kind}"]`).click();
  await waitSaved(page);
}

/** What poppler reads in a file: its info, and one page's text. */
const poppler = async (tool: "pdfinfo" | "pdftotext", args: string[]): Promise<string> => (await promisify(execFile)(tool, args)).stdout;

test("the walk: a detail at 1:20 dragged and undone, a compare of three, north, a cover and a report, read back from the saved PDF", async ({ page }) => {
  test.setTimeout(120_000);
  const name = newName("Walk");
  await openShared(page, name, 3);
  const titled = async (title: string) => Object.values((await storedDocument(name)).sheets).find((s) => s.title === title);
  const picked = page.locator(".sheets-sheet.picked");

  // A detail plan at 1:20: part of the plan on A4, a note and no error.
  await addSheet(page, "plan");
  await page.getByTestId("sheet-title").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Bedroom detail");
  await page.keyboard.press("Enter");
  await waitSaved(page);
  await scaleChoice(page, "1:20").click();
  await waitSaved(page);
  const detail = page.locator(`${ROW}[aria-selected="true"]`);
  await expect(detail.locator(".sheets-row-title")).toHaveText("Bedroom detail");
  await expect(detail.locator(".sheets-row-sub b")).toHaveText("1:20");
  await expect(page.getByTestId("sheet-note")).toContainText("Shows part of the plan");
  await expect(page.getByTestId("sheets-save-pdf")).toBeEnabled();

  // Drag it: stored in metres on release, the plan following the pointer. 60 px right moves the frame's centre left.
  const frame = picked.getByTestId("sheet-frame");
  await frame.scrollIntoViewIfNeeded();
  const box = await frame.boundingBox();
  const canvasBox = await picked.getByTestId("sheet-canvas").boundingBox();
  if (!box || !canvasBox) throw new Error("no frame");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("sheet-centre")).toBeEnabled();
  await waitSaved(page);
  const metres = (px: number): number => (px / (canvasBox.width / 297)) * 0.02; // A4 landscape, 1:20
  const dragged = await titled("Bedroom detail");
  expect(dragged?.cx).toBeCloseTo(-metres(60), 1);
  expect(dragged?.cy).toBeCloseTo(metres(30), 1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("sheet-centre")).toBeDisabled();
  await waitSaved(page);
  expect(await titled("Bedroom detail")).toMatchObject({ cx: 0, cy: 0, scale: 20 }); // the drag alone

  // A compare of all three layouts.
  await addSheet(page, "compare");
  await page.getByTestId("sheet-pane").nth(2).click();
  await expect(picked.getByTestId("sheet-frame")).toHaveCount(3);
  await waitSaved(page);
  await expect(page.getByTestId("sheet-title")).toHaveValue("Layout, Layout 2 and Layout 3");

  // North, typed.
  await northSwitch(page).click();
  await waitSaved(page);
  await northField(page).fill("30");
  await northField(page).press("Enter");
  await expectNorth(page, 30);
  await waitSaved(page);

  // A cover and a report, written in its box.
  await addSheet(page, "cover");
  await expect(page.getByTestId("sheets-settings").getByRole("heading", { name: "Cover sheet" })).toBeVisible();
  await page.getByTestId("sheets-add").click();
  await page.getByTestId("sheets-add-menu").locator('[data-kind="report"]').click();
  await expect(reportBox(page)).toHaveValue(DEFAULT_TEXT);
  await waitSaved(page);
  await typeAll(page, "# Site report\n\n## Approach\n\nThe **walls** stay and the *doors* move.");
  await page.keyboard.press("Tab");
  await waitSaved(page);
  expect((await titled("Project report"))?.text).toContain("**walls**");

  // The file: seven A4 pages, each sheet where the list put it. Cover and compare carry the arrow, the report doesn't.
  await expect(page.getByTestId("sheet-row")).toHaveCount(7);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  const path = await download.path();
  const info = await poppler("pdfinfo", [path]);
  expect(info).toMatch(/Pages:\s+7\b/);
  expect(info).toMatch(/Page size:\s+841\.89 x 595\.28 pts \(A4\)/);
  const textOf = (n: number): Promise<string> => poppler("pdftotext", ["-f", String(n), "-l", String(n), "-layout", path, "-"]);
  const pages = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(textOf));
  // The cover went first and the report below it (sheetset.70), then the plans.
  expect(pages[3]).toContain("BEDROOM DETAIL · scale 1:20");
  expect(pages[3]).toContain("Sheet 04 / 07");
  expect(pages[4]).toContain("Sheet 05 / 07");
  for (const layout of ["LAYOUT", "LAYOUT 2", "LAYOUT 3"]) expect(pages[4]?.toUpperCase()).toContain(layout);
  expect(pages[0]).toContain("SHEET INDEX");
  expect(pages[1]).toContain("Site report");
  expect(pages[1]).toContain("APPROACH");
  expect(pages[1]).toContain("The walls stay and the doors move."); // marks read, none printed
  expect(pages[1]).toContain("Sheet 02 / 07");
  expect(pages[6]).toContain("Sheet 07 / 07");
  const arrow = /(^|\s)N(\s|$)/m; // its N, alone
  for (const i of [0, 2, 3, 4, 5, 6]) expect(pages[i], `the arrow's N on page ${i + 1}`).toMatch(arrow);
  expect(pages[1]).not.toMatch(arrow);

  // PNG and SVG of the plan stay available from a list that's now stored (from the view on a fresh drawing: export.spec.ts).
  for (const [format, head] of [["png", "\x89PNG"], ["svg", "<svg"]] as const) {
    await page.getByTestId("images-button").click();
    const [image] = await Promise.all([page.waitForEvent("download"), page.locator(`[data-format="${format}"]`).click()]);
    expect(image.suggestedFilename()).toBe(`${name}.${format}`);
    expect((await readFile(await image.path())).toString("latin1").startsWith(head)).toBe(true);
  }
  await deleteProjects([name]);
});

test("a second browser sees a reorder, by Alt + arrows and by drag, its numbers and pages following, and its undo", async ({ page, browser }) => {
  const name = newName("Reorder");
  await openShared(page, name, 3);
  const context = await browser.newContext();
  const bob = await context.newPage();
  await bob.goto(`/?name=Bob&server=${encodeURIComponent(SERVER)}`);
  await openProject(bob, name);
  await expect(bob.getByTestId("export-button")).toBeEnabled();
  await bob.getByTestId("export-button").click();
  const rows = (p: Page) => p.getByTestId("sheet-row").locator(".sheets-row-title").allTextContents();
  const pages = (p: Page) => p.locator(".sheets-sheet .sheets-title").allTextContents();
  const [ONE, TWO, THREE] = ["Layout", "Layout 2", "Layout 3"];
  await expect.poll(() => rows(bob)).toEqual([ONE, TWO, THREE]);
  await expect.poll(() => pages(bob)).toEqual([ONE, TWO, THREE]);

  await page.getByTestId("sheet-row").first().focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => rows(page)).toEqual([TWO, ONE, THREE]);
  await waitSaved(page);
  await expect.poll(() => rows(bob)).toEqual([TWO, ONE, THREE]);
  await expect.poll(() => pages(bob)).toEqual([TWO, ONE, THREE]);
  await expect(bob.getByTestId("sheet-row").first()).toContainText("01");
  await expect(bob.getByTestId("sheet-row").nth(1)).toContainText("02");
  await expect(bob.getByTestId("sheet-row").first().locator(".sheets-row-title")).toHaveText(TWO);

  const [first, , last] = await rowIds(page);
  if (first === undefined || last === undefined) throw new Error("no rows");
  await dragRow(page, last, first, 0.2);
  await page.mouse.up();
  await expect.poll(() => rows(page)).toEqual([THREE, TWO, ONE]);
  await waitSaved(page);
  await expect.poll(() => rows(bob)).toEqual([THREE, TWO, ONE]);

  await page.keyboard.press("ControlOrMeta+z");
  await waitSaved(page);
  await expect.poll(() => rows(bob)).toEqual([TWO, ONE, THREE]);
  await context.close();
  await deleteProjects([name]);
});

// The rest of what only unit tests held (step 15): AC-02, AC-03, AC-10, AC-12 and AC-13 by hand, in a browser and a file.

const titlesOf = (p: Page) => p.getByTestId("sheet-row").locator(".sheets-row-title").allTextContents();

test("a stored list: a new layout adds none and offers one; deleting a layout takes its sheets in one undo, and a compare left with one pane is a plan (AC-02)", async ({ page }) => {
  await openList(page, 2);
  await page.getByTestId("sheets-add").click();
  await page.getByTestId("sheets-add-menu").locator('[data-kind="compare"]').click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  const before = await titlesOf(page);
  const compare = page.locator(`${ROW}[aria-selected="true"]`);
  await expect(compare).toContainText("Compare");
  await expect(page.getByText("has no sheet")).toHaveCount(0);

  // A new layout: no sheet by itself, the list offers it, and the offer is one undoable step.
  await page.getByTestId("sheets-close").click();
  await page.getByTestId("state-add").click();
  await page.getByTestId("export-button").click();
  expect(await titlesOf(page)).toEqual(before);
  const offer = page.getByText("Layout 3 has no sheet");
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(4);
  await expect(page.getByText("has no sheet")).toHaveCount(0);
  await page.locator('[data-action="sheets-undo"]').click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  await expect(offer).toBeVisible();

  // Deleting the second layout: its plan goes, and the compare keeps one pane, so it's a plan.
  await page.getByTestId("sheets-close").click();
  await page.getByRole("button", { name: "Layout 2", exact: true }).click();
  await page.getByTestId("state-menu-button").click();
  await page.getByTestId("state-menu-delete").click();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(2);
  await expect(page.locator(ROW).filter({ hasText: "Compare" })).toHaveCount(0);
  await expect(page.getByTestId("sheet-pane")).toHaveCount(0);

  // One undo brings the layout, its plan and the compare's pane back.
  await page.locator('[data-action="sheets-undo"]').click();
  await expect.poll(() => titlesOf(page)).toEqual(before);
  await expect(page.locator(ROW).filter({ hasText: "Compare" })).toHaveCount(1);
});

test("a second browser sees each change to the list, and each undoes and redoes as one step, by keys and by the top bar (AC-03)", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const name = newName("Each change");
  await openShared(page, name, 2);
  const context = await browser.newContext();
  const bob = await context.newPage();
  await bob.goto(`/?name=Bob&server=${encodeURIComponent(SERVER)}`);
  await openProject(bob, name);
  await expect(bob.getByTestId("export-button")).toBeEnabled();
  await bob.getByTestId("export-button").click();
  await expect.poll(() => titlesOf(bob)).toEqual(["Layout", "Layout 2"]);
  const undo = page.locator('[data-action="sheets-undo"]');
  const redo = page.locator('[data-action="sheets-redo"]');

  const change = async (action: () => Promise<void>, seen: (p: Page) => Promise<unknown>, expected: unknown): Promise<void> => {
    const before = await seen(bob);
    await action();
    await waitSaved(page);
    await expect.poll(() => seen(bob)).toEqual(expected);
    await page.keyboard.press("ControlOrMeta+z");
    await waitSaved(page);
    await expect.poll(() => seen(bob)).toEqual(before);
    await redo.click();
    await waitSaved(page);
    await expect.poll(() => seen(bob)).toEqual(expected);
    await undo.click();
    await waitSaved(page);
    await expect.poll(() => seen(bob)).toEqual(before);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitSaved(page);
    await expect.poll(() => seen(bob)).toEqual(expected);
  };
  const plan = page.getByTestId("sheet-row").nth(1); // the cover goes first

  await change(() => addSheet(page, "cover"), titlesOf, ["Layout cover", "Layout", "Layout 2"]);
  await plan.click();
  await change(() => plan.getByRole("button", { name: "Duplicate Layout" }).click(), titlesOf, ["Layout cover", "Layout", "Layout copy", "Layout 2"]);
  await plan.click();
  await change(
    async () => {
      await page.getByTestId("sheet-title").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Ground floor");
      await page.keyboard.press("Enter");
    },
    titlesOf,
    ["Layout cover", "Ground floor", "Layout copy", "Layout 2"],
  );
  // The tick: Bob's numbers close up.
  const subs = (p: Page) => p.getByTestId("sheet-row").locator(".sheets-row-sub").allTextContents();
  const unticked = (await subs(bob)).map((s, i) => (i === 1 ? expect.stringContaining("Not in PDF") : expect.stringContaining(`0${Math.max(i, 1)} ·`)));
  await change(() => plan.getByRole("checkbox").click(), subs, unticked);
  // Delete, from the row's own key.
  await change(
    async () => {
      await plan.focus();
      await page.keyboard.press("Delete");
    },
    titlesOf,
    ["Layout cover", "Layout copy", "Layout 2"],
  );
  await context.close();
  await deleteProjects([name]);
});

test("no north, no arrow and no N in the file; set, an N on each page with a plan and none on a report (AC-10)", async ({ page }) => {
  await openList(page, 1);
  await page.getByTestId("sheets-add").click();
  await page.getByTestId("sheets-add-menu").locator('[data-kind="cover"]').click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(2);
  await addReport(page);
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  const ns = (pdf: string): number => (pdf.match(/\(N\) Tj/g) ?? []).length;
  const none = await savedPdf(page);
  expect(none.match(/\/Type \/Page\b/g)).toHaveLength(3);
  expect(ns(none)).toBe(0);

  await northSwitch(page).click();
  await expectNorth(page, 0);
  expect(ns(await savedPdf(page))).toBe(2);
});

test("the checkbox holds its place on a hovered or selected row, and the selected page has the ring (AC-12)", async ({ page }) => {
  await openList(page, 2);
  const tick = row(page, SECOND).getByRole("checkbox");
  const x = async (): Promise<number | undefined> => (await tick.boundingBox())?.x;
  const resting = await x();
  await row(page, SECOND).hover();
  expect(await x()).toBe(resting);
  await row(page, SECOND).click();
  await expect(row(page, SECOND)).toHaveAttribute("aria-selected", "true");
  expect(await x()).toBe(resting);
  await expect(sheetOnDesk(page, SECOND).getByTestId("sheet-canvas")).toHaveCSS("box-shadow", /0px 0px 0px 7px/);
  await expect(sheetOnDesk(page, FIRST).getByTestId("sheet-canvas")).not.toHaveCSS("box-shadow", /0px 0px 0px 7px/);
});

test("studio details and a logo set by one browser print the same in another's PDF (AC-13)", async ({ page, browser }) => {
  const name = newName("Studio");
  const fixed = new Date("2031-02-03T12:00:00Z");
  await page.clock.setFixedTime(fixed);
  await openShared(page, name, 1);
  await page.keyboard.press("Escape");
  await openSection(page.getByTestId("project-section"));
  const box = page.getByTestId("project-section").locator('[data-field-id="project.studioName"]');
  await box.fill("Atelier Bruni");
  await box.press("Enter");
  await waitSaved(page);
  await chooseLogo(page, LOGO);
  await expect(page.getByTestId("logo-state")).toHaveText("Set");
  await waitSaved(page);
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(1);

  const context = await browser.newContext();
  const bob = await context.newPage();
  await bob.clock.setFixedTime(fixed);
  await bob.goto(`/?name=Bob&server=${encodeURIComponent(SERVER)}`);
  await openProject(bob, name);
  await expect(bob.getByTestId("export-button")).toBeEnabled();
  await bob.getByTestId("export-button").click();
  await expect(bob.getByTestId("sheet-row")).toHaveCount(1);

  const hers = await savedPdf(page);
  const his = await savedPdf(bob);
  expect(hers).toContain("Atelier Bruni");
  expect(hers).toContain("/Subtype /Image");
  expect(his.includes("/Subtype /Image"), "his has the logo").toBe(true);
  expect(his === hers, "the same bytes").toBe(true); // not toBe(hers): its diff of two whole files stops the run with no message
  await context.close();
  await deleteProjects([name]);
});
