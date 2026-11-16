import { expect, test } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { canvasOf, waitSaved } from "./support/app-driver";
import { clickAt, moveTo } from "./support/canvas";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";
import { deleteProjects } from "./support/stored";

// Guards in a real browser (cycle guards): a new loft has a rail, Properties changes it, Claude reads it, and None warns.

let project = "";
test.afterEach(async () => {
  if (project !== "") await deleteProjects([project]);
  project = "";
});

const guardOf = async (claude: Awaited<ReturnType<typeof startMcp>>, deck: string): Promise<unknown> => {
  const d: unknown = await claude.call("get_drawing");
  const decks: unknown[] = isRecord(d) && Array.isArray(d.decks) ? d.decks : [];
  const found = decks.filter(isRecord).find((k) => k.id === deck);
  return isRecord(found?.guards) && isRecord(found.guards.right) ? found.guards.right.kind : undefined; // the loft's one open side (edges.15)
};

test("a new loft has a Railing; Properties sets None, which warns, and Railing clears it (AC-01, AC-04, AC-09)", async ({ page }, info) => {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-guards-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("set_ceiling", { height: 3.05 });
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 1.5, y: 2 }, width: 2.8, depth: 3.8 });
    const deck = isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string" ? added.result.deck : "";
    expect(await guardOf(claude, deck)).toBe("railing");
    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);
    const canvas = canvasOf(page);

    await moveTo(page, canvas, { x: 1.5, y: 2 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.getByTestId("under-pointer").getByRole("menuitem", { name: "Loft" }).click();
    const field = page.locator('[data-field-id="guard.right"]');
    await expect(field).toBeVisible();
    await page.screenshot({ path: info.outputPath("guard-field.png") });

    await field.getByRole("button", { name: "None" }).click();
    await waitSaved(page);
    await expect.poll(() => guardOf(claude, deck)).toBe("none");
    await expect(page.getByText("No guard on Loft")).toHaveCount(0); // the list is closed
    const pill = page.getByTestId("warnings-pill");
    await expect(pill).toBeVisible();
    await page.screenshot({ path: info.outputPath("guard-none-warns.png") });
    await pill.click();
    await expect(page.getByText("No guard on Loft")).toBeVisible();

    await field.getByRole("button", { name: "Railing" }).click();
    await waitSaved(page);
    await expect.poll(() => guardOf(claude, deck)).toBe("railing");
    await expect(page.getByText("No guard on Loft")).toHaveCount(0);
  } finally {
    claude.close();
  }
});

const handrailOf = async (claude: Awaited<ReturnType<typeof startMcp>>, object: string): Promise<unknown> => {
  const d: unknown = await claude.call("get_drawing");
  const objects: unknown[] = isRecord(d) && Array.isArray(d.objects) ? d.objects : [];
  const stair = objects.filter(isRecord).find((o) => o.id === object)?.stair;
  return isRecord(stair) && isRecord(stair.handrails) ? stair.handrails.right : undefined; // a flight's right side (edges.06)
};

test("a stair on a Railing loft starts Railing; Properties sets its right side Glass, and Claude reads it (AC-13, edges AC-08)", async ({ page }, info) => {
  const claude = await startMcp(SERVER);
  try {
    project = `zz-guards-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await claude.call("set_ceiling", { height: 3.05 });
    // A loft over x 0.1–2.9, and a storage stair from its right edge at (2.9, 2), running +x to its foot at x 4.89.
    const added: unknown = await claude.call("add_deck", { preset: "loft", centre: { x: 1.5, y: 2 }, width: 2.8, depth: 3.8 });
    const deck = isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string" ? added.result.deck : "";
    const placed: unknown = await claude.call("add_stair", { layout: "s0", kind: "storageStair", deck, at: { x: 2.9, y: 2 } });
    const stair = isRecord(placed) && isRecord(placed.result) && typeof placed.result.object === "string" ? placed.result.object : "";
    expect(await handrailOf(claude, stair)).toBe("railing");
    await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
    await page.getByRole("button", { name: project, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByTestId("project-name")).toHaveText(project);

    await clickAt(page, canvasOf(page), { x: 4.5, y: 2 }); // the stair's foot, below the floor's cut
    const field = page.locator('[data-field-id="handrailRight"]');
    await expect(field).toBeVisible();
    await expect(field.getByRole("button", { name: "Railing" })).toHaveAttribute("aria-pressed", "true");
    await field.getByRole("button", { name: "Glass" }).click();
    await waitSaved(page);
    await expect.poll(() => handrailOf(claude, stair)).toBe("glass");
    await expect(field.getByRole("button", { name: "Glass" })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: info.outputPath("stair-handrail-glass.png") });
  } finally {
    claude.close();
  }
});
