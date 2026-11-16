import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { clickAt, dragFromTo, moveTo, type WorldPoint } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { startMcp, type McpClient } from "./support/mcp-stdio";
import { pixelAt } from "./support/pixels";
import { deleteProjects, storedDocument } from "./support/stored";
import { expectNoToast } from "./support/toasts";
import { SERVER } from "./support/server";
import { card, showGroup } from "./support/palette";

// Steps, winders and platform edges in a real browser (steps AC-01, AC-07, AC-12, AC-09): Storage steps and a Winder
// stair drawn from the palette at a deck's edge, the winder's "Enters from the left" and a rung ladder's "Hooks" from
// Properties, and a bar table dragged past a platform's edge, staying on it. Server mode; each room is seeded through a
// real stdio MCP process.
//
// A 6 × 5 room (inner faces x 0.1 / 5.9, y 0.1 / 4.9) under a 3.20 ceiling, with a loft along its west side
// (x 0.1–1.6, its east edge at x 1.6) and a solid platform at +0.45 over x 3.0–5.0, y 3.5–4.9 (its front edge y 3.5).

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 8, y: -1 };
const LOFT_EDGE = 1.6;

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

function newProject(): string {
  const name = `zz-steps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(name);
  return name;
}

const deckOf = (added: unknown): string => (isRecord(added) && isRecord(added.result) && typeof added.result.deck === "string" ? added.result.deck : "");

type Decks = { loft: string; platform: string };

async function seed(browser: Browser, more: (claude: McpClient, decks: Decks) => Promise<void> = async () => {}): Promise<{ page: Page; project: string } & Decks> {
  const project = newProject();
  const claude = await startMcp(SERVER);
  const decks = await (async (): Promise<Decks> => {
    try {
      await claude.call("create_project", { name: project });
      await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 5 });
      await claude.call("set_ceiling", { height: 3.2 });
      const made = {
        loft: deckOf(await claude.call("add_deck", { preset: "loft", centre: { x: 0.85, y: 2.5 }, width: 1.5, depth: 4.8 })),
        platform: deckOf(await claude.call("add_deck", { preset: "platform", centre: { x: 4, y: 4.2 }, width: 2, depth: 1.4 })),
      };
      await more(claude, made);
      return made;
    } finally {
      claude.close();
    }
  })();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return { page, project, ...decks };
}

/** Picks a stair tile in the palette's Stairs group and clicks twice at `at`, near a deck's edge (stairdraw.06). */
async function drawStair(page: Page, kind: string, label: string, at: WorldPoint): Promise<void> {
  await showGroup(page, "Stairs");
  const tile = card(page, kind);
  await expect(tile.locator(".palette-card-name")).toHaveText(label);
  await tile.click();
  await clickAt(page, canvasOf(page), at);
  await clickAt(page, canvasOf(page), at);
  await waitSaved(page);
  await page.keyboard.press("Escape");
}

type Stored = { kind: unknown; reaches: unknown; options: unknown; h: unknown; d: unknown; deck: unknown; at: unknown };
async function storedOf(project: string, kind: string): Promise<Stored[]> {
  const doc = await storedDocument(project);
  return Object.values(doc.placements).flatMap((p): Stored[] => {
    const object = typeof p.object === "string" ? doc.objects[p.object] : undefined;
    if (!object || object.kind !== kind || !isRecord(object.h) || !isRecord(object.d)) return [];
    return [{ kind: object.kind, reaches: object.reaches, options: object.options, h: object.h.standard, d: object.d.standard, deck: p.deck, at: p.at }];
  });
}

/** The sum of a pixel's channels: lower is darker. */
const lum = (rgb: number[]): number => rgb.slice(0, 3).reduce((s, c) => s + c, 0);

test("Storage steps drawn from the palette at the platform's edge reach it: 3 risers of 0.150 over 0.70 (AC-01)", async ({ browser }) => {
  const { page, project, platform } = await seed(browser);
  await drawStair(page, "storageSteps", "Storage steps", { x: 4.0, y: 3.3 });
  await expectNoToast(page);
  const [steps, ...others] = await storedOf(project, "storageSteps");
  expect(others).toEqual([]);
  expect(steps).toMatchObject({ reaches: platform, h: 0.45, d: 0.7 });
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: 4.0, y: 3.2 }); // on the steps, y 2.8–3.5
  await expect(page.locator('[data-field-id="risers"]')).toHaveValue("3 × 0.150");
});

test("a Winder stair drawn at the loft's edge enters from the right; Enters from: Left in Properties mirrors its walking line (AC-12)", async ({ browser }) => {
  const { page, project, loft } = await seed(browser);
  await drawStair(page, "winderStair", "Winder stair", { x: LOFT_EDGE + 0.35, y: 2.6 });
  await expectNoToast(page);
  const [winder] = await storedOf(project, "winderStair");
  expect(winder?.reaches).toBe(loft);
  // Its back on x 1.6 at y 2.6, its front at x 1.6 + 3.07: the walking line's dot 0.45 from the front edge, 0.36 to the
  // entry side: y 2.96 entering from the right (local +x is world +y at 90°), y 2.24 from the left.
  const d = typeof winder?.d === "number" ? winder.d : 3.07;
  const right = { x: LOFT_EDGE + d - 0.45, y: 2.6 + 0.36 };
  const left = { x: LOFT_EDGE + d - 0.45, y: 2.6 - 0.36 };
  const canvas = canvasOf(page);
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => lum(await pixelAt(page, canvas, right)) < lum(await pixelAt(page, canvas, left)), { message: "the dot on the right" }).toBe(true);

  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: LOFT_EDGE + 1.5, y: 2.6 });
  // "Enters from: Right | Left", a segmented control (steps.33).
  const entry = page.locator('[data-field-id="leftEntry"]');
  await expect(entry.locator('[data-value="false"]')).toHaveAttribute("aria-pressed", "true");
  await entry.locator('[data-value="true"]').click();
  await waitSaved(page);
  await expect.poll(async () => (await storedOf(project, "winderStair"))[0]?.options).toEqual({ leftEntry: true });
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => lum(await pixelAt(page, canvas, left)) < lum(await pixelAt(page, canvas, right)), { message: "the dot on the left" }).toBe(true);
});

test("Hooks on a rung ladder from Properties is stored and survives (AC-07)", async ({ browser }) => {
  const { page, project } = await seed(browser, async (claude, { loft }) => {
    await claude.call("add_stair", { layout: "s0", kind: "rungLadder", deck: loft, at: { x: LOFT_EDGE, y: 2.6 } });
  });
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), { x: LOFT_EDGE + 0.3, y: 2.6 });
  const hooks = page.locator('[data-field-id="hooks"]');
  await expect(hooks).toHaveAttribute("aria-checked", "false");
  await hooks.click();
  await waitSaved(page);
  await expect.poll(async () => (await storedOf(project, "rungLadder"))[0]?.options).toEqual({ hooks: true });
});

test("a bar table dragged 0.10 m past the platform's front edge stays on the platform (AC-09)", async ({ browser }) => {
  const { page, project, platform } = await seed(browser, async (claude, { platform: deck }) => {
    // Its centre at (4, 3.8), 0.60 deep: y 3.5–4.1, its front on the platform's front edge.
    await claude.call("place_object", { layout: "s0", kind: "barTable", centre: { x: 4, y: 3.8 }, on: deck });
  });
  await page.keyboard.press("v");
  await dragFromTo(page, canvasOf(page), { x: 4, y: 3.8 }, { x: 4, y: 3.6 });
  await waitSaved(page);
  await expectNoToast(page);
  const [bar] = await storedOf(project, "barTable");
  expect(bar?.deck).toBe(platform);
  // The anchor is the back edge's middle: from y 4.1 to 3.9, the table now y 3.3–3.9, 0.20 past y 3.5.
  expect(isRecord(bar?.at) ? bar.at.y : null).toBeCloseTo(3.9, 6);
});
