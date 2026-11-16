import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CARD_COLOURS } from "@fm/editor";
import { canvasOf } from "./support/app-driver";
import { drawRectRoom } from "./support/canvas";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";
import { copyStudio, withSurroundings } from "./support/studio-copy";

// The project cards (cycle cards) in a browser: the plan on its coloured grid, 3D on hover, a drag to turn, a click to open,
// the layout pill, delete, the order and the plan-only cases. The seeded Studio has two layouts, Day and Night.

const FADE_MS = 300; // past the 0.18 s fade between the plan and 3D

let projects: string[] = [];
let contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

const STUDIO = "Studio";
const home = (who = "Alice"): string => `/?name=${who}&server=${encodeURIComponent(SERVER)}`;
const card = (page: Page, name: string): Locator => page.locator(".project-card").filter({ has: page.getByRole("button", { name, exact: true }) });
const ground = (page: Page, name: string): Locator => card(page, name).locator(".project-card-ground");
const shot = async (l: Locator): Promise<Buffer> => l.screenshot();

/** The share of pixels that differ between two screenshots. An image redrawn after its fade antialiases a little differently, so exact bytes mislead. */
async function difference(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(async ([x, y]) => {
    const pixels = async (b64: string): Promise<ImageData> => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      if (c === null) throw new Error("no 2D context");
      c.drawImage(bitmap, 0, 0);
      return c.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [p, q] = [await pixels(x ?? ""), await pixels(y ?? "")];
    let changed = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      if (Math.abs((p.data[i] ?? 0) - (q.data[i] ?? 0)) + Math.abs((p.data[i + 1] ?? 0) - (q.data[i + 1] ?? 0)) + Math.abs((p.data[i + 2] ?? 0) - (q.data[i + 2] ?? 0)) > 24) changed++;
    }
    return changed / (p.width * p.height);
  }, [a.toString("base64"), b.toString("base64")]);
}
const SAME = 0.01; // under this share of pixels it's the same picture

async function list(page: Page, name = STUDIO): Promise<void> {
  await page.goto(home());
  await ground(page, name).scrollIntoViewIfNeeded(); // a card fetches its drawing once it's in view, and a long list starts elsewhere
  await expect(ground(page, name).locator("img")).toBeVisible();
  await expect.poll(() => ground(page, name).locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
}

async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

async function hover(page: Page, name = STUDIO): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await box(ground(page, name));
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.6);
  await expect(ground(page, name).locator("canvas")).toHaveCount(1);
  await page.waitForTimeout(FADE_MS);
  return b;
}

/** A drag from the card's left part, in many small moves as a hand makes them. */
async function drag(page: Page, b: { x: number; y: number; width: number; height: number }, dx: number, dy = 0): Promise<void> {
  const [x, y] = [b.x + b.width * 0.3, b.y + b.height * 0.6];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function newProject(page: Page, name: string): Promise<void> {
  await page.goto(home());
  await page.getByPlaceholder("Project name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(name);
}

test("a card shows its name and plan on a palette colour (AC-01, AC-02)", async ({ page }) => {
  await list(page);
  await expect(card(page, STUDIO).getByRole("button", { name: STUDIO, exact: true })).toBeVisible();
  const colour = await ground(page, STUDIO).evaluate((g) => {
    const c = document.createElement("canvas").getContext("2d");
    if (c === null) throw new Error("no 2D context");
    c.fillStyle = getComputedStyle(g).backgroundColor;
    return c.fillStyle;
  });
  expect(CARD_COLOURS).toContain(colour);
  await expect(card(page, STUDIO).locator("img")).toHaveAttribute("alt", `Plan of ${STUDIO}`);
});

test("only the cards in view fetch their drawing, once (AC-13)", async ({ page }) => {
  const stamp = Date.now();
  for (let i = 0; i < 6; i++) {
    projects.push(`Zz ${stamp} ${i}`);
    await newProject(page, `Zz ${stamp} ${i}`);
  }
  const reads: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => {
    if (typeof f.payload === "string" && f.payload.includes('"readProject"')) reads.push(JSON.parse(f.payload).projectId);
  }));
  await page.setViewportSize({ width: 1000, height: 320 }); // about one row of cards
  await page.goto(home());
  await expect(page.locator(".project-card").first()).toBeVisible();
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const total = await page.locator(".project-card").count();
  expect(total).toBeGreaterThanOrEqual(6);
  expect(reads.length).toBeLessThan(total);
  expect(new Set(reads).size).toBe(reads.length);
  const before = reads.length;
  await page.locator(".project-card").last().scrollIntoViewIfNeeded();
  await expect.poll(() => reads.length).toBeGreaterThan(before); // scrolling fetches the ones coming into view
  expect(new Set(reads).size).toBe(reads.length);
});

test("hover shows 3D standing still; a drag turns it; leaving shows the plan (AC-05, AC-06, AC-07)", async ({ page }) => {
  await list(page);
  const g = ground(page, STUDIO);
  await expect(g).toHaveCSS("cursor", "grab");
  await expect(g.locator("canvas")).toHaveCount(0);
  const plan = await shot(g);

  const b = await hover(page);
  const still = await shot(g);
  expect(await difference(page, still, plan)).toBeGreaterThan(SAME);

  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.4, { steps: 10 }); // moving without pressing
  await page.waitForTimeout(100);
  expect(await difference(page, await shot(g), still)).toBeLessThan(SAME);

  const [x, y] = [b.x + b.width * 0.3, b.y + b.height * 0.6];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 20 });
  await expect(g).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(b.x - 40, y + 100, { steps: 5 }); // the drag carries on outside the card
  await expect(g.locator("canvas")).toHaveCount(1);
  await page.mouse.move(x + 60, y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const turned = await shot(g);
  expect(await difference(page, turned, still)).toBeGreaterThan(SAME);

  await page.mouse.move(b.x + b.width * 0.5, y, { steps: 3 }); // the angle stays while on the card
  await page.waitForTimeout(100);
  expect(await difference(page, await shot(g), turned)).toBeLessThan(SAME);

  await page.mouse.move(2, 2);
  await expect(g.locator("canvas")).toHaveCount(0);
  await page.waitForTimeout(FADE_MS);
  expect(await difference(page, await shot(g), plan)).toBeLessThan(SAME);

  await hover(page); // the next hover starts at the default angles
  expect(await difference(page, await shot(g), still)).toBeLessThan(SAME);
});

/**
 * In a screenshot of a card's ground: the shares of pixels within 10 per channel of the trailer's steel (the palette's
 * dark slot) and of the grass (On wheels' ground), as the mock-up has them, not read from the code; and the pixel at the
 * left edge's middle, 2 % in: inside the rounded card, and outside the 3D picture's centred square (1.2 card heights
 * wide on a card 1.33 heights wide), so it shows only the canvas's clear colour over the card's grid.
 */
async function steelAndCorner(page: Page, png: Buffer): Promise<{ steel: number; grass: number; corner: number[] }> {
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
    if (c === null) throw new Error("no 2D context");
    c.drawImage(bitmap, 0, 0);
    const { data, width, height } = c.getImageData(0, 0, bitmap.width, bitmap.height);
    const steels = [[0x4d, 0x49, 0x45], [0x45, 0x41, 0x3d], [0x3c, 0x39, 0x35]];
    const near = (i: number, c: number[]): boolean => c.every((v, k) => Math.abs((data[i + k] ?? 0) - v) <= 10);
    let [steel, grass] = [0, 0];
    for (let i = 0; i < data.length; i += 4) {
      if (steels.some((s) => near(i, s))) steel++;
      if (near(i, [0xb9, 0xc9, 0xa3])) grass++;
    }
    const at = (Math.floor(height / 2) * width + Math.floor(width * 0.02)) * 4;
    return { steel: steel / (width * height), grass: grass / (width * height), corner: [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0] };
  }, png.toString("base64"));
}

test("a card on wheels shows its trailer over its own grid, with no ground or sky (surroundings AC-07)", async ({ page }) => {
  const [wheels, none] = [`Studio card wheels ${Date.now()}`, `Studio card none ${Date.now()}`];
  await copyStudio(wheels, withSurroundings("wheels"));
  await copyStudio(none, withSurroundings(null));
  projects.push(wheels, none);
  type Read = Awaited<ReturnType<typeof steelAndCorner>>;
  const read = async (name: string): Promise<{ rest: Read; hovered: Read }> => {
    await list(page, name);
    const rest = await steelAndCorner(page, await shot(ground(page, name)));
    await hover(page, name);
    const hovered = await steelAndCorner(page, await shot(ground(page, name)));
    await page.mouse.move(2, 2);
    await expect(ground(page, name).locator("canvas")).toHaveCount(0);
    return { rest, hovered };
  };
  const [w, n] = [await read(wheels), await read(none)];
  console.log(`\nsteel share: wheels ${w.hovered.steel.toFixed(4)}, none ${n.hovered.steel.toFixed(4)}; grass ${w.hovered.grass.toFixed(4)}; wheels corner ${w.rest.corner.join(",")} → ${w.hovered.corner.join(",")}\n`);
  // The deck, wheels and drawbar: a steel strip the None card hasn't got; and no grass round it.
  expect(w.hovered.steel).toBeGreaterThan(n.hovered.steel + 0.007);
  expect(w.hovered.grass).toBeLessThan(0.001);
  // The canvas stays clear over the card's own grid: the edge pixel is the card's, not the sky or white.
  expect(w.hovered.corner.map((v, k) => Math.abs(v - (w.rest.corner[k] ?? 0))).every((d) => d <= 2), `corner ${w.hovered.corner.join(",")} against ${w.rest.corner.join(",")}`).toBe(true);
  for (const bg of [[0xee, 0xf3, 0xf5], [0xff, 0xff, 0xff]]) expect(w.hovered.corner.every((v, k) => Math.abs(v - (bg[k] ?? 0)) <= 2)).toBe(false);
});

test("a click opens the project, a drag doesn't, and neither do the pill or Delete (AC-08)", async ({ page }) => {
  await list(page);
  const b = await hover(page);
  await drag(page, b, 30);
  await expect(page.getByTestId("project-list")).toBeVisible();

  await card(page, STUDIO).locator(".project-card-pill").click();
  await expect(page.getByTestId("project-list")).toBeVisible();

  await card(page, STUDIO).locator(".project-delete").click();
  await expect(page.getByTestId("project-list")).toBeVisible();
  await card(page, STUDIO).getByRole("button", { name: "Cancel" }).click();

  const g = ground(page, STUDIO);
  const at = await box(g);
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 2, at.y + at.height / 2); // a shaky click
  await page.mouse.up();
  await expect(page.getByTestId("project-name")).toHaveText(STUDIO);
});

test("nothing floats over the list to block a card (AC-08)", async ({ page }) => {
  await list(page);
  await expect(page.getByTestId("canvas-corner")).toHaveCount(0);
});

test("clicking the name opens the project too (AC-08)", async ({ page }) => {
  await list(page);
  await card(page, STUDIO).getByRole("button", { name: STUDIO, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(STUDIO);
});

test("the pill moves through the layouts, gliding in 3D and keeping the angle (AC-09)", async ({ page }) => {
  await list(page);
  const pill = card(page, STUDIO).locator(".project-card-pill");
  await expect(pill).toContainText("Day");
  const g = ground(page, STUDIO);
  const dayPlan = await shot(g);

  const b = await hover(page);
  await drag(page, b, 40);
  const dayTurned = await shot(g);
  await pill.click();
  await expect(pill).toContainText("Night");
  await page.waitForTimeout(700);
  const nightTurned = await shot(g);
  expect(await difference(page, nightTurned, dayTurned)).toBeGreaterThan(SAME);
  await expect(page.getByTestId("project-list")).toBeVisible();

  await page.mouse.move(2, 2);
  await expect(g.locator("canvas")).toHaveCount(0);
  await page.waitForTimeout(FADE_MS);
  await expect(pill).toContainText("Night"); // the choice survives leaving the card
  expect(await difference(page, await shot(g), dayPlan)).toBeGreaterThan(SAME);

  await pill.click(); // the plan at rest changes at once, and wraps
  await expect(pill).toContainText("Day");
  await page.mouse.move(2, 2);
  await page.waitForTimeout(FADE_MS);
  expect(await difference(page, await shot(g), dayPlan)).toBeLessThan(SAME);

  await page.reload(); // and it resets when the list opens again
  await ground(page, STUDIO).scrollIntoViewIfNeeded();
  await expect(card(page, STUDIO).locator(".project-card-pill")).toContainText("Day");
});

test("Delete asks in place; a project with nothing drawn says so (AC-04, AC-10)", async ({ page }) => {
  const name = `Bare ${Date.now()}`;
  await newProject(page, name);
  await page.goto(home());
  const c = card(page, name);
  await expect(c).toContainText("Nothing drawn yet");
  await expect(c.locator(".project-card-pill")).toHaveCount(0);
  await expect(ground(page, name)).toHaveCSS("cursor", "pointer");
  await c.locator(".project-delete").click();
  await expect(page.locator(".project-card-ask")).toContainText("Anyone who has it open");
  await page.locator(".project-card-ask").getByRole("button", { name: "Cancel" }).click();
  await expect(c).toBeVisible();
  await c.locator(".project-delete").click();
  await page.locator(`[data-confirm-delete]`).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});

test("an edit shows on the card the next time the list opens (AC-10)", async ({ browser, page }) => {
  const name = `Edited ${Date.now()}`;
  projects.push(name);
  await page.goto(home("Bob"));
  const aliceContext = await browser.newContext();
  contexts.push(aliceContext);
  const alice = await aliceContext.newPage();
  await newProject(alice, name);
  await page.reload();
  await expect(card(page, name)).toContainText("Nothing drawn yet");

  await drawRectRoom(alice, canvasOf(alice), 6, 4);
  await expect(alice.getByTestId("project-status")).toHaveText("saved");

  await expect(card(page, name)).toContainText("Nothing drawn yet"); // no live updates on the list
  await page.reload();
  await ground(page, name).scrollIntoViewIfNeeded();
  await expect(ground(page, name).locator("img")).toBeVisible();
  await expect(card(page, name)).not.toContainText("Nothing drawn yet");
});

test("the order: Name by default, Recent puts the last edited first, and a reload keeps it (AC-15)", async ({ page }) => {
  const name = `Aaa ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(home());
  await expect(page.getByRole("button", { name: "Name", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Recent" }).click();
  projects.push(name);
  await newProject(page, name);
  await page.goto(home());
  await expect(page.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible(); // the order button shows before the list arrives (clarity.40)
  const recent = await page.locator(".project-open").allTextContents();
  expect(recent.indexOf(name)).toBeLessThan(recent.indexOf(STUDIO)); // other specs may be saving their own projects meanwhile
  await page.getByRole("button", { name: "Name", exact: true }).click();
  const names = await page.locator(".project-open").allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  await page.reload();
  await expect(page.getByRole("button", { name: "Name", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("the keyboard reaches every control, and Enter works each (AC-11)", async ({ page }) => {
  await list(page);
  const pill = card(page, STUDIO).locator(".project-card-pill");
  await pill.focus();
  await page.keyboard.press("Enter");
  await expect(pill).toContainText("Night");
  await expect(card(page, STUDIO).locator("canvas")).toHaveCount(0); // the keyboard sees the plan
  const del = card(page, STUDIO).locator(".project-delete");
  await del.focus();
  await expect(del).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await card(page, STUDIO).getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  await card(page, STUDIO).getByRole("button", { name: STUDIO, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("project-name")).toHaveText(STUDIO);
});

test("without WebGL2 a card stays on its plan and still opens (AC-11)", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === "webgl2" ? null : Reflect.apply(original, this, [type, ...rest]);
    } as typeof original;
  });
  await list(page);
  const g = ground(page, STUDIO);
  const at = await box(g);
  await page.mouse.move(at.x + 60, at.y + 60);
  await page.waitForTimeout(FADE_MS);
  await expect(g.locator("canvas")).toHaveCount(0);
  await expect(g.locator("img")).toHaveCSS("opacity", "1");
  await expect(g).toHaveCSS("cursor", "pointer");
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("project-name")).toHaveText(STUDIO);
});
