import { expect, test } from "@playwright/test";
import { canvasOf } from "./support/app-driver";
import { moveTo } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Beams in a real browser (cycle beams, AC-01, AC-02, AC-08): Claude draws a 4 × 3 room with a second layout and a beam
// stretched into both walls; the browser opens it, and the pointer list over the beam names it in both layouts.

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

test("a beam into both walls stands in both layouts, and the pointer list over it names it (AC-01, AC-02, AC-08)", async ({ page }) => {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-beams-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 4, depth: 3 });
    await claude.call("add_layout", { name: "Night" });
    const placed: unknown = await claude.call("place_object", { layout: "s0", kind: "beam", centre: { x: 2, y: 1.5 } });
    const id = typeof placed === "object" && placed !== null && "result" in placed && typeof placed.result === "object" && placed.result !== null && "object" in placed.result ? String(placed.result.object) : "";
    await claude.call("set_size", { object: id, width: 4.2, depth: 0.15 }); // x −0.1 to 4.1: into both side walls

    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);
    const canvas = canvasOf(page);
    const pointAt = async (): Promise<void> => {
      await moveTo(page, canvas, { x: 2, y: 1.5 });
      await page.mouse.down({ button: "right" });
      await page.mouse.up({ button: "right" });
    };
    await pointAt();
    await expect(page.getByTestId("under-pointer").getByRole("menuitem", { name: "Beam" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Night", exact: true }).click();
    await pointAt();
    await expect(page.getByTestId("under-pointer").getByRole("menuitem", { name: "Beam" })).toBeVisible();
  } finally {
    claude.close();
  }
});
