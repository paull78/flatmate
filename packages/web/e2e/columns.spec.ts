import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { toScreen, type WorldPoint } from "./support/canvas";
import { canvasOf, waitSaved } from "./support/app-driver";
import { layoutIds, placesOf } from "./support/mcp-listing";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { copyStudio } from "./support/studio-copy";
import { deleteProjects } from "./support/stored";
import { expectNoToast } from "./support/toasts";

// The sample scene of the pillars cycle (spec "The sample scene", AC-18) in a real browser on the seeded studio: a column in
// the east wall's line, the chair moved into it refused, a free post under the loft that follows the loft up, and a
// knee wall at the loft's level, then 3D. Gestures go through the UI, along paths of small moves; Claude's side (the
// typed move and every read-back) goes through a real stdio MCP process. Each step waits for the shared document to
// show its edit before the next. The run edits a copy of the seeded studio, since other specs read the seed itself.

let project = "";

test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

// ---- get_drawing, read loosely -----------------------------------------------------------------------------------

type Column = { id: string; centre: number[]; width: number; depth: number; range: { bottom: number; top: number }; inLineOf: string[] | null; top?: string };
type Drawing = {
  states: { id: string; name: string; blocked: { zone: string; by: string }[] }[];
  rooms: { area: number | null }[];
  walls: { id: string; on?: string; from: number[]; to: number[] }[];
  objects: { id: string; kind: string; placements: Record<string, { at: number[] } | null> }[];
  decks: { id: string; name: string; top: number; solid: boolean }[];
  columns: Column[];
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nums = (v: unknown): number[] => list(v).map(num);

async function drawing(claude: McpClient): Promise<Drawing> {
  const d: unknown = await claude.call("get_drawing");
  if (!isRecord(d)) throw new Error("get_drawing sent no object");
  return {
    states: list(d.layouts).filter(isRecord).map((s) => ({
      id: str(s.id), name: str(s.name), blocked: list(s.blocked).filter(isRecord).map((b) => ({ zone: str(b.zone), by: str(b.by) })),
    })),
    rooms: list(d.rooms).filter(isRecord).map((r) => ({ area: typeof r.area === "number" ? r.area : null })),
    walls: list(d.walls).filter(isRecord).map((w) => ({ id: str(w.id), ...(typeof w.on === "string" ? { on: w.on } : {}), from: nums(w.from), to: nums(w.to) })),
    objects: list(d.objects).filter(isRecord).map((o) => {
      const placements: Record<string, { at: number[] } | null> = {};
      for (const [state, p] of Object.entries(placesOf(o, layoutIds(d)))) placements[state] = isRecord(p) ? { at: nums(p.centre) } : null;
      return { id: str(o.id), kind: str(o.kind), placements };
    }),
    decks: list(d.decks).filter(isRecord).map((k) => ({ id: str(k.id), name: str(k.name), top: num(k.top), solid: k.solid === true })),
    columns: list(d.columns).filter(isRecord).map((c) => ({
      id: str(c.id), centre: nums(c.centre), width: num(c.width), depth: num(c.depth),
      range: isRecord(c.range) ? { bottom: num(c.range.bottom), top: num(c.range.top) } : { bottom: Number.NaN, top: Number.NaN },
      inLineOf: Array.isArray(c.inLineOf) ? c.inLineOf.map(str) : null,
      ...(typeof c.top === "string" ? { top: c.top } : {}),
    })),
  };
}

/** Each layout's blocked use zones and door swings, by state name, sorted: the warnings a step must leave alone. */
const warnings = (d: Drawing): Record<string, string[]> =>
  Object.fromEntries(d.states.map((s) => [s.name, s.blocked.map((b) => `${b.zone} by ${b.by}`).sort()]));

const near = (centre: number[], p: WorldPoint): boolean => Math.abs((centre[0] ?? Number.NaN) - p.x) < 1e-6 && Math.abs((centre[1] ?? Number.NaN) - p.y) < 1e-6;

/** The one column centred at `p`, once Claude's copy of the shared document has it. */
async function columnAt(claude: McpClient, p: WorldPoint): Promise<Column> {
  let found: Column | undefined;
  await expect.poll(async () => (found = (await drawing(claude)).columns.find((c) => near(c.centre, p))) !== undefined, { message: `a column at (${p.x}, ${p.y})` }).toBe(true);
  if (found === undefined) throw new Error("no column");
  return found;
}

// ---- gestures ----------------------------------------------------------------------------------------------------

/** The pointer glides from `from` to `to` in many small moves (a person's path, not a jump). */
async function glide(page: Page, canvas: Locator, from: WorldPoint, to: WorldPoint): Promise<void> {
  const [a, b] = [await toScreen(canvas, from), await toScreen(canvas, to)];
  await page.mouse.move(a.x, a.y, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 30 });
}

/** A press and release where the pointer is, after a short rest, as a click lands. */
async function click(page: Page): Promise<void> {
  await page.waitForTimeout(50);
  await page.mouse.down();
  await page.mouse.up();
}

async function shot(page: Page, info: TestInfo, name: string, shots: string[]): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
  shots.push(path);
}

test("the sample scene on the seeded studio: a column in the east wall, the chair refused, a post following the loft, a knee wall, 3D (pillars AC-18)", async ({ browser }, info) => {
  test.setTimeout(180_000);
  project = `zz-columns-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await copyStudio(project);
  const shots: string[] = [];

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const claude = await startMcp(SERVER);
  try {
    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);
    const canvas = canvasOf(page);

    const listed: unknown = await claude.call("list_projects");
    const copy = list(isRecord(listed) ? listed.projects : undefined).find((p) => isRecord(p) && p.name === project);
    if (!isRecord(copy) || typeof copy.id !== "string") throw new Error(`no ${project} in list_projects`);
    await claude.call("open_project", { id: copy.id });

    const seeded = await drawing(claude);
    expect(seeded.rooms.map((r) => r.area)).toContain(12.19);
    expect(seeded.columns).toEqual([]);
    const loft = seeded.decks.find((k) => !k.solid && k.top === 2.15);
    if (loft === undefined) throw new Error("no loft in the studio");

    // 1. Column tool at 0.30 × 0.40, clicked on the east wall at y 2.00: in the wall's line, 12.19 → 12.16 m², no
    //    warning changes in either layout.
    await page.keyboard.press("c");
    await page.getByTestId("column-width").fill("0.30");
    await page.getByTestId("column-width").press("Enter");
    await page.getByTestId("column-depth").fill("0.40");
    await page.getByTestId("column-depth").press("Enter");
    await expect(page.getByTestId("column-width")).toHaveValue("0.30");
    await expect(page.getByTestId("column-depth")).toHaveValue("0.40");
    await glide(page, canvas, { x: 5.6, y: 1.0 }, { x: 7, y: 2 });
    await click(page);
    const wallColumn = await columnAt(claude, { x: 7, y: 2 });
    await waitSaved(page);
    await expectNoToast(page);
    const east = seeded.walls.find((w) => w.from[0] === 7 && w.to[0] === 7 && Math.min(w.from[1] ?? 0, w.to[1] ?? 0) < 2 && Math.max(w.from[1] ?? 0, w.to[1] ?? 0) > 2);
    if (east === undefined) throw new Error("no east wall at x 7.00");
    expect(wallColumn).toMatchObject({ width: 0.3, depth: 0.4, range: { bottom: 0, top: 3.05 } });
    expect(wallColumn.inLineOf).toContain(east.id);
    const afterColumn = await drawing(claude);
    expect(afterColumn.rooms.map((r) => r.area)).toContain(12.16);
    expect(afterColumn.rooms.map((r) => r.area)).not.toContain(12.19);
    expect(warnings(afterColumn)).toEqual(warnings(seeded));
    await shot(page, info, "step-1-column-in-east-wall", shots);

    // 2. The east chair moved to (6.60, 1.85) by typed position (Claude's move_object; pieces have no typed position
    //    in the UI): refused, naming the chair's and the column's ranges.
    const day = afterColumn.states.find((s) => s.name === "Day");
    if (day === undefined) throw new Error("no Day layout");
    const chair = afterColumn.objects.find((o) => o.kind === "chair" && (o.placements[day.id]?.at[0] ?? 0) > 6);
    if (chair === undefined) throw new Error("no east chair by Day");
    const refusal = await claude.call("move_object", { layout: day.id, object: chair.id, centre: { x: 6.6, y: 1.85 } }).then(
      () => "accepted",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(refusal).toMatch(/Chair \(0\.00–0\.90\) and Column \(0\.00–3\.05\) overlap/);
    expect((await drawing(claude)).objects.find((o) => o.id === chair.id)?.placements[day.id]?.at).toEqual(chair.placements[day.id]?.at);
    await shot(page, info, "step-2-chair-refused", shots);

    // 3. Column tool at 0.20 × 0.20 (the preset), clicked at (2.40, 1.60) under the loft: a free post up to the loft's
    //    underside, 0.00–2.03; no new warning.
    await page.getByTestId("column-size").getByRole("button", { name: "20", exact: true }).click();
    await expect(page.getByTestId("column-width")).toHaveValue("0.20");
    await expect(page.getByTestId("column-depth")).toHaveValue("0.20");
    await glide(page, canvas, { x: 3.4, y: 1.0 }, { x: 2.4, y: 1.6 });
    await click(page);
    const post = await columnAt(claude, { x: 2.4, y: 1.6 });
    await waitSaved(page);
    await expectNoToast(page);
    expect(post).toMatchObject({ width: 0.2, depth: 0.2, inLineOf: null, top: loft.id, range: { bottom: 0, top: 2.03 } });
    expect(warnings(await drawing(claude))).toEqual(warnings(seeded));
    await shot(page, info, "step-3-post-under-loft", shots);

    // 4. The loft raised to 2.30 in Properties: the post now spans 0.00–2.18.
    await page.keyboard.press("Escape"); // the Select tool
    await glide(page, canvas, { x: 3.0, y: 0.8 }, { x: 2.1, y: 1.0 }); // the loft over free floor east of the partition
    await click(page);
    const top = page.locator('[data-field-id="top"]');
    await expect(top).toHaveValue("2.15");
    await top.fill("2.30");
    await top.press("Enter");
    await expect.poll(async () => (await drawing(claude)).columns.find((c) => c.id === post.id)?.range).toEqual({ bottom: 0, top: 2.18 });
    await waitSaved(page);
    await expectNoToast(page);
    expect((await drawing(claude)).decks.find((k) => k.id === loft.id)?.top).toBe(2.3);
    await shot(page, info, "step-4-loft-raised", shots);

    // 5. The loft's level, the Wall tool along the loft's open edge (x 2.40) from inside the loft square to the north
    //    shell, then Escape: a wall on the loft. Then the 3D panel.
    await page.keyboard.press("Escape");
    await page.getByTestId("level-strip").locator(`button[data-level="${loft.id}"]`).click();
    await expect(page.getByTestId("level-strip").locator(`button[data-level="${loft.id}"]`)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("w");
    await glide(page, canvas, { x: 3.2, y: 0.6 }, { x: 2.4, y: 1.0 });
    await click(page);
    await glide(page, canvas, { x: 2.4, y: 1.0 }, { x: 2.4, y: 2.47 }); // into the north wall's body (y 2.40–2.60)
    await click(page);
    let knee: Drawing["walls"][number] | undefined;
    await expect.poll(async () => (knee = (await drawing(claude)).walls.find((w) => w.on === loft.id)) !== undefined, { message: "a wall on the loft" }).toBe(true);
    await waitSaved(page);
    await page.keyboard.press("Escape");
    await expectNoToast(page);
    expect(knee?.from).toEqual([2.4, 1]);
    expect(knee?.to).toEqual([2.4, 2.4]); // flush on the shell's inner face
    await shot(page, info, "step-5-knee-wall", shots);

    await page.getByTestId("open3d").click();
    await expect(page.getByTestId("view3d-panel")).toBeVisible();
    await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
    await page.waitForTimeout(300); // the first 3D frame
    await shot(page, info, "step-5-3d", shots);
    console.log(`\ncolumns sample scene screenshots:\n${shots.join("\n")}\n`);
  } finally {
    claude.close();
    await context.close();
  }
});
