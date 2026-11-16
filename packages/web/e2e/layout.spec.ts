import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawSampleRoom, drawRectRoom, moveTo } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { SERVER } from "./support/server";
import { pickCard } from "./support/palette";

// The key scene (spec: layouts, AC-13 in the browser, AC-07): a studio flips from Day to Night.

const canvasOf = (page: Page) => page.getByTestId("canvas");

async function drawStudio(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await drawRectRoom(page, canvas, 5, 4);
}

/** Clicks an object (or the floor) with the Select tool and picks a configuration in Properties. */
async function configure(page: Page, at: { x: number; y: number }, config: string): Promise<void> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), at);
  await page.locator(`[data-field-id="config"] button[data-value="${config}"]`).click();
  await expect(page.locator(`[data-field-id="config"] button[data-value="${config}"]`)).toHaveAttribute("aria-pressed", "true");
}

/** The free floor of the room, read from its Properties after clicking its floor. */
async function freeFloor(page: Page): Promise<string | null> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: 0.6, y: 0.6 });
  return page.locator('[data-field-id="free"]').inputValue();
}

for (const renderer of ["canvas2d", "webgl"] as const) {
  test(`${renderer}: a studio flips from Day to Night: the bed folds down, the table folds away, the free floor changes`, async ({ page }) => {
    await page.goto(`/?name=Alice&server=off${renderer === "webgl" ? "&renderer=webgl" : ""}`);
    const canvas = canvasOf(page);
    await expect(canvas).toBeVisible();
    await drawStudio(page);
    await page.keyboard.press("z");
    await clickAt(page, canvas, { x: 0.6, y: 0.6 }); // label the room
    await pickCard(page, "murphyBed");
    await clickAt(page, canvas, { x: 2.5, y: 3.7 }); // folded, its back against the top wall
    await pickCard(page, "foldingTable");
    await clickAt(page, canvas, { x: 3.5, y: 1.5 });
    await configure(page, { x: 3.5, y: 1.5 }, "open");
    await page.getByTestId("state-name").fill("Day");
    await page.getByTestId("state-name").press("Enter");
    expect(await freeFloor(page)).toBe("16.64 m²"); // 4.8 × 3.8 − 1.6 × 0.4 − 1.2 × 0.8

    await page.getByTestId("state-add").click();
    await page.getByTestId("state-name").fill("Night");
    await page.getByTestId("state-name").press("Enter");
    await configure(page, { x: 2.5, y: 3.7 }, "down");
    await configure(page, { x: 3.5, y: 1.2 }, "folded");
    expect(await freeFloor(page)).toBe("14.70 m²"); // 18.24 − 1.6 × 2.1 − 1.2 × 0.15
    await page.keyboard.press("Escape");
    await moveTo(page, canvas, { x: 7, y: -1 }); // keep the cursor away from the probes

    // Day: the bed is folded, so (2, 2.8) shows the room's floor; Night: the bed covers it within the flip.
    const probe = { x: 2, y: 2.8 };
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.object), { timeout: 2000 }).toBeGreaterThan(12);
    const started = Date.now();
    await page.getByRole("button", { name: "Night", exact: true }).click();
    await expectPixel(page, canvas, probe, COLORS.object);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await freeFloor(page)).toBe("14.70 m²");
  });
}

test("Claude copies the layout and folds the bed down; a browser looking at the copy sees it live (AC-07)", async ({ page }) => {
  const project = `Studio ${Date.now()}`;
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByPlaceholder("Project name").fill(project);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  const canvas = canvasOf(page);
  await drawSampleRoom(page, canvas); // 6 × 4
  await pickCard(page, "murphyBed");
  await clickAt(page, canvas, { x: 2, y: 3.7 }); // folded against the top wall: x 1.2–2.8, y 3.5–3.9
  await expect(page.getByTestId("project-status")).toHaveText("saved");
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, { x: 8, y: -1 });

  const claude = await startMcp(SERVER);
  try {
    const list = await claude.call("list_projects");
    const id = (list as { projects: { id: string; name: string }[] }).projects.find((p) => p.name === project)?.id;
    expect(id).toBeDefined();
    const drawing = await claude.call("open_project", { id });
    const bed = (drawing as { objects: { id: string; kind: string }[] }).objects.find((o) => o.kind === "murphyBed")?.id;
    expect(bed).toBeDefined();
    const copy = await claude.call("copy_layout", { from: "s0", name: "Night" });
    const night = (copy as { result: { layout: { id: string } } }).result.layout.id;

    await page.getByRole("button", { name: "Night", exact: true }).click(); // look at the new layout
    const probe = { x: 1.5, y: 2.8 };
    await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.object), { timeout: 2000 }).toBeGreaterThan(12);
    await claude.call("set_configuration", { layout: night, object: bed, config: "down" });
    await expectPixel(page, canvas, probe, COLORS.object);
  } finally {
    claude.close();
  }
});
