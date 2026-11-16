import { expect, test } from "@playwright/test";
import type { Bounds3, Point3 } from "@fm/editor";
import { isRecord } from "@fm/protocol";
import { startMcp } from "./support/mcp-stdio";
import { angles3d, panelPixels, projector3d } from "./support/probe3d";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Seams on 3D walls in the WebGL panel (snags.10, AC-05). Claude draws the studio's T-joint (a 2.03 partition across a
// 7 × 2.5 shell under 3.05); from the north-east, the south wall's inside reads as one flat wall above the partition,
// with no line at x 1.4 or 1.6, while the partition's corner below 2.03 keeps its line.

const BOUNDS: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05 }; // the walls' box, no surroundings

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

test("the south wall above the partition shows no seam, and the partition's corner keeps its line (AC-05)", async ({ page }) => {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-seams-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 7, depth: 2.5 });
    await claude.call("set_ceiling", { height: 3.05 });
    await claude.call("add_wall", { a: { x: 1.5, y: 0 }, b: { x: 1.5, y: 2.5 } });
    const drawing: unknown = await claude.call("get_drawing");
    const walls = isRecord(drawing) && Array.isArray(drawing.walls) ? drawing.walls.filter(isRecord) : [];
    const across = (w: Record<string, unknown>) => Array.isArray(w.from) && Array.isArray(w.to) && w.from[0] === 1.5 && w.to[0] === 1.5;
    const partition = walls.find(across);
    if (!partition || typeof partition.id !== "string") throw new Error("no partition in get_drawing");
    await claude.call("set_wall_top", { wall: partition.id, top: 2.03 });
  } finally {
    claude.close();
  }

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?name=Viewer&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await page.keyboard.press("3");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.locator('[data-testid="view3d"] canvas')).toHaveCount(1);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await expect.poll(async () => (await angles3d(page)).yaw).toBe(45); // from the north-east: the south wall shows
  await page.waitForTimeout(200);

  const { x, y, rgb, width } = await panelPixels(page);
  const { at } = await projector3d(page, BOUNDS);
  /** How dark the pixels within 3 of a point get against the wall beside them: an edge line shows as a dip. */
  const dip = (p: Point3, beside: Point3): number => {
    const lum = (sx: number, sy: number) => {
      const k = Math.round(sy - y) * width + Math.round(sx - x);
      return ((rgb[k * 3] ?? 0) + (rgb[k * 3 + 1] ?? 0) + (rgb[k * 3 + 2] ?? 0)) / 3;
    };
    const [q, r] = [at(p), at(beside)];
    let darkest = Infinity;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) darkest = Math.min(darkest, lum(q.x + dx, q.y + dy));
    return lum(r.x, r.y) - darkest;
  };

  const corner = dip({ x: 1.6, y: 0.1, z: 1.2 }, { x: 2.2, y: 0.1, z: 1.2 });
  expect(corner, "the partition's corner below 2.03 shows a line").toBeGreaterThan(20);
  for (const seam of [{ x: 1.4, y: 0.1, z: 2.6 }, { x: 1.6, y: 0.1, z: 2.6 }]) {
    expect(dip(seam, { x: 2.2, y: 0.1, z: 2.6 }), `no line at (${seam.x}, ${seam.y}, ${seam.z})`).toBeLessThan(corner / 3);
  }
});
