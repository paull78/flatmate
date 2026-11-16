import { expect, test } from "@playwright/test";
import { openSection } from "./support/sections";
import { isRecord } from "@fm/protocol";
import { canvasOf, waitSaved } from "./support/app-driver";
import { moveTo } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// The trailer in a real browser (cycle trailer, AC-02, AC-06, AC-07): Claude builds a 7 × 2.5 house on wheels; with
// nothing selected the Trailer section sets the hitch to Left and three axles, which Claude reads back; a wheel well
// half under the long wall with a bench over it is accepted, and the pointer list under them names both.

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

const fieldsOf = async (claude: Awaited<ReturnType<typeof startMcp>>): Promise<Record<string, unknown>> => {
  const d: unknown = await claude.call("get_drawing");
  return isRecord(d) && isRecord(d.fields) ? d.fields : {};
};

test("the Trailer section sets the hitch and axles; a bench covers a wheel well half under the wall (AC-02, AC-06, AC-07)", async ({ page }) => {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-trailer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 7, depth: 2.5 });
    await claude.call("set_project_field", { key: "surroundings", value: "wheels" });
    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);

    const section = page.getByTestId("trailer-section");
    await openSection(section); // closed until opened (inherit step 06)
    await section.getByRole("button", { name: "Left" }).click();
    await waitSaved(page);
    await section.getByRole("button", { name: "Three" }).click();
    await waitSaved(page);
    await expect.poll(async () => { const f = await fieldsOf(claude); return [f.trailerHitch, f.trailerAxles]; }).toEqual(["low", "3"]);

    // A Single well (0.90 m) centred at y 0.15, its outer 0.15 m under the lower wall, and the default bench over it.
    await claude.call("place_object", { layout: "s0", kind: "wheelWell", preset: "Single", centre: { x: 3, y: 0.15 } });
    await claude.call("place_object", { layout: "s0", kind: "bench", centre: { x: 3, y: 0.325 } });
    const canvas = canvasOf(page);
    await moveTo(page, canvas, { x: 3, y: 0.25 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    const under = page.getByTestId("under-pointer");
    await expect(under.getByRole("menuitem", { name: "Bench" })).toBeVisible();
    await expect(under.getByRole("menuitem", { name: "Wheel well" })).toBeVisible();
  } finally {
    claude.close();
  }
});
