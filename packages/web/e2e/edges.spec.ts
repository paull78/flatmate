import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { canvasOf, waitSaved } from "./support/app-driver";
import { moveTo } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Loft edges in a real browser (cycle edges, AC-06, AC-10, AC-11): Claude builds a loft over part of a room; in
// Properties its open right side set to None warns by name, and Railing again clears it; at the loft's level the SVG
// export says "Open to below".

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

const rightOf = async (claude: Awaited<ReturnType<typeof startMcp>>, deck: string): Promise<unknown> => {
  const d: unknown = await claude.call("get_drawing");
  const decks: unknown[] = isRecord(d) && Array.isArray(d.decks) ? d.decks : [];
  const found = decks.filter(isRecord).find((k) => k.id === deck);
  return isRecord(found?.guards) && isRecord(found.guards.right) ? found.guards.right.kind : undefined;
};

test("a loft's right side set to None warns by name; at its level the SVG says Open to below (AC-06, AC-10, AC-11)", async ({ page }) => {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-edges-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("set_ceiling", { height: 3.05 });
    // A loft over x 0.1–2.9: its right side, at x 2.9, is its one open edge; the room's right part is open to below.
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 1.5, y: 2 }, width: 2.8, depth: 3.8 });
    const deck = isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string" ? added.result.deck : "";
    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);
    const canvas = canvasOf(page);

    await moveTo(page, canvas, { x: 1.5, y: 2 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.getByTestId("under-pointer").getByRole("menuitem", { name: "Loft" }).click();
    const right = page.locator('[data-field-id="guard.right"]');
    await expect(right).toBeVisible();
    await right.getByRole("button", { name: "None" }).click();
    await waitSaved(page);
    await expect.poll(() => rightOf(claude, deck)).toBe("none");
    await expect(page.locator('[data-field-id="guardHeight.right"]')).toHaveAttribute("readonly", "");
    await page.getByTestId("warnings-pill").click();
    await expect(page.getByText("No guard on Loft's right side")).toBeVisible();
    await right.getByRole("button", { name: "Railing" }).click();
    await waitSaved(page);
    await expect.poll(() => rightOf(claude, deck)).toBe("railing");
    await expect(page.getByTestId("warnings-pill")).toBeHidden();

    await page.keyboard.press("Escape");
    await page.keyboard.press("PageUp"); // the loft's level
    await page.getByTestId("export-button").click();
    await expect(page.getByTestId("sheets-view")).toBeVisible();
    await page.getByTestId("images-button").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-format="svg"]').click()]);
    const svg = await readFile(await download.path(), "utf8");
    expect(svg).toMatch(/>Open to below<|>Open to</);
    expect(svg).toContain("Loft +2.15");
  } finally {
    claude.close();
  }
});
