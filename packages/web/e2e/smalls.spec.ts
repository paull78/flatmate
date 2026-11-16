import { expect, test, type Page } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { moveTo } from "./support/canvas";
import { canvasOf, waitSaved } from "./support/app-driver";
import { anyPlace } from "./support/mcp-listing";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Small items in a real browser (cycle smalls): R during a drag; a hole's snap marker. Claude draws, the pointer acts.

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

async function open(page: Page, claude: McpClient, name: string): Promise<void> {
  project = `zz-smalls-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await claude.call("create_project", { name: project });
  await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
  await expect(page.getByTestId("project-name")).toHaveText(project);
}

async function rotationOf(claude: McpClient, kind: string): Promise<number> {
  const d: unknown = await claude.call("get_drawing");
  const objects: unknown[] = isRecord(d) && Array.isArray(d.objects) ? d.objects : [];
  const o = objects.filter(isRecord).find((x) => x.kind === kind);
  const p = anyPlace(o);
  return p && typeof p.rotation === "number" ? p.rotation : Number.NaN;
}

test("R during a drag turns the piece, and the drop lands turned (AC-01)", async ({ page }, info) => {
  const claude = await startMcp(SERVER);
  try {
    await open(page, claude, "r");
    await claude.call("place_object", { layout: "s0", kind: "sofa", centre: { x: 2, y: 2 }, rotation: 0 });
    const canvas = canvasOf(page);
    await expect.poll(() => rotationOf(claude, "sofa")).toBe(0);
    await moveTo(page, canvas, { x: 2, y: 2 });
    await page.mouse.down();
    await moveTo(page, canvas, { x: 3, y: 2 });
    await page.keyboard.press("r");
    await page.screenshot({ path: info.outputPath("r-mid-drag.png") });
    expect(await rotationOf(claude, "sofa")).toBe(0); // nothing committed yet
    await moveTo(page, canvas, { x: 3.4, y: 2 });
    await page.mouse.up();
    await waitSaved(page);
    await expect.poll(() => rotationOf(claude, "sofa")).toBe(90);
    await page.screenshot({ path: info.outputPath("r-dropped.png") });
  } finally {
    claude.close();
  }
});

test("the right button lists what's under the pointer; hover marks, a click selects, Esc closes (AC-06)", async ({ page }, info) => {
  const claude = await startMcp(SERVER);
  try {
    await open(page, claude, "list");
    await claude.call("set_ceiling", { height: 3.05 });
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 3, y: 2 }, width: 4, depth: 3 });
    const deck = isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string" ? added.result.deck : "";
    await claude.call("add_hole", { deck, centre: { x: 3, y: 2 }, width: 1.2, depth: 1.2 });
    await claude.call("place_object", { layout: "s0", kind: "block", centre: { x: 3, y: 2 }, rotation: 0 });
    const canvas = canvasOf(page);
    await expect.poll(() => rotationOf(claude, "block")).toBe(0);
    await moveTo(page, canvas, { x: 3, y: 2 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    const list = page.getByTestId("under-pointer");
    await expect(list.getByRole("menuitem")).toHaveText(["Custom box", "Hole", "Loft"]);
    await list.getByRole("menuitem", { name: "Hole" }).hover();
    await page.screenshot({ path: info.outputPath("list-hover-hole.png") });
    await list.getByRole("menuitem", { name: "Hole" }).click();
    await expect(list).toHaveCount(0);
    await expect(page.getByText("Hole", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("list-picked-hole.png") });

    await moveTo(page, canvas, { x: 3, y: 2 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    await moveTo(page, canvas, { x: 3, y: 2 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await expect(list).toBeVisible();
    await moveTo(page, canvas, { x: 0.5, y: 0.5 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(list).toHaveCount(0);
  } finally {
    claude.close();
  }
});

test("a hole's side on its deck's edge shows the marker and the word (AC-03)", async ({ page }, info) => {
  const claude = await startMcp(SERVER);
  try {
    await open(page, claude, "hole");
    await claude.call("set_ceiling", { height: 3.05 });
    await claude.call("add_deck", { preset: "loft", centre: { x: 3, y: 2 }, width: 4, depth: 3 });
    const canvas = canvasOf(page);
    await page.keyboard.press("h");
    await moveTo(page, canvas, { x: 2, y: 1.5 });
    await page.mouse.down();
    await moveTo(page, canvas, { x: 3, y: 3.49 });
    await page.screenshot({ path: info.outputPath("hole-mark.png") });
    await page.mouse.up();
    await waitSaved(page);
    await page.screenshot({ path: info.outputPath("hole-cut.png") });
  } finally {
    claude.close();
  }
});

test("at the Loft, H cuts that loft and the view stays there, with the marker (AC-10, AC-11)", async ({ page }, info) => {
  const claude = await startMcp(SERVER);
  try {
    await open(page, claude, "hole-loft");
    await claude.call("set_ceiling", { height: 3.05 });
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 3, y: 2 }, width: 4, depth: 3 });
    const deck = isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string" ? added.result.deck : "";
    const strip = page.getByTestId("level-strip").locator(`button[data-level="${deck}"]`);
    await strip.click();
    await expect(strip).toHaveAttribute("aria-pressed", "true");
    const canvas = canvasOf(page);
    await page.keyboard.press("h");
    await expect(page.locator('button[data-tool="hole"]')).toHaveAttribute("aria-pressed", "true");
    await expect(strip).toHaveAttribute("aria-pressed", "true"); // the view stayed
    await moveTo(page, canvas, { x: 2, y: 1.5 });
    await page.mouse.down();
    await moveTo(page, canvas, { x: 3, y: 3.49 });
    await page.screenshot({ path: info.outputPath("loft-hole-mark.png") });
    await page.mouse.up();
    await waitSaved(page);
    await expect(strip).toHaveAttribute("aria-pressed", "true");
    const d: unknown = await claude.call("get_drawing");
    const decks: unknown[] = isRecord(d) && Array.isArray(d.decks) ? d.decks : [];
    const loft = decks.filter(isRecord).find((k) => k.id === deck);
    expect(loft && Array.isArray(loft.holes) ? loft.holes.length : 0).toBe(1);
    await page.screenshot({ path: info.outputPath("loft-hole-cut.png") });
  } finally {
    claude.close();
  }
});
