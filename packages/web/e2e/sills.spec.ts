import { expect, test, type Page } from "@playwright/test";
import type { Bounds3, Point3 } from "@fm/editor";
import { isRecord } from "@fm/protocol";
import { clickAt, toScreen } from "./support/canvas";
import { canvasOf, waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { screenPixel } from "./support/pixels";
import { angles3d, panelPixels, projector3d } from "./support/probe3d";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Openings at any height in the browser (sills step 11, AC-06, AC-08, AC-10). Claude draws a 7 × 2.5 shell under
// 3.05 with a door at x 3.0–3.8 on its south wall and a window 2.40–2.90 over it, and a window 2.40–2.90 alone on the
// north wall at x 5.0–6.0. In the WebGL panel from the north-east the strip between the stacked two reads wall, the
// window glass, the door what lies beyond; on the floor's plan (cut 1.20) the lone high window draws dashed across its
// wall; in Properties the stacked window's height changes and undo brings it back.

const BOUNDS: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05 };

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

/** Claude's drawing; the window's id. */
async function stacked(): Promise<string> {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-sills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 7, depth: 2.5 });
    await claude.call("set_ceiling", { height: 3.05 });
    const room: unknown = await claude.call("get_drawing"); // an edit replies without the drawing (mcp.01)
    const walls = isRecord(room) && Array.isArray(room.walls) ? room.walls.filter(isRecord) : [];
    const along = (y: number) => walls.find((w) => Array.isArray(w.from) && Array.isArray(w.to) && w.from[1] === y && w.to[1] === y);
    const [south, north] = [along(0), along(2.5)];
    if (!south || typeof south.id !== "string" || !Array.isArray(south.from)) throw new Error("no south wall");
    if (!north || typeof north.id !== "string" || !Array.isArray(north.from)) throw new Error("no north wall");
    const northOffset = north.from[0] === 0 ? 5 : Number(north.from[0]) - 6; // x 5.0–6.0
    await claude.call("add_window", { wall: north.id, offset: northOffset, width: 1, sill: 2.4, height: 0.5 });
    const offset = south.from[0] === 0 ? 3 : Number(south.from[0]) - 3.8; // x 3.0–3.8 whichever way the wall runs
    await claude.call("add_door", { wall: south.id, offset, width: 0.8 });
    const win: unknown = await claude.call("add_window", { wall: south.id, offset, width: 0.8, sill: 2.4, height: 0.5 });
    const result = isRecord(win) && isRecord(win.result) ? win.result : null;
    if (!result || typeof result.opening !== "string") throw new Error("no window id");
    return result.opening;
  } finally {
    claude.close();
  }
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?name=Viewer&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
  await expect(page.getByTestId("project-name")).toHaveText(project);
}

test("in 3D the window stands over the door with wall between them (AC-10)", async ({ page }) => {
  await stacked();
  await open(page);
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await expect.poll(async () => (await angles3d(page)).yaw).toBe(45); // from the north-east: the south wall's inside shows
  await page.waitForTimeout(200);

  const { x, y, rgb, width } = await panelPixels(page);
  const { at } = await projector3d(page, BOUNDS);
  const colour = (p: Point3): number[] => {
    const q = at(p);
    const k = Math.round(q.y - y) * width + Math.round(q.x - x);
    return [0, 1, 2].map((c) => rgb[k * 3 + c] ?? 0);
  };
  const lum = (c: number[]): number => ((c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0)) / 3;
  const wall = colour({ x: 2.2, y: 0.1, z: 2.25 }); // the south wall's inside beside the stack
  const strip = colour({ x: 3.4, y: 0.1, z: 2.25 });
  expect(Math.abs(lum(strip) - lum(wall)), `the strip reads wall: ${strip} against ${wall}`).toBeLessThan(12);
  const glass = colour({ x: 3.4, y: 0.1, z: 2.65 });
  expect((glass[2] ?? 0) - (glass[0] ?? 0), `the window reads glass: ${glass}`).toBeGreaterThan(20);
  const door = colour({ x: 3.4, y: 0.1, z: 1.1 });
  expect(lum(door) - lum(wall), `the door shows what lies beyond: ${door}`).toBeGreaterThan(20);
});

test("on the floor's plan the window above the cut draws dashed across the wall, and Properties edits its height (AC-06, AC-08)", async ({ page }) => {
  await stacked();
  await open(page);
  const canvas = canvasOf(page);
  /** Pixels darker than the wall's own fill on a line across the wall at `wx`, from face to face. */
  const darkAcross = async (wx: number): Promise<number> => {
    const fill = await (async () => {
      const s = await toScreen(canvas, { x: 1.5, y: 2.5 });
      return screenPixel(page, s.x, s.y);
    })();
    let dark = 0;
    for (let wy = 2.43; wy <= 2.57 + 1e-9; wy += 0.01) { // across the north wall, face to face
      const s = await toScreen(canvas, { x: wx, y: wy });
      const c = await screenPixel(page, s.x, s.y);
      if ((fill[0] ?? 0) + (fill[1] ?? 0) + (fill[2] ?? 0) - ((c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0)) > 90) dark++;
    }
    return dark;
  };
  expect(await darkAcross(5.0), "a dashed jamb line at the lone window's end").toBeGreaterThan(1);
  expect(await darkAcross(6.0), "a dashed jamb line at the lone window's other end").toBeGreaterThan(1);
  expect(await darkAcross(4.0), "solid wall where no opening is").toBe(0);

  // At the floor a click on the stack picks the door, the next one the window above it (sills.26); its height is edited.
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 3.2, y: 0 });
  await expect(page.locator('[data-field-id="sill"]')).toHaveCount(0); // the door: Height only
  await clickAt(page, canvas, { x: 3.2, y: 0 });
  const height = page.locator('[data-field-id="height"]');
  await expect(page.locator('[data-field-id="sill"]')).toHaveValue("2.40");
  await expect(height).toHaveValue("0.50");
  await height.fill("0.40");
  await height.press("Enter");
  await expect(height).toHaveValue("0.40");
  await height.blur(); // Cmd+Z in the field would undo its text, not the edit
  await waitSaved(page); // an undo pressed while the edit waits for its ack does nothing (the field is read-only then: sheetset.68)
  await page.keyboard.press("ControlOrMeta+z");
  await expect(height).toHaveValue("0.50");
});
