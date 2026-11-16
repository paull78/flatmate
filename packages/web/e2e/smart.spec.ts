import { expect, test, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, drawRectRoom, moveTo } from "./support/canvas";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { pickCard } from "./support/palette";

// Smart furniture in the browser (spec: layouts): a built-in unit open in one layout and closed in another (AC-01), size
// presets in Properties (AC-08) and the use-zone chips (AC-14). Local mode: no server.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 7, y: -1 }; // keeps the cursor and its hover away from the probes

/** A 6 × 4 room (inner faces 0.1 and 5.9 / 3.9, 22.04 m²), labelled so free floor shows and the floor is filled. */
async function labelledRoom(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.goto("/?name=Alice&server=off");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 6, 4);
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 0.6, y: 0.6 });
}

async function placeTile(page: Page, kind: string, at: { x: number; y: number }): Promise<void> {
  await pickCard(page, kind);
  await clickAt(page, canvasOf(page), at);
}

async function select(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), at);
}

/** Clicks an object with the Select tool and picks a configuration in Properties. */
async function configure(page: Page, at: { x: number; y: number }, config: string): Promise<void> {
  await select(page, at);
  await page.locator(`[data-field-id="config"] button[data-value="${config}"]`).click();
  await expect(page.locator(`[data-field-id="config"] button[data-value="${config}"]`)).toHaveAttribute("aria-pressed", "true");
}

/** The free floor of the room, read from its Properties after clicking its floor. */
async function freeFloor(page: Page): Promise<string | null> {
  await select(page, { x: 0.6, y: 0.6 });
  return page.locator('[data-field-id="free"]').inputValue();
}

async function renameLayout(page: Page, name: string): Promise<void> {
  await page.getByTestId("state-name").fill(name);
  await page.getByTestId("state-name").press("Enter");
}

test("a built-in table is open in Day and closed in Night; free floor and fit follow the layout (AC-01)", async ({ page }) => {
  await labelledRoom(page);
  const canvas = canvasOf(page);
  const unit = { x: 3, y: 3.72 }; // the cabinet: x 2.4–3.6, y 3.545–3.895, its back to the top wall
  await placeTile(page, "builtInTable", unit);

  await renameLayout(page, "Day");
  await configure(page, unit, "down"); // Open: y 2.745–3.895
  expect(await freeFloor(page)).toBe("20.66 m²"); // 22.04 − 1.20 × 1.15

  await page.getByTestId("state-add").click();
  await renameLayout(page, "Night");
  await configure(page, unit, "folded");
  expect(await freeFloor(page)).toBe("21.62 m²"); // 22.04 − 1.20 × 0.35
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);

  const probe = { x: 3.07, y: 3.03 }; // inside the open table, in front of the closed cabinet
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expectPixel(page, canvas, probe, COLORS.object);
  await page.getByRole("button", { name: "Night", exact: true }).click();
  await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.object), { timeout: 2000 }).toBeGreaterThan(12);

  // A chair where the table would open (y 2.975–3.425): opening is refused in Night and the unit stays closed.
  await placeTile(page, "chair", { x: 3, y: 3.2 });
  await select(page, unit);
  await page.locator('[data-field-id="config"] button[data-value="down"]').click();
  await expect(page.locator(".fm-toast")).toBeVisible();
  await expect(page.locator('[data-field-id="config"] button[data-value="folded"]')).toHaveAttribute("aria-pressed", "true");
});

test("picking a preset in Properties resizes the bed; a typed size shows Custom; each pick is one undo (AC-08)", async ({ page }) => {
  await labelledRoom(page);
  const canvas = canvasOf(page);
  await placeTile(page, "bed", { x: 3, y: 2 }); // 1.70 × 2.10: x 2.15–3.85, y 0.95–3.05
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  const probe = { x: 2.21, y: 2.1 }; // inside the 1.70 bed, outside the 1.50 one (x 2.25–3.75)
  await expectPixel(page, canvas, probe, COLORS.object);

  const preset = page.locator('[data-field-id="preset"]');
  const width = page.locator('[data-field-id="width"]');
  const depth = page.locator('[data-field-id="depth"]');
  const undo = page.locator('[data-testid="floating-bar"] [data-action="undo"]');
  await select(page, { x: 3, y: 2 });
  await expect(preset).toHaveValue("King");
  await expect(width).toHaveValue("1.70");

  await preset.selectOption({ label: "Double 150 × 210" });
  await expect(width).toHaveValue("1.50");
  await expect(depth).toHaveValue("2.10");
  await expect(preset).toHaveValue("Double");
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.object), { timeout: 2000 }).toBeGreaterThan(12);

  await select(page, { x: 3, y: 2 });
  await preset.selectOption({ label: "US Queen 162 × 213" }); // a preset sets the depth too
  await expect(width).toHaveValue("1.62");
  await expect(depth).toHaveValue("2.13");
  await expect(preset).toHaveValue("US Queen");

  await width.fill("1.71");
  await width.press("Enter");
  await expect(width).toHaveValue("1.71");
  await expect(preset).toHaveValue("custom");

  await undo.click();
  await expect(preset).toHaveValue("US Queen");
  await undo.click();
  await expect(preset).toHaveValue("Double");
  await expect(depth).toHaveValue("2.10");
  await undo.click();
  await expect(preset).toHaveValue("King");
  await expect(width).toHaveValue("1.70");
});

test("clicking a zone chip turns that side off in this layout; undo turns it back on (AC-14)", async ({ page }) => {
  await labelledRoom(page);
  const canvas = canvasOf(page);
  await placeTile(page, "bed", { x: 3, y: 2 }); // x 2.15–3.85; its left zone x 1.55–2.15 (left is local −x)
  await placeTile(page, "chair", { x: 1.85, y: 2 }); // x 1.625–2.075, inside the bed's left zone
  const left = page.locator('[data-field-id="sides.left"]');
  const right = page.locator('[data-field-id="sides.right"]');
  await select(page, { x: 3, y: 2 });
  await expect(left).toHaveAttribute("aria-checked", "true");

  await moveTo(page, canvas, AWAY);
  const probe = { x: 1.62, y: 2.3 }; // in the left zone (y 0.95–2.6, 0.45 m short of the head), off the chair, clear of the chips and grips
  await expect.poll(async () => distance(await pixelAt(page, canvas, probe), COLORS.object), { timeout: 2000 }).toBeGreaterThan(12);
  const before = await pixelAt(page, canvas, probe); // amber: the chair blocks the zone
  const hex = `#${before.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  await clickAt(page, canvas, { x: 1.35, y: 1.775 }); // the "×" chip, 16 px beyond the left zone's depth handle (1.55, 1.775)
  await expect(left).toHaveAttribute("aria-checked", "false");
  await expect(right).toHaveAttribute("aria-checked", "true");
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => distance(await pixelAt(page, canvas, probe), hex), { timeout: 2000 }).toBeGreaterThan(12);

  await page.locator('[data-testid="floating-bar"] [data-action="undo"]').click();
  await expect(left).toHaveAttribute("aria-checked", "true");
  await expectPixel(page, canvas, probe, hex);
});
