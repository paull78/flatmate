import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { toScreen, type WorldPoint } from "./support/canvas";
import { canvasOf, waitSaved } from "./support/app-driver";
import { anyPlace } from "./support/mcp-listing";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";
import { expectNoToast } from "./support/toasts";
import { showGroup } from "./support/palette";

// The sample scene of the stairwell cycle (spec "The sample scene", stairwell.12, .21; AC-15) in a real browser: Claude draws
// the cabin and tries the ladder, refused for the loft's slab; one drag of the Hole tool cuts the notch in the loft's
// north-east corner; the stair gesture puts the ladder on the notch's west side, rising through it; the loft's level
// and 3D. Gestures go through the UI along paths of small moves; Claude's side through a real stdio MCP process. Each
// step waits for the shared document to show its edit before the next.

let project = "";

test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

type Deck = { id: string; holes: { id: string; centre: number[]; width: number; depth: number; corners: number[][] }[] };
type Placed = { id: string; kind: string; at: number[] | null };
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function drawing(claude: McpClient): Promise<{ decks: Deck[]; objects: (Placed & { line: string; warnings: string[] })[] }> {
  const d: unknown = await claude.call("get_drawing");
  if (!isRecord(d)) throw new Error("get_drawing sent no object");
  return {
    decks: list(d.decks).filter(isRecord).map((k) => ({
      id: str(k.id),
      holes: list(k.holes).filter(isRecord).map((h) => ({ id: str(h.id), centre: list(h.centre).map(num), width: num(h.width), depth: num(h.depth), corners: list(h.corners).map((c) => list(c).map(num)) })),
    })),
    objects: list(d.objects).filter(isRecord).map((o) => {
      const p = anyPlace(o);
      const stair = isRecord(o.stair) ? o.stair : {};
      return { id: str(o.id), kind: str(o.kind), at: isRecord(p) ? list(p.centre).map(num) : null, line: str(stair.line), warnings: list(stair.warnings).map(str) };
    }),
  };
}

/** The pointer glides from `from` to `to` in many small moves (a person's path, not a jump). */
async function glide(page: Page, canvas: Locator, from: WorldPoint, to: WorldPoint): Promise<void> {
  const [a, b] = [await toScreen(canvas, from), await toScreen(canvas, to)];
  await page.mouse.move(a.x, a.y, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 30 });
}

async function shot(page: Page, info: TestInfo, name: string, shots: string[]): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
  shots.push(path);
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

test("the stairwell sample scene on the cabin: the ladder refused, the notch cut by one drag, the ladder through it, the loft's level, 3D (stairwell AC-15)", async ({ browser }, info) => {
  test.setTimeout(180_000);
  project = `zz-stairwell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const shots: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const claude = await startMcp(SERVER);
  try {
    // 1. Claude draws the cabin: a 4 × 3 room, the 3.05 ceiling, the Loft at x 0.10–2.10 over its whole depth.
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 4, depth: 3 });
    await claude.call("set_ceiling", { height: 3.05 });
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 1.1, y: 1.5 }, width: 2, depth: 2.8 });
    const loft = isRecord(added) && isRecord(added.result) ? str(added.result.deck) : "";
    expect(loft).not.toBe("");

    // 2. Claude tries a ship's ladder rising west along the north wall, reaching the Loft: refused for the slab.
    const refusal = await claude.call("place_object", { layout: "s0", kind: "shipsLadder", centre: { x: 1.95, y: 2.6 }, rotation: 90, reaches: loft }).then(
      () => "accepted",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(refusal).toContain("Ship's ladder (0.00–2.15) and Loft (2.03–2.15) overlap");

    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);
    const canvas = canvasOf(page);
    await shot(page, info, "step-1-cabin", shots);

    // 3. The Hole tool: one drag from (1.40, 2.25) into the loft's corner by the north wall and its open side.
    await page.keyboard.press("h");
    await glide(page, canvas, { x: 3.0, y: 1.0 }, { x: 1.4, y: 2.25 });
    await page.mouse.down();
    await glide(page, canvas, { x: 1.4, y: 2.25 }, { x: 2.094, y: 2.893 });
    await page.mouse.up();
    await expect.poll(async () => (await drawing(claude)).decks.find((k) => k.id === loft)?.holes.length ?? 0, { message: "the notch" }).toBe(1);
    await waitSaved(page);
    await expectNoToast(page);
    const notch = (await drawing(claude)).decks.find((k) => k.id === loft)?.holes[0];
    expect(notch && [notch.width, notch.depth]).toEqual([0.7, 0.65]);
    expect(notch?.corners.map((c) => c.map(r3))).toEqual([[1.4, 2.25], [2.1, 2.25], [2.1, 2.9], [1.4, 2.9]]);
    await shot(page, info, "step-3-notch", shots);

    // 4. A ship's ladder from the palette, along the north wall to the notch's west side, clicked near the wall.
    await page.keyboard.press("Escape");
    await showGroup(page, "Stairs");
    await page.getByTestId("palette").locator(".palette-card", { has: page.getByText("Ship's ladder", { exact: true }) }).click();
    await glide(page, canvas, { x: 3.2, y: 2.7 }, { x: 1.7, y: 2.8 });
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.mouse.up();
    let ladder: Awaited<ReturnType<typeof drawing>>["objects"][number] | undefined;
    await expect.poll(async () => (ladder = (await drawing(claude)).objects.find((o) => o.kind === "shipsLadder")) !== undefined, { message: "the ladder" }).toBe(true);
    await waitSaved(page);
    await expectNoToast(page);
    expect(ladder?.at?.map(r3)).toEqual([1.952, 2.6]); // x 1.40–2.503, y 2.30–2.90
    expect(ladder?.line).toContain("reaches Loft +2.15");
    expect(ladder?.warnings.some((w) => w.includes("reach"))).toBe(false);
    await shot(page, info, "step-4-ladder", shots);

    // 5. The loft's level: the notch cut out, the ladder whole with DN. Then 3D.
    await page.keyboard.press("Escape");
    await page.getByTestId("level-strip").locator(`button[data-level="${loft}"]`).click();
    await expect(page.getByTestId("level-strip").locator(`button[data-level="${loft}"]`)).toHaveAttribute("aria-pressed", "true");
    await shot(page, info, "step-5-loft-level", shots);
    await page.getByTestId("open3d").click();
    await expect(page.getByTestId("view3d-panel")).toBeVisible();
    await page.keyboard.press("]");
    await page.waitForTimeout(300);
    await shot(page, info, "step-6-3d", shots);
    console.log(`\nstairwell sample scene screenshots:\n${shots.join("\n")}\n`);
  } finally {
    claude.close();
    await context.close();
  }
});
