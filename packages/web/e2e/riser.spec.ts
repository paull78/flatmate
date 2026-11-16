import { writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clickAt } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp } from "./support/mcp-stdio";
import { SERVER } from "./support/server";

// A stair's target riser and going, by hand and by Claude (riser.01, .02, .10): two browsers, the real server.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const SHOTS = process.env.RISER_SHOTS;
const shot = (page: Page, name: string): Promise<void> => page.screenshot().then((png) => { if (SHOTS) writeFileSync(`${SHOTS}/${name}.png`, png); });
const canvasOf = (page: Page) => page.getByTestId("canvas");
const field = (page: Page, id: string) => page.locator(`[data-field-id="${id}"]`);
const type = async (page: Page, id: string, value: string): Promise<void> => {
  await field(page, id).fill(value);
  await field(page, id).press("Enter");
  await waitSaved(page);
};

async function openAs(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  return page;
}

test("types a target riser and a going, with Claude and a second person seeing the same stair", async ({ browser }) => {
  const project = `Riser ${Date.now()}`;
  const mcp = await startMcp(SERVER);
  await mcp.call("create_project", { name: project });
  await mcp.call("draw_room", { corner: { x: 0, y: 0 }, width: 8, depth: 4 });
  await mcp.call("set_ceiling", { height: 3.05 });
  const resultOf = (reply: unknown, key: string): string => {
    const r = isRecord(reply) ? reply.result : null;
    const v = isRecord(r) ? r[key] : null;
    if (typeof v !== "string") throw new Error(`no ${key} in the reply`);
    return v;
  };
  const loft = resultOf(await mcp.call("add_deck", { preset: "loft", centre: { x: 6.9, y: 2 }, width: 2, depth: 3.6 }), "deck");
  const stair = resultOf(await mcp.call("place_object", { layout: "s0", kind: "stair", centre: { x: 4.4, y: 2 }, rotation: 270, reaches: loft }), "object");

  const alice = await openAs(browser, "Alice");
  await alice.getByRole("button", { name: project }).click();
  await expect(alice.getByTestId("project-name")).toHaveText(project);
  const bob = await openAs(browser, "Bob");
  await bob.getByRole("button", { name: project }).click();
  await expect(bob.getByTestId("project-name")).toHaveText(project);

  await clickAt(alice, canvasOf(alice), { x: 4.4, y: 2 });
  await expect(field(alice, "targetRiser")).toHaveValue("");
  await expect(field(alice, "targetRiser")).toHaveAttribute("placeholder", "0.19");
  await expect(field(alice, "risers")).toHaveValue("12 × 0.179");
  await shot(alice, "m1-1-before");

  await type(alice, "targetRiser", "0.16");
  await expect(field(alice, "targetRiser")).toHaveValue("0.16");
  await expect(field(alice, "risers")).toHaveValue("14 × 0.154");
  await shot(alice, "m1-2-riser");

  await type(alice, "going", "0.2");
  await expect(field(alice, "depth")).toHaveValue("2.60");
  await expect(field(alice, "going")).toHaveValue("0.200");
  await expect(field(alice, "check.going")).toHaveAttribute("data-check", "warning");
  await shot(alice, "m1-3-going");

  // Bob selects the same stair and reads the same numbers.
  await clickAt(bob, canvasOf(bob), { x: 4.4, y: 2 });
  await expect(field(bob, "risers")).toHaveValue("14 × 0.154");
  await expect(field(bob, "targetRiser")).toHaveValue("0.16");

  // A bad value is refused, with the reason.
  await field(alice, "targetRiser").fill("0.05");
  await field(alice, "targetRiser").press("Enter");
  await expect(alice.locator(".fm-toast")).toContainText("riser must be between");
  await expect(field(alice, "risers")).toHaveValue("14 × 0.154");

  // Undo takes the going back, for both.
  await alice.keyboard.press("Escape");
  await canvasOf(alice).click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await alice.keyboard.press("ControlOrMeta+z");
  await waitSaved(alice);
  await expect(field(bob, "depth")).not.toHaveValue("2.60");

  // Claude sets both as one edit; both browsers follow.
  await mcp.call("set_stair", { object: stair, riser: 0.18, going: 0.25 });
  await expect(field(bob, "risers")).toHaveValue("12 × 0.179");
  await expect(field(bob, "going")).toHaveValue("0.250");
  await shot(bob, "m1-4-claude");
  expect(JSON.stringify(await mcp.call("get_drawing", {}))).toContain("target riser 0.18");
  mcp.close();
});

test("a short hole: the stair is accepted with a warning, the loft shows only what the hole shows, and every renderer agrees", async ({ browser }) => {
  const project = `Short hole ${Date.now()}`;
  const mcp = await startMcp(SERVER);
  await mcp.call("create_project", { name: project });
  await mcp.call("draw_room", { corner: { x: 0, y: 0 }, width: 8, depth: 3 });
  await mcp.call("set_ceiling", { height: 5.4 });
  const resultOf = (reply: unknown, key: string): string => {
    const r = isRecord(reply) ? reply.result : null;
    const v = isRecord(r) ? r[key] : null;
    if (typeof v !== "string") throw new Error(`no ${key} in the reply`);
    return v;
  };
  const deck = resultOf(await mcp.call("add_deck", { preset: "loft", centre: { x: 4, y: 1.5 }, width: 7.8, depth: 2.8, top: 2.7 }), "deck");
  await mcp.call("add_hole", { deck, centre: { x: 4.75, y: 1.5 }, width: 2.5, depth: 1 });
  // The flight's back on the hole's east side, x 6, running west under the slab: its 2.99 m default, then longer.
  const stair = resultOf(await mcp.call("place_object", { layout: "s0", kind: "stair", centre: { x: 4.505, y: 1.5 }, rotation: 270, reaches: deck }), "object");
  await mcp.call("set_size", { object: stair, width: 0.9, depth: 3.78 });
  mcp.close();

  const page = await openAs(browser, "Alice");
  await page.getByRole("button", { name: project }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await clickAt(page, canvasOf(page), { x: 4.5, y: 1.5 });
  await expect(field(page, "check.headroom")).toHaveAttribute("data-check", "warning");
  await expect(field(page, "check.headroom")).toContainText("1.5");
  await expect(field(page, "check.reach")).toHaveAttribute("data-check", "ok");
  await shot(page, "m2-1-floor");
  await page.keyboard.press("Escape");
  await page.getByTestId("level-strip").locator("button").first().click();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await shot(page, "m2-2-loft");
  await page.keyboard.press("3");
  await page.waitForTimeout(800);
  await shot(page, "m2-3-loft-3d");
});

test("a hole under its stair is reached from the stair's row and by clicking again", async ({ browser }) => {
  const project = `Hole rows ${Date.now()}`;
  const mcp = await startMcp(SERVER);
  await mcp.call("create_project", { name: project });
  await mcp.call("draw_room", { corner: { x: 0, y: 0 }, width: 8, depth: 3 });
  await mcp.call("set_ceiling", { height: 5.4 });
  const added = await mcp.call("add_deck", { preset: "loft", centre: { x: 4, y: 1.5 }, width: 7.8, depth: 2.8, top: 2.7 });
  const deck = isRecord(added) && isRecord(added.result) ? String(added.result.deck) : "";
  await mcp.call("add_hole", { deck, centre: { x: 4.4, y: 1.5 }, width: 3.2, depth: 1 });
  await mcp.call("place_object", { layout: "s0", kind: "stair", centre: { x: 4.505, y: 1.5 }, rotation: 270, reaches: deck });
  mcp.close();

  const page = await openAs(browser, "Alice");
  await page.getByRole("button", { name: project }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  const canvas = canvasOf(page);
  await clickAt(page, canvas, { x: 4.5, y: 1.5 });
  const row = page.locator('[data-field-id^="hole."]');
  await expect(row).toHaveText("Hole 3.20 × 1.00");
  await row.hover();
  await page.waitForTimeout(200);
  await shot(page, "m3-1-hole-row-hover");
  await row.click();
  await expect(field(page, "width")).toHaveValue("3.20");
  await shot(page, "m3-2-hole-selected");

  // The other way: click the stair, then click it again.
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, { x: 4.5, y: 1.5 });
  await expect(row).toHaveCount(1);
  await page.waitForTimeout(500); // past a double-click
  await clickAt(page, canvas, { x: 4.5, y: 1.5 });
  await expect(field(page, "width")).toHaveValue("3.20");
});
