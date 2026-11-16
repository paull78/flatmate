import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SURROUNDINGS } from "@fm/editor";
import { isRecord } from "@fm/protocol";
import { startMcp } from "./support/mcp-stdio";
import { angles3d, drag3d, square3d } from "./support/probe3d";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";
import { copyStudio, withSurroundings } from "./support/studio-copy";

// Claude sees what the user sees (real3d AC-10): the seeded sample Studio in the panel's WebGL picture and in look's
// raster3d PNG, from the real MCP over stdio at the angles the panel reads back, agree on at least 97 % of pixels
// within 8 per colour channel. The panel's square is shot at device pixel ratio 2, so scaling it to look's 1100 px is a
// downscale. A tilt of 10° is among the views: WebGL's half of AC-09's grazing check (real3d.28).

const AGREE = 0.97;
const TOLERANCE = 8;

/** A drag in the 3D panel from its centre by (dx, dy) pixels, in 25 small moves. */
const drag = (page: Page, dx: number, dy: number): Promise<void> => drag3d(page, dx, dy, 25);

/** The panel's picture square as a PNG, at the page's device pixels. */
async function panelSquare(page: Page): Promise<Buffer> {
  const { x, y, side } = await square3d(page);
  await page.waitForTimeout(200); // the frame after the last move is drawn
  return page.screenshot({ clip: { x, y, width: side, height: side } });
}

/** The share of pixels within TOLERANCE once both pictures are drawn at `size` square (the screenshot downscaled). */
async function agreement(page: Page, shot: Buffer, look: string, size: number): Promise<number> {
  return page.evaluate(async ([a, b, n, tolerance]) => {
    const pixels = async (base64: string): Promise<Uint8ClampedArray> => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const ctx = new OffscreenCanvas(n, n).getContext("2d");
      if (ctx === null) throw new Error("no 2D context");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, n, n);
      return ctx.getImageData(0, 0, n, n).data;
    };
    const [p, q] = [await pixels(a), await pixels(b)];
    let same = 0;
    for (let i = 0; i < p.length; i += 4) if ([0, 1, 2].every((c) => Math.abs((p[i + c] ?? 0) - (q[i + c] ?? 0)) <= tolerance)) same++;
    return same / (n * n);
  }, [shot.toString("base64"), look, size, TOLERANCE] as const);
}

/** The project named `name` opened with its 3D view in split, on a page at device pixel ratio 2. */
async function openIn3d(browser: Browser, name: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`/?name=Viewer&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
  return { context, page };
}

/**
 * WebGL against look on the project named `name` at the four views, each at least AGREE. With `style` (a stored value,
 * or null for None), the panel's menu shows it and every `look` caption names it by the menu's label: Interior and Grid
 * clear to white as None does, so the agreement alone can't tell a copy that lost its row from one that kept it.
 */
async function agreeOn(browser: Browser, name: string, style?: string | null): Promise<void> {
  const { context, page } = await openIn3d(browser, name);
  const claude = await startMcp(SERVER);
  try {
    const menu = page.getByTestId("surroundings-menu");
    if (style !== undefined) await expect(menu).toHaveValue(style ?? "");
    const label = style ? await menu.locator("option:checked").textContent() : null;
    const listed: unknown = await claude.call("list_projects");
    const projects: unknown[] = isRecord(listed) && Array.isArray(listed.projects) ? listed.projects : [];
    const studio = projects.find((p) => isRecord(p) && p.name === name);
    if (!isRecord(studio) || typeof studio.id !== "string") throw new Error(`no project ${name}`);
    await claude.call("open_project", { id: studio.id });
    const views: [string, () => Promise<void>][] = [
      ["225° 35°", async () => {}],
      ["45° 60°", async () => {
        await page.keyboard.press("]");
        await page.keyboard.press("]");
        await drag(page, 0, 62.5);
      }],
      ["300° 90°", async () => {
        await page.getByTestId("view3d").dblclick();
        await drag(page, -187.5, 0);
        await drag(page, 0, 300);
      }],
      ["225° 10°", async () => {
        await page.getByTestId("view3d").dblclick();
        await drag(page, 0, -62.5);
      }],
    ];
    const results: string[] = [];
    for (const [name, drive] of views) {
      await drive();
      const angles = await angles3d(page);
      const shot = await panelSquare(page);
      const items = await claude.content("look", { view: "3d", yaw: angles.yaw, tilt: angles.tilt });
      const look = items.find((c) => c.type === "image")?.data;
      if (look === undefined) throw new Error(`look sent no picture at ${name}`);
      const caption = items.find((c) => c.type === "text")?.text ?? "";
      if (style === null) expect(caption, `look's caption at ${name}`).not.toContain("surroundings");
      if (style) expect(caption, `look's caption at ${name}`).toContain(`the ${label} surroundings`);
      const share = await agreement(page, shot, look, 1100);
      results.push(`${name} (read back ${angles.yaw}°, ${angles.tilt}°): ${(share * 100).toFixed(2)} %`);
      expect(share, results.at(-1)).toBeGreaterThanOrEqual(AGREE);
    }
    console.log(`\nWebGL against look on ${name}: ${results.join("; ")}\n`);
  } finally {
    claude.close();
    await context.close();
  }
}

// The seeded studio stands on wheels (surroundings step 13): the menu and every caption name it, and it agrees as any
// style does.
test("the studio in WebGL and in look's PNG agree on 97 % of pixels at four views (AC-10)", async ({ browser }) => {
  test.setTimeout(180_000);
  await agreeOn(browser, "Studio", "wheels");
});

// Cement tiles draw their filled shapes in 3D 1 mm above the floor (shown.04, AC-09): the studio's main room in the
// motif's defaults (the domain's MOTIFS), on a copy, since other specs read the seed. With no surroundings row, so it
// measures the tiles at today's framing, not the seed's wheels (surroundings step 13).
test("the studio with its main room in cement tiles agrees too, at 97 % at four views (shown AC-09)", async ({ browser }) => {
  test.setTimeout(180_000);
  const name = "Studio cement";
  const cement = { motif: "cementTiles", colour: "#e3d9c6", strength: 70, size: 0.2, angle: 0 };
  await copyStudio(name, (stored) => {
    const doc = withSurroundings(null)(stored);
    const labels = isRecord(doc.zoneLabels) ? doc.zoneLabels : {};
    const main = labels["studio-main"];
    if (!isRecord(main)) throw new Error("no studio-main label");
    return { ...doc, zoneLabels: { ...labels, "studio-main": { ...main, finish: cement } } };
  });
  try {
    await agreeOn(browser, name);
  } finally {
    await deleteProjects([name]);
  }
});

// Each surroundings drawn so far on a copy of the studio (surroundings steps 04, 08, AC-10), its list taken from the
// editor's table so a style joins on arrival (surroundings.33), and a copy with the row taken out, which agrees as
// before this cycle whatever the seed says (step 13 seeds the studio on wheels). A panel stuck on white agrees at
// 44.80 % on Outside (surroundings.26); the probe outside the square (AC-02) is the menu test's in surroundings.spec.ts.
for (const style of [...Object.keys(SURROUNDINGS), null]) {
  test(`a copy ${style === null ? "with no row" : `in ${style}`} agrees at 97 % at the four views (AC-10)`, async ({ browser }) => {
    test.setTimeout(180_000);
    const name = `Studio ${style ?? "no row"}`;
    await copyStudio(name, withSurroundings(style));
    try {
      await agreeOn(browser, name, style);
    } finally {
      await deleteProjects([name]);
    }
  });
}
