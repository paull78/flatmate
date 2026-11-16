import { expect, test, type Locator, type Page } from "@playwright/test";
import { SURROUNDINGS, type Bounds3, type Point3 } from "@fm/editor";
import { clickAt, drawRectRoom } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { angles3d, clearColour, drag3d, nearColour, offBy, panelPixels, projector3d, rgbOf } from "./support/probe3d";
import { SERVER } from "./support/server";
import { SEED } from "./support/studio-copy";

// The 3D panel's surroundings menu (surroundings.06, .15, AC-06): a native select in the header, listing the five,
// sending the drawing's setting with something selected too, and giving key focus back so Cmd+Z works straight after.

const SKY = "#eef3f5"; // Outside's background, from the approved mock-ups, not read from the code under test
const WHITE = "#ffffff"; // None's, as before this cycle
const canvasOf = (page: Page): Locator => page.getByTestId("canvas");
const menuOf = (page: Page): Locator => page.getByTestId("surroundings-menu");
const focused = (menu: Locator): Promise<boolean> => menu.evaluate((el) => el === document.activeElement);

/** A local room, 6 × 4 unless asked, with the 3D view open, in the corner or docked in split; its bottom wall selected if asked. */
async function room(page: Page, size: "corner" | "split", selected = false, [w, h] = [6, 4]): Promise<void> {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await drawRectRoom(page, canvasOf(page), w, h);
  if (selected) await clickAt(page, canvasOf(page), { x: w / 2, y: 0 }); // before the dock moves the plan
  await page.keyboard.press("3");
  if (size === "split") await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("view3d-panel")).toHaveAttribute("data-size", size);
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
}

test("the five are listed, choosing Outside changes the picture with a wall selected, and Cmd+Z works straight after (AC-06)", async ({ page }) => {
  await room(page, "split", true);
  const menu = menuOf(page);
  await expect(menu.locator("option")).toHaveText(["None", "Interior", "Outside", "On wheels", "Grid"]);
  await expect(menu).toHaveValue("");
  await expect.poll(async () => nearColour(await clearColour(page), WHITE)).toBe(true);

  await expect(page.locator('[data-field-id="length"]')).toHaveValue("6.00"); // the bottom wall is selected
  await menu.focus(); // as a pick with the mouse leaves it
  await menu.selectOption("outside");
  await expect(menu).toHaveValue("outside");
  await expect.poll(async () => nearColour(await clearColour(page), SKY)).toBe(true);
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("6.00"); // still selected
  expect(await focused(menu)).toBe(false); // focus given back

  await page.keyboard.press("ControlOrMeta+z");
  await expect(menu).toHaveValue("");
  await expect.poll(async () => nearColour(await clearColour(page), WHITE)).toBe(true);

  // None, picked in the menu, clears the setting ("" is sent; "none" would be refused with a toast).
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(menu).toHaveValue("outside");
  await menu.selectOption("");
  await expect(menu).toHaveValue("");
  await expect.poll(async () => nearColour(await clearColour(page), WHITE)).toBe(true);
  await expect(page.locator(".toast")).toHaveCount(0);
});

const listOpen = (menu: Locator): Promise<boolean> => menu.evaluate((el) => el.matches(":open"));

/**
 * The menu as a close with no change leaves it: focused, its list closed. Headless Chromium's popup ignores a pressed
 * Escape (the list stays open), so focus stands in for the click and the Escape.
 */
async function focusedClosed(menu: Locator): Promise<void> {
  await menu.focus();
  expect(await focused(menu)).toBe(true);
  expect(await listOpen(menu)).toBe(false);
}

// A close with no change keeps the focus on the select, whose keys the plan doesn't get: the browser's type-ahead would
// turn O (the Object tool) into Outside, a shared edit of the drawing.
test("a letter after the menu closes with no change picks nothing and gives the keys back (AC-06)", async ({ page }) => {
  await room(page, "corner", true);
  const menu = menuOf(page);
  await focusedClosed(menu);
  await page.keyboard.press("o");
  expect(await focused(menu)).toBe(false);
  await expect(menu).toHaveValue(""); // the drawing's value: no edit
  await page.keyboard.press("o"); // the plan has the keys again
  await expect(page.locator('[data-tool="object"]')).toHaveAttribute("aria-pressed", "true");
  await expect(menu).toHaveValue("");
});

// Outside macOS an arrow on a closed select picks the next option with no popup; on macOS it opens the popup. Either way
// the key would stay with the select, not the plan.
test("an arrow after the menu closes with no change picks nothing and gives the keys back (AC-06)", async ({ page }) => {
  await room(page, "corner", true);
  const menu = menuOf(page);
  for (const key of ["ArrowDown", "End"]) {
    await focusedClosed(menu);
    await page.keyboard.press(key);
    expect(await focused(menu), key).toBe(false);
    await expect(menu, key).toHaveValue("");
  }
});

// The guard is for a closed list only: in Chromium's own popup (headless here, headed Windows and Linux) the keys still
// reach the select while the list is open, and must move in it and pick, not close it with no pick.
test("with the list open, an arrow moves in it and a letter picks, and Cmd+Z works straight after (AC-06)", async ({ page }) => {
  await room(page, "corner", true);
  const menu = menuOf(page);
  await menu.click(); // opens the list
  await expect.poll(() => listOpen(menu)).toBe(true);
  await page.keyboard.press("ArrowDown");
  expect(await listOpen(menu), "still open after an arrow").toBe(true);
  expect(await focused(menu)).toBe(true);
  await expect(menu).toHaveValue("");
  await page.keyboard.press("i"); // type-ahead: Interior
  await expect(menu).toHaveValue("interior");
  expect(await focused(menu), "focus given back").toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(menu).toHaveValue("");
});

/** How many of the corner header's children stick out of it. */
const outOfHead = (head: Locator): Promise<number> =>
  head.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.children].filter((c) => {
      const b = c.getBoundingClientRect();
      return b.left < r.left - 0.5 || b.right > r.right + 0.5;
    }).length;
  });

test("the menu doesn't overflow the corner header at a 1080 px window, and gives way before the buttons just below (AC-06)", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await room(page, "corner");
  const head = page.getByTestId("view3d-panel").locator(".frame-head");
  // The title gives way first: going narrower, the menu keeps its full width while the title has any left.
  const widths = () => head.evaluate((el) => [".frame-title", ".surroundings-menu"].map((c) => el.querySelector(c)?.getBoundingClientRect().width ?? -1));
  const [title = -1, full = -1] = await widths();
  expect(title, "the title has room at 1400 px").toBeGreaterThan(20);
  let titleShrinking = false;
  for (let w = 1400; w >= 1000; w -= 10) {
    await page.setViewportSize({ width: w, height: 800 });
    const [t = -1, m = -1] = await widths();
    if (t > 0.5 && t < title - 0.5) titleShrinking = true;
    if (m < full - 0.5) expect(t, `at ${w} px the menu narrows to ${m} with the title still ${t} wide`).toBeLessThan(0.5);
  }
  expect(titleShrinking, "a window where the title was shrinking").toBe(true);

  await page.setViewportSize({ width: 1080, height: 800 });
  expect(await outOfHead(head)).toBe(0);
  const wide = (await menuOf(page).boundingBox())?.width ?? 0;
  expect(wide).toBeGreaterThanOrEqual(40); // still a menu, not a sliver
  await head.screenshot({ path: test.info().outputPath("surroundings-corner-1080.png") });

  // At 1040 px the title is already at 0: the menu shrinks, so the buttons stay in.
  await page.setViewportSize({ width: 1040, height: 800 });
  await expect.poll(async () => (await menuOf(page).boundingBox())?.width ?? 0).toBeLessThan(wide);
  expect(await outOfHead(head)).toBe(0);
  expect((await menuOf(page).boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(40);
});

// canCommit goes false for a frame or two after every own edit: the dim comes 400 ms late, so the menu doesn't blink.
test("a disabled menu dims only after a delay, and lights straight back (AC-06)", async ({ page }) => {
  await room(page, "corner");
  const menu = menuOf(page);
  const opacity = (disabled: boolean): Promise<string> =>
    menu.evaluate((el, d) => {
      if (!(el instanceof HTMLSelectElement)) throw new Error("not a select");
      el.disabled = d;
      return getComputedStyle(el).opacity;
    }, disabled);
  expect(await opacity(true)).toBe("1"); // not yet
  await expect.poll(() => menu.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.4");
  expect(await opacity(false)).toBe("1"); // at once
});

// Under the pointer, the hover look stays through the brief disable too: the look changes only with the dim.
test("a hovered menu keeps its hover look through a brief disable (AC-06)", async ({ page }) => {
  await room(page, "corner");
  const menu = menuOf(page);
  const look = (disabled?: boolean): Promise<string> =>
    menu.evaluate((el, d) => {
      if (!(el instanceof HTMLSelectElement)) throw new Error("not a select");
      if (d !== undefined) el.disabled = d;
      const s = getComputedStyle(el);
      return `${s.backgroundColor} / ${s.color} / ${s.opacity}`;
    }, disabled);
  const idle = await look();
  await menu.hover();
  await expect.poll(() => look()).not.toBe(idle);
  const hovered = await look();
  expect(await look(true)).toBe(hovered); // not yet
  await page.waitForTimeout(100);
  expect(await look(), "100 ms in, past an own edit's wait").toBe(hovered);
  await expect.poll(() => look()).not.toBe(hovered); // the dim, later
  expect(await look(false)).toBe(hovered); // at once
});

test("a double-click on the menu doesn't make a docked frame larger (AC-06)", async ({ page }) => {
  await room(page, "split");
  const larger = page.getByTestId("view3d-panel").locator('[data-action="larger-frames"]');
  await expect(larger).toHaveAttribute("title", "Larger");
  await menuOf(page).dblclick();
  await page.keyboard.press("Escape"); // closes the menu, if the double-click left it open
  await expect(larger).toHaveAttribute("title", "Larger");
  await page.getByTestId("view3d-panel").locator(".frame-title").dblclick(); // the bar itself still does
  await expect(larger).toHaveAttribute("title", "Back to the usual size");
});

// The fade has no visible steps in WebGL (AC-10). Agreement with look can't show it: both share the camera, and a ring's
// step sits inside its tolerance. So the panel's own pixels are read along scans out from the plate's centre, past the
// house to the picture square's edge, and no two neighbours may differ by more than the fade's largest step between two
// rings, plus 2 for the GPU's rounding. Along an axis a scan meets every pixel row or column a line crosses, so an
// outline round the rings can't slip between its samples. Grid is skipped by name in FADES: its lines are meant to step.
// On wheels is scanned at its own depth: its plate, its camera (framed from the ground up) and its depth range are not
// Outside's, so its projector carries the bottom and its scans start from the lowered plate's centre, past the house's
// box from the ground up: its trailer lies inside that box (surroundings.43).
// Every scan starts on the solid ground and ends on the background, so it crosses the whole fade. That needs a 2 × 2
// room (on a bigger house the fade starts under the walls) seen at yaw 270, where the scans run along the walls' box,
// not its diagonal; at tilt 35 the house hides the far side of the plate, so no scan goes up there. A larger docked
// frame in a 2400 × 2000 window makes the rings over a pixel wide on every scan (the narrowest about 1.4 px, on
// Interior's down scan at tilt 35): at a pixel or less two neighbours can skip a ring, and a smooth fade steps by two
// rings. The fade is counted from the first pixel off the ground to the first on the background, which leaves out the
// rings that round to either, so it understates the rings' width.
// The neighbour limit sees an outline, not a missing ring: the canvas splits a two-ring jump over its edge pixel, so a
// ring skipped mid-fade read 6 against Outside's 6 and 4 against Interior's 4, and a fade in 16 steps passed on
// Interior. So from above, where every scan's rings are 2 px wide or more, each ring's colour must also show on two
// pixels in a row within 1 per channel; a split edge pixel gives one. Seen failing with both breaks, on both styles.

const ROOM: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 2.1, y: 2.1 }, top: 2.5 }; // the 2 × 2 room's walls, 0.20 m thick
const PULL = 0.88; // the camera's pull with any surroundings (AC-03)

/** A fade to scan: its colours, how far below the floor its ground lies, and a scan it can't take, with why. */
type Fade = { ground: string; background: string; below: number; not?: { dir: keyof typeof DIRECTIONS; why: string } };

/**
 * Each drawn style's fade from the approved mock-ups and the spec (the scans' oracle, not read from the code under test),
 * keyed by its stored value, or why it isn't scanned. The scans loop over the editor's table (surroundings.33), so a
 * style with neither stops this file loading rather than going unscanned.
 */
const FADES: Readonly<Record<string, Fade | { skip: string }>> = {
  outside: { ground: "#b9c9a3", background: SKY, below: 0 },
  interior: { ground: "#d9d8d3", background: WHITE, below: 0 },
  grid: { skip: "its lines are meant to step: the Grid test below reads them" },
  // Outside's grass 0.75 m down (the spec). At yaw 270 screen right is +x, the long side's higher end on the 2 × 2 room
  // (x on a tie), where the drawbar runs past the grass's edge (surroundings.43).
  wheels: { ground: "#b9c9a3", background: SKY, below: 0.75, not: { dir: "right", why: "the drawbar lies along it" } },
};
const scanned = Object.keys(SURROUNDINGS).flatMap((value) => {
  const fade = FADES[value];
  if (fade === undefined) throw new Error(`no mock-up fade for the ${value} surroundings: give its colours, or why it isn't scanned`);
  return "skip" in fade ? [] : [{ value, ...fade }];
});

/** The fade's colours: the ground, then each of its 32 opaque rings towards `background`, by smoothstep (surroundings.03, .23). */
function fadeColours(ground: string, background: string): number[][] {
  const [a, b] = [rgbOf(ground), rgbOf(background)];
  const share = (k: number): number => (k / 32) ** 2 * (3 - (2 * k) / 32);
  return Array.from({ length: 33 }, (_, k) => [0, 1, 2].map((c) => Math.round((a[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) * share(k))));
}

/** The fade's largest step between two rings on any channel. */
function ringStep(ground: string, background: string): number {
  const colours = fadeColours(ground, background);
  return Math.max(...colours.slice(1).map((q, k) => offBy(q, colours[k] ?? q)));
}

type Scan = { dir: string; from: number[]; to: number[]; worst: number; at: number; length: number; fade: number; rings: number; unseen: number[] };

const DIRECTIONS = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] } as const;

/**
 * The panel's pixel nearest a panel-local point, where a world point lands among them (panel-local, unrounded), and the
 * picture's square, with the ground `below` the floor (the camera then frames the box from there up, AC-03).
 */
async function panelView(page: Page, below = 0): Promise<{ pixel: (x: number, y: number) => number[]; local: (p: Point3) => [number, number]; square: { x0: number; y0: number; x1: number; y1: number } }> {
  const { x, y, width, rgb } = await panelPixels(page);
  const { at, square } = await projector3d(page, { ...ROOM, bottom: -below, pull: PULL });
  const local = (p: Point3): [number, number] => {
    const q = at(p);
    return [q.x - x, q.y - y];
  };
  const pixel = (px: number, py: number): number[] => {
    const k = Math.round(py) * width + Math.round(px);
    return rgb.slice(k * 3, k * 3 + 3);
  };
  return { pixel, local, square: { x0: square.x - x, y0: square.y - y, x1: square.x - x + square.side, y1: square.y - y + square.side } };
}

/**
 * The panel's scans along `dirs` from the plate's centre: each starts 4 px past the house's box (a ray out of a convex
 * shape never comes back in) and stops 2 px inside the picture's square. `worst`: the largest channel step; `fade`: the
 * pixels from the first off the ground to the first on the background, each read within 2 per channel; `unseen`: the
 * rings, of the `rings` with a colour of their own, whose colour no two pixels in a row show within 1 per channel.
 */
async function scans(page: Page, dirs: readonly (keyof typeof DIRECTIONS)[], { ground, background, below }: Fade): Promise<Scan[]> {
  const { pixel, local, square } = await panelView(page, below);
  const [cx, cy] = local({ x: (ROOM.min.x + ROOM.max.x) / 2, y: (ROOM.min.y + ROOM.max.y) / 2, z: -below });
  const corners = [ROOM.min.x, ROOM.max.x].flatMap((x) => [ROOM.min.y, ROOM.max.y].flatMap((y) => [-below, ROOM.top].map((z) => local({ x, y, z }))));
  // Each ring whose colour is neither the ground's nor the background's nor the ring's before it (the fade's ends round
  // to those), by its number from 1.
  const colours = fadeColours(ground, background);
  const [first, last] = [rgbOf(ground), rgbOf(background)];
  const rings = colours.flatMap((colour, k) => (k > 0 && [first, last, colours[k - 1] ?? first].every((c) => offBy(colour, c) > 0) ? [{ k, colour }] : []));
  return dirs.map((dir) => {
    const [ux, uy] = DIRECTIONS[dir];
    const start = Math.ceil(Math.max(...corners.map(([x, y]) => (x - cx) * ux + (y - cy) * uy)) + 4);
    const edge = ux > 0 ? square.x1 - cx : ux < 0 ? cx - square.x0 : uy > 0 ? square.y1 - cy : cy - square.y0;
    const end = Math.floor(edge - 2);
    const at = (t: number): number[] => pixel(cx + t * ux, cy + t * uy);
    let [worst, where, left, reached] = [0, 0, end, end];
    for (let t = start; t < end; t++) {
      const step = offBy(at(t), at(t + 1));
      if (step > worst) [worst, where] = [step, t];
    }
    for (let t = start; t <= end && reached === end; t++) {
      if (left === end && !nearColour(at(t), ground)) left = t;
      if (nearColour(at(t), background)) reached = t;
    }
    const pairs = Array.from({ length: end - start }, (_, i) => [at(start + i), at(start + i + 1)] as const);
    const unseen = rings.filter(({ colour }) => !pairs.some(([p, q]) => Math.max(offBy(p, colour), offBy(q, colour)) <= 1)).map(({ k }) => k);
    return { dir, from: at(start), to: at(end), worst, at: where, length: end - start, fade: reached - left, rings: rings.length, unseen };
  });
}

/** The 2 × 2 room in a 2400 × 2000 window, its 3D docked in split and larger, in surroundings `value`, at yaw 270. */
async function smallRoom(page: Page, value: string): Promise<void> {
  await page.setViewportSize({ width: 2400, height: 2000 });
  await room(page, "split", false, [2, 2]);
  await page.getByTestId("view3d-panel").locator(".frame-title").dblclick();
  await expect(page.getByTestId("view3d-panel").locator('[data-action="larger-frames"]')).toHaveAttribute("title", "Back to the usual size");
  const menu = menuOf(page);
  await menu.focus();
  await menu.selectOption(value);
  await expect(menu).toHaveValue(value);
  await drag3d(page, -112.5, 0); // from yaw 225
  await expect.poll(async () => (await angles3d(page)).yaw).toBeCloseTo(270, 1);
}

for (const { value, ground, background, below, not } of scanned) {
  test(`radial scans of the panel's fade on ${value} step no more than the ring step plus 2 per channel and show every ring (AC-10)`, async ({ page }) => {
    test.setTimeout(90_000); // a 2400 × 2000 window's screenshots, read twice, under parallel workers
    await smallRoom(page, value);
    const limit = ringStep(ground, background) + 2;
    for (const view of ["side", "top"] as const) {
      if (view === "top") await drag3d(page, 0, 300); // tilt 90
      await page.waitForTimeout(200); // the frame after the last move is drawn
      const angles = await angles3d(page);
      const dirs = (view === "top" ? (["right", "left", "down", "up"] as const) : (["right", "left", "down"] as const)).filter((d) => d !== not?.dir);
      const read = await scans(page, dirs, { ground, background, below });
      console.log(`\n${value} at ${angles.yaw}° ${angles.tilt}° (limit ${limit}): ${read.map((s) => `${s.dir} ${s.length} px, fade ${s.fade} px, worst ${s.worst} at ${s.at}, ${s.rings - s.unseen.length} of ${s.rings} rings seen (unseen ${s.unseen.join(",")}), ${s.from.join(",")} → ${s.to.join(",")}`).join("; ")}\n`);
      for (const s of read) {
        const what = `${value} ${angles.yaw}° ${angles.tilt}° ${s.dir}`;
        expect(nearColour(s.from, ground), `${what} starts on ${s.from.join(", ")}, not the ground`).toBe(true);
        expect(nearColour(s.to, background), `${what} ends on ${s.to.join(", ")}, not the background`).toBe(true);
        expect(s.fade, `${what}: the fade's rings are over a pixel wide`).toBeGreaterThan(32);
        expect(s.worst, `${what} steps by ${s.worst} at ${s.at} px`).toBeLessThanOrEqual(limit);
        if (view === "side") continue;
        expect(s.fade, `${what}: the fade's rings are 2 px wide or more`).toBeGreaterThanOrEqual(64);
        expect(s.unseen, `${what}: rings not seen on two pixels in a row`).toEqual([]);
      }
    }
  });
}

// Grid's lines in the panel (AC-02, surroundings.34): agreement with look can't see them, as they cover under 1 % of the
// pixels. From above, short scans across the four lines through the plate's centre, between the walls' box and the
// fade, each 0.2 m from the box: a scan's ends lie on the plate, and somewhere between it darkens towards the lines'
// colour by at least a third of the lines' contrast with the plate.
// The seeded sample Studio stands on wheels (surroundings step 13, AC-09). Its walls' box and ceiling are the seed's
// (studio.json's shell: x −0.1–7.1, y −0.1–2.6, 3.05 m), framed from the ground 0.75 m down and pulled to 0.88 (AC-03).
// The probe is on the deck's south side at x 1.5, clear of the wheels and axles near the middle: with the deck gone the
// view would pass on down to the grass, so the pixel there is steel only while the deck draws (openings3d.20).
const STUDIO_ON_WHEELS: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05, bottom: -0.75, pull: 0.88 };
const STEEL = ["#4d4945", "#45413d", "#3c3935"]; // the trailer's steel, the palette's dark slot as the mock-up has it

test("the seeded studio reads On wheels in the menu and in get_drawing, and its deck shows below its south wall (AC-09)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?name=Viewer&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: SEED, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
  await expect(menuOf(page)).toHaveValue("wheels");
  await expect(menuOf(page).locator("option:checked")).toHaveText("On wheels");

  const claude = await startMcp(SERVER);
  try {
    const listed = await claude.call("list_projects");
    const projects: unknown[] = typeof listed === "object" && listed !== null && "projects" in listed && Array.isArray(listed.projects) ? listed.projects : [];
    const studio = projects.find((p) => typeof p === "object" && p !== null && "name" in p && p.name === SEED);
    if (typeof studio !== "object" || studio === null || !("id" in studio)) throw new Error("no seeded studio");
    await claude.call("open_project", { id: studio.id });
    const drawing = await claude.call("get_drawing");
    expect(typeof drawing === "object" && drawing !== null && "fields" in drawing ? drawing.fields : null).toEqual({ surroundings: "wheels" });
  } finally {
    claude.close();
  }

  await page.waitForTimeout(200); // the frame after the menu's value is drawn
  const { x, y, rgb, width } = await panelPixels(page);
  const { at } = await projector3d(page, STUDIO_ON_WHEELS);
  const p = at({ x: 1.5, y: -0.1, z: -0.127 });
  const k = Math.round(p.y - y) * width + Math.round(p.x - x);
  const read = rgb.slice(k * 3, k * 3 + 3);
  expect(Math.min(...STEEL.map((c) => offBy(read, rgbOf(c)))), `the deck's side at (1.5, −0.1) reads ${read.join(",")}`).toBeLessThanOrEqual(10);
});

test("Grid's lines draw in the panel (AC-02)", async ({ page }) => {
  test.setTimeout(90_000); // as the radial scans
  const [plate, lines] = ["#dbeee3", "#a9c4b4"]; // from the approved mock-ups
  await smallRoom(page, "grid");
  await drag3d(page, 0, 300); // tilt 90
  await page.waitForTimeout(200); // the frame after the last move is drawn
  const { pixel, local } = await panelView(page);
  const off = (read: number[]): number => offBy(read, rgbOf(plate));
  const contrast = off(rgbOf(lines));
  const z = -0.005; // the plate's 5 mm drop
  const across = [
    [{ x: 2.3, y: 0.85, z }, { x: 2.3, y: 1.15, z }], [{ x: -0.3, y: 0.85, z }, { x: -0.3, y: 1.15, z }], // the line y = 1
    [{ x: 0.85, y: 2.3, z }, { x: 1.15, y: 2.3, z }], [{ x: 0.85, y: -0.3, z }, { x: 1.15, y: -0.3, z }], // the line x = 1
  ] as const;
  for (const [a, b] of across) {
    const [p, q] = [local(a), local(b)];
    const n = Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])));
    const darkest = Math.max(...Array.from({ length: n + 1 }, (_, i) => off(pixel(p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n))));
    const what = `across (${a.x}, ${a.y}) to (${b.x}, ${b.y}), ${n} px`;
    console.log(`\nGrid's lines ${what}: darkest ${darkest} off the plate, the lines ${contrast}\n`);
    expect(Math.max(off(pixel(...p)), off(pixel(...q))), `${what}: the ends lie on the plate`).toBeLessThanOrEqual(2);
    expect(darkest, `${what}: darkest ${darkest} off the plate, the lines ${contrast}`).toBeGreaterThanOrEqual(contrast / 3);
  }
});
