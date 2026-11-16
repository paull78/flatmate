import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { isRecord } from "@fm/protocol";
import { clickAt, dragFromTo, moveTo, toScreen, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { distance, pixelAt } from "./support/pixels";
import { deleteProjects, storedDocument } from "./support/stored";
import { expectNoToast, toast } from "./support/toasts";
import { SERVER } from "./support/server";
import { card, showGroup } from "./support/palette";

// Stairs in a real browser (stairs AC-01, AC-02, AC-03, AC-05, AC-11): a storage stair dropped by the loft's edge turns
// its back to it and, linked by the Reaches picker (touching links nothing, stairdraw.08), reaches it, drawn broken at the floor's cut and whole at the loft; it is in a new layout at the
// same place; Properties shows its 10 risers and Fit run sets its run; a desk slid toward an open stair's bottom step
// is refused with both heights. Server mode; the room and the loft are seeded through a real stdio MCP process.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 8, y: -1 }; // keeps the pointer and its hover off the probes

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

/** A fresh project name; the suffix keeps names apart when repeats run in parallel workers. */
function newProject(): string {
  const name = `zz-stairs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(name);
  return name;
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`${what} is not a string`);
  return v;
};
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number") throw new Error(`${what} is not a number`);
  return v;
};

// ---- the project ---------------------------------------------------------------------------------------------------

// A 6 × 5 room (inner faces x 0.1 / 5.9, y 0.1 / 4.9) under a 3.20 ceiling, so the floor is cut at 1.20; a loft
// (2.03–2.15) along its west side, x 0.1–1.6, its east edge at x 1.6 facing the room. A stair against that edge turns
// to 90° (its front facing +x) and runs from its back at x 1.6 to its front at 1.6 + run.
const LOFT_EDGE = 1.6;

type Seeded = { project: string; loft: string };
/** `reachesLoft`: placed linked to the loft (links are explicit, stairdraw.08). */
type Seed = { kind: string; at: WorldPoint; rotation: number; reachesLoft?: boolean };

/** The room, the ceiling, the loft and `pieces` (centres, rotations) in a new project, over MCP; answers the loft's id. */
async function seedOverMcp(project: string, pieces: readonly Seed[]): Promise<string> {
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 5 });
    await claude.call("set_ceiling", { height: 3.2 });
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 0.85, y: 2.5 }, width: 1.5, depth: 4.8 });
    const loft = isRecord(added) && isRecord(added.result) ? str(added.result.deck, "deck id") : "";
    for (const p of pieces) await claude.call("place_object", { layout: "s0", kind: p.kind, centre: p.at, rotation: p.rotation, ...(p.reachesLoft === true ? { reaches: loft } : {}) });
    return loft;
  } finally {
    claude.close();
  }
}

/** Seeds the project over MCP, then opens it in a new page. */
async function seed(browser: Browser, pieces: readonly Seed[] = []): Promise<Seeded & { page: Page }> {
  const project = newProject();
  const loft = await seedOverMcp(project, pieces);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  // The seeded project's own button, waited for: with its row missing, openProject would make a new one (graphics.12).
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return { page, project, loft };
}

type StoredStair = { object: string; state: string; at: WorldPoint; rotation: number; reaches: unknown; w: number; d: number; h: number };

/** Every stored placement of `kind`, with its object's link and sizes. */
async function storedOf(project: string, kind: string): Promise<StoredStair[]> {
  const doc = await storedDocument(project);
  return Object.values(doc.placements).flatMap((p): StoredStair[] => {
    const object = doc.objects[str(p.object, "placement.object")];
    if (object === undefined || object.kind !== kind || !isRecord(object.w) || !isRecord(object.d) || !isRecord(object.h) || !isRecord(p.at)) return [];
    const config = str(p.config, "placement.config");
    return [{
      object: str(p.object, "placement.object"),
      state: str(p.state, "placement.state"),
      at: { x: num(p.at.x, "at.x"), y: num(p.at.y, "at.y") },
      rotation: num(p.rotation, "placement.rotation"),
      reaches: object.reaches,
      w: num(object.w[config], "w"),
      d: num(object.d[config], "d"),
      h: num(object.h[config], "h"),
    }];
  });
}

/**
 * Picks the "Storage stair" tile in the palette's Stairs group and clicks the plan twice at `at`: near a deck's edge the
 * first click fixes the stair's top and the second places it (stairdraw.06); then back to Select.
 */
async function placeStorageStair(page: Page, at: WorldPoint): Promise<void> {
  await showGroup(page, "Stairs");
  const tile = card(page, "storageStair");
  await expect(tile.locator(".palette-card-name")).toHaveText("Storage stair");
  await tile.click();
  await clickAt(page, canvasOf(page), at);
  await clickAt(page, canvasOf(page), at);
  await waitSaved(page);
  await page.keyboard.press("Escape");
}

// The pointer in front of the loft's edge, inside its catch band: the stair hangs off the edge, its back on it, centred
// on the pointer's y, which sits on the 0.20 snap step (stairdraw.11).
const DROP = { x: LOFT_EDGE + 0.3 + 0.05, y: 2.6 };

/** The seeded loft with a storage stair drawn up to its edge through the palette, by the two-click gesture. */
async function loftWithStair(browser: Browser): Promise<Seeded & { page: Page; stair: StoredStair }> {
  const seeded = await seed(browser);
  const { page, project, loft } = seeded;
  await placeStorageStair(page, DROP);
  await expectNoToast(page);
  const [dropped, ...others] = await storedOf(project, "storageStair");
  expect(others).toEqual([]);
  if (dropped === undefined) throw new Error("no stair stored");
  expect(dropped.reaches).toBe(loft);
  await clickAt(page, canvasOf(page), AWAY); // nothing selected, so the probes read the plain fill
  const [stair] = await storedOf(project, "storageStair");
  if (stair === undefined) throw new Error("no stair stored");
  return { ...seeded, stair };
}

// ---- probes --------------------------------------------------------------------------------------------------------

/** The world point at footprint point (x across, y along the run; y −d the front edge, 0 the back edge) of `p`. */
function world(p: { at: WorldPoint; rotation: number }, x: number, y: number): WorldPoint {
  const r = (p.rotation * Math.PI) / 180;
  return { x: p.at.x + x * Math.cos(r) - y * Math.sin(r), y: p.at.y + x * Math.sin(r) + y * Math.cos(r) };
}

/** How far the probed colour is from the stair's fill below the cut (the furniture grey). */
const offFill = async (page: Page, p: WorldPoint): Promise<number> => distance(await pixelAt(page, canvasOf(page), p), COLORS.object);

/**
 * How many pixels along the tread line `a` metres from the front edge are gaps (lighter than any line ink), in two
 * spans across the flight that skip the walking line and the sides: 0 for a solid line, several for a dashed one.
 */
async function gapsAlong(page: Page, p: StoredStair, a: number): Promise<number> {
  const spans: [number, number][] = [[-p.w / 2 + 0.03, -0.04], [0.04, p.w / 2 - 0.03]];
  let gaps = 0;
  for (const [x0, x1] of spans) {
    const s0 = await toScreen(canvasOf(page), world(p, x0, -p.d + a));
    const s1 = await toScreen(canvasOf(page), world(p, x1, -p.d + a));
    // A box 7 px wide across the line, the run along screen x or y: each row (or column) along the line keeps its darkest pixel.
    const alongY = Math.abs(s1.y - s0.y) >= Math.abs(s1.x - s0.x);
    const [lo, hi] = alongY ? [Math.min(s0.y, s1.y), Math.max(s0.y, s1.y)] : [Math.min(s0.x, s1.x), Math.max(s0.x, s1.x)];
    const c = alongY ? s0.x : s0.y;
    const box = alongY
      ? { x: Math.round(c) - 3, y: Math.round(lo), width: 7, height: Math.round(hi - lo) }
      : { x: Math.round(lo), y: Math.round(c) - 3, width: Math.round(hi - lo), height: 7 };
    const darkest = await darkestAlong(page, box, alongY);
    gaps += darkest.filter((v) => v > 215).length;
  }
  return gaps;
}

/** The darkest channel-max per row (`alongY`) or per column of a page box, as the user sees it. */
async function darkestAlong(page: Page, box: { x: number; y: number; width: number; height: number }, alongY: boolean): Promise<number[]> {
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async ({ base64, alongY }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    const [n, m] = alongY ? [image.height, image.width] : [image.width, image.height];
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      let darkest = 255;
      for (let j = 0; j < m; j++) {
        const k = 4 * (alongY ? i * image.width + j : j * image.width + i);
        darkest = Math.min(darkest, Math.max(data[k] ?? 0, data[k + 1] ?? 0, data[k + 2] ?? 0));
      }
      out.push(darkest);
    }
    return out;
  }, { base64: png.toString("base64"), alongY });
}

// ---- the storage stair ---------------------------------------------------------------------------------------------

// A storage stair to the 2.15 loft: 10 risers of 0.215, run 1.99, going 0.221 (9 treads). At the floor the cut at
// 1.20 crosses the 6th tread (5 × 0.215 = 1.075 ≤ 1.20 < 1.29), so the flight is filled and solid up to the 6th
// tread's nosing, 5 × 0.221 = 1.105 from the front edge, and dashed past it (stairs.25).
const GOING = 0.221;
const BREAK = 5 * GOING;

test("a storage stair drawn up to the loft edge draws broken at the floor, whole at the loft (AC-01, AC-02)", async ({ browser }) => {
  const { page, loft, stair } = await loftWithStair(browser);
  // Its back turned to the edge and flush with it, linked to the loft by Reaches, its rise the loft's top.
  expect(stair).toMatchObject({ rotation: 90, reaches: loft, w: 0.6, h: 2.15 });
  expect(stair.d).toBeCloseTo(1.99, 2); // the recommended run for 2.15, to the millimetre
  expect(stair.at.x).toBeCloseTo(LOFT_EDGE, 6);
  expect(stair.at.y).toBeCloseTo(DROP.y, 6);

  // Probes 0.15 off the walking line, clear of the treads' lines and the grid's (every 0.20 m).
  const x = -0.15;
  const inside = world(stair, x, -stair.d + BREAK - 0.095); // just below the break, between the 5th and 6th nosings
  const beyond = world(stair, x, -stair.d + BREAK + 0.145); // just past it (the break line leans up to 0.07 either way)
  const level = (id: string) => page.locator(`[data-testid="level-strip"] button[data-level="${id}"]`);
  await moveTo(page, canvasOf(page), AWAY);

  // The floor: filled below the break, not past it; the 4th nosing solid, the 6th (past the break) dashed.
  await expect(level("floor")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cut-height")).toHaveText("Cut +1.20");
  await expect.poll(() => offFill(page, inside), { message: "filled just below the break" }).toBeLessThanOrEqual(4);
  expect(await offFill(page, beyond), "no fill just past the break").toBeGreaterThanOrEqual(12);
  expect(await gapsAlong(page, stair, 4 * GOING), "the 4th nosing solid").toBe(0);
  expect(await gapsAlong(page, stair, 6 * GOING), "the 6th nosing dashed").toBeGreaterThanOrEqual(4);

  // The loft: the whole flight filled and solid, from just inside its front edge to past the floor's break.
  await level(loft).click();
  await expect(level(loft)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => offFill(page, beyond), { message: "filled past the floor's break" }).toBeLessThanOrEqual(4);
  expect(await offFill(page, inside), "filled below it").toBeLessThanOrEqual(4);
  expect(await offFill(page, world(stair, x, -stair.d + 0.03)), "filled just inside the front edge").toBeLessThanOrEqual(4);
  expect(await offFill(page, world(stair, x, -stair.d - 0.04)), "not just beyond it").toBeGreaterThanOrEqual(12);
  expect(await gapsAlong(page, stair, 6 * GOING), "the 6th nosing solid").toBe(0);
  expect(await gapsAlong(page, stair, 8 * GOING), "the 8th nosing solid").toBe(0);
});

test("it is in a second layout at the same place (AC-05)", async ({ browser }) => {
  const { page, project, stair } = await loftWithStair(browser);
  await page.getByTestId("state-add").click(); // "Layout 2", a copy, becomes active
  await waitSaved(page);
  await expect(page.getByTestId("state-name")).toHaveValue("Layout 2");
  const states = Object.values((await storedDocument(project)).states);
  expect(states).toHaveLength(2);
  const copies = await storedOf(project, "storageStair");
  expect(copies.map((c) => c.state).sort()).toEqual(states.map((s) => str(s.id, "state id")).sort());
  for (const c of copies) {
    expect(c).toMatchObject({ rotation: stair.rotation, reaches: stair.reaches, w: stair.w, d: stair.d, h: stair.h });
    expect(c.at.x).toBeCloseTo(stair.at.x, 6);
    expect(c.at.y).toBeCloseTo(stair.at.y, 6);
  }
  // Drawn there in Layout 2: filled below the floor's break, its front edge where it was.
  await moveTo(page, canvasOf(page), AWAY);
  await expect.poll(() => offFill(page, world(stair, -0.15, -stair.d + 0.03)), { message: "filled just inside the front edge" }).toBeLessThanOrEqual(4);
  expect(await offFill(page, world(stair, -0.15, -stair.d - 0.04)), "not just beyond it").toBeGreaterThanOrEqual(12);
  expect(await offFill(page, world(stair, -0.15, -stair.d + BREAK + 0.145)), "no fill past the break").toBeGreaterThanOrEqual(12);
});

test("Properties shows 10 risers and Fit run sets the run (AC-11)", async ({ browser }) => {
  const { page, project, loft, stair } = await loftWithStair(browser);
  await clickAt(page, canvasOf(page), world(stair, -0.15, -0.4)); // on the flight, off the walking line
  const field = (id: string) => page.locator(`[data-field-id="${id}"]`);
  await expect(field("risers")).toHaveValue("10 × 0.215");
  await expect(field("going")).toHaveValue("0.221");
  await expect(field("depth")).toHaveValue("1.99");
  await expect(field("reaches")).toHaveValue(loft);
  await expect(field("rise")).toHaveAttribute("readonly", ""); // read-only while linked

  // A shorter run: the going shrinks under the loft formula's; Fit run offers 1.99 again and sets it.
  await field("depth").fill("1.50");
  await field("depth").press("Enter");
  await waitSaved(page);
  await expect(field("depth")).toHaveValue("1.50");
  await expect(field("risers")).toHaveValue("10 × 0.215");
  await expect(field("going")).toHaveValue("0.167");
  await expect(field("check.going")).toHaveAttribute("data-check", "warning");
  await expect(field("fitRun")).toHaveText("Use 1.99 m");
  await field("fitRun").click();
  await waitSaved(page);
  await expect(field("depth")).toHaveValue("1.99");
  await expect(field("going")).toHaveValue("0.221");
  await expect(field("check.going")).toHaveAttribute("data-check", "ok");
  const [fitted] = await storedOf(project, "storageStair");
  expect(fitted?.d ?? 0).toBeCloseTo(1.99, 2); // the loft formula's run to the millimetre, shown as 1.99
});

// ---- the open stair and the desk -----------------------------------------------------------------------------------

// An open stair (0.90 × 2.99, 12 risers of 0.179, going 0.272) against the loft's edge, y 2.05–2.95, its bottom step
// at x 4.59. Its underside a metres up the run from the front edge is 0.179 + a × 0.179 / 0.272 − 0.23. A desk turned
// 90° (0.60 along x, 1.20 along y, so it sticks out past the flight's sides) under its high end, x 1.70–2.30, fits
// (1.46 at its end nearest the bottom step); slid 0.60 down it still fits (1.06); 0.80 further its top (0.75) is over
// the underside there (0.54) and the move is refused.
const OPEN_RUN = 2.99;
const DESK = { x: 2.0, y: 2.5 };

test("a desk dragged down under an open stair is refused with both heights in the toast (AC-03)", async ({ browser }) => {
  const { page, project, loft } = await seed(browser, [
    { kind: "openStair", at: { x: LOFT_EDGE + OPEN_RUN / 2, y: DESK.y }, rotation: 90, reachesLoft: true },
    { kind: "desk", at: DESK, rotation: 90 },
  ]);
  const [open] = await storedOf(project, "openStair");
  expect(open).toMatchObject({ rotation: 90, reaches: loft, w: 0.9, d: OPEN_RUN, h: 2.15 });
  const deskAt = async (): Promise<WorldPoint> => {
    const [desk] = await storedOf(project, "desk");
    if (desk === undefined) throw new Error("no desk");
    return world(desk, 0, -desk.d / 2);
  };
  expect((await deskAt()).x).toBeCloseTo(DESK.x, 6);

  // Grabbed where it sticks out past the flight's north side, so the press picks the desk, not the stair, and off the
  // middle of its end, where a selected desk's width handle sits.
  const canvas = canvasOf(page);
  const grab = { x: DESK.x + 0.15, y: DESK.y + 0.5 };
  await dragFromTo(page, canvas, grab, { x: grab.x + 0.6, y: grab.y });
  await waitSaved(page);
  await expectNoToast(page);
  expect((await deskAt()).x).toBeCloseTo(DESK.x + 0.6, 6);

  await dragFromTo(page, canvas, { x: grab.x + 0.6, y: grab.y }, { x: grab.x + 1.4, y: grab.y });
  await expect(toast(page)).toBeVisible(); // a positive wait for it to show
  // Then read once: a retrying check on a transient toast could pass after it fades (levels.55).
  const [text, ...more] = await toast(page).allTextContents();
  expect(more).toEqual([]);
  const m = /^Desk \(0\.00–0\.75\) hits the open stair's underside \((\d+\.\d\d) at that end\) in \w+$/.exec(text ?? "");
  expect(m, `toast: ${text ?? "none"}`).not.toBeNull();
  const underside = Number(m?.[1]);
  expect(underside).toBeLessThan(0.75);
  expect(underside).toBeCloseTo(0.179 + ((4.59 - 3.7) * 0.179) / (OPEN_RUN / 11) - 0.23, 2);
  await waitSaved(page);
  expect((await deskAt()).x).toBeCloseTo(DESK.x + 0.6, 6); // nothing moved
});
