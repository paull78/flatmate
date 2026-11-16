import { expect, test, type Browser, type Page } from "@playwright/test";
import { isRecord } from "@fm/protocol";
import { clickAt, dragFromTo, drawSampleRoom, drawRectRoom, moveTo, type WorldPoint } from "./support/canvas";
import { placeIn } from "./support/mcp-listing";
import { startMcp } from "./support/mcp-stdio";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { storedDocument } from "./support/stored";
import { SERVER } from "./support/server";
import { pickCard } from "./support/palette";

// Use-zone extents in the browser (furnish.14, .15, .20; AC-18..AC-21): a zone drag reaches a second browser and its
// undo follows, a copied layout keeps it, the bed's 0.45 m head inset keeps a nightstand at the head clear, an end
// handle trims a zone clear of a nightstand at the foot, and a project saved before this cycle (seeded by
// playwright.config.ts) opens with the default zones.

const canvasOf = (page: Page) => page.getByTestId("canvas");
const AWAY = { x: 8, y: -1 }; // keeps the cursor, its hover and the presence cursor away from the probes
const ZONE_KEYS = ["front", "back", "left", "right"].flatMap((s) => [`${s}Depth`, `${s}Start`, `${s}End`]);

async function openAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  return page;
}

async function placeTile(page: Page, kind: string, at: WorldPoint): Promise<void> {
  await pickCard(page, kind);
  await clickAt(page, canvasOf(page), at);
}

async function select(page: Page, at: WorldPoint): Promise<void> {
  await page.keyboard.press("v");
  await clickAt(page, canvasOf(page), at);
}

/** The floor's colour at `p` in this browser, as `#rrggbb`, with the pointer parked away. */
async function floorRef(page: Page, p: WorldPoint): Promise<string> {
  const rgb = await pixelAt(page, canvasOf(page), p);
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

type StoredPlacement = { id: string; kind: string; layout: string; zones: Record<string, unknown> };

/** The stored placements of a project, with their object's kind and their layout's name. */
async function storedPlacements(project: string): Promise<StoredPlacement[]> {
  const doc = await storedDocument(project);
  return Object.entries(doc.placements).flatMap(([id, p]): StoredPlacement[] => {
    const object = typeof p.object === "string" ? doc.objects[p.object] : undefined;
    const state = typeof p.state === "string" ? doc.states[p.state] : undefined;
    const kind = object?.kind;
    const layout = state?.name;
    if (typeof kind !== "string" || typeof layout !== "string" || !isRecord(p.zones)) return [];
    return [{ id, kind, layout, zones: p.zones }];
  });
}

/** The stored `zones` of the one placement of `kind` in `layout`. */
async function zonesOf(project: string, kind: string, layout: string): Promise<Record<string, unknown> | undefined> {
  return (await storedPlacements(project)).find((p) => p.kind === kind && p.layout === layout)?.zones;
}
const nulls = (keys: readonly string[]): Record<string, null> => Object.fromEntries(keys.map((k) => [k, null]));

test("a resized bed zone reaches a second browser; undo and redo follow; a copied layout keeps it (AC-18, AC-21)", async ({ browser }) => {
  const project = `Zones ${Date.now()}`;
  const alice = await openAs(browser, "Alice");
  await alice.getByPlaceholder("Project name").fill(project);
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByTestId("project-name")).toHaveText(project);
  const canvas = canvasOf(alice);
  const status = alice.getByTestId("project-status");
  await drawSampleRoom(alice, canvas);
  await expect(status).toHaveText("saved");

  await placeTile(alice, "bed", { x: 3.05, y: 2.05 }); // x 2.20–3.90, y 1.00–3.10; left zone x 1.60–2.20, y 1.00–2.65
  await expect(status).toHaveText("saved");
  await placeTile(alice, "chair", { x: 1.425, y: 1.45 }); // x 1.20–1.65, y 1.225–1.675: 0.05 into the 0.60 zone
  await expect(status).toHaveText("saved");
  await alice.getByTestId("state-add").click(); // "Layout 2", a copy, becomes active
  await expect(status).toHaveText("saved");
  await alice.getByRole("button", { name: "Layout", exact: true }).click();
  await expect(status).toHaveText("saved");

  const bob = await openAs(browser, "Bob");
  await bob.getByRole("button", { name: project }).click();
  await expect(bob.getByTestId("project-name")).toHaveText(project);
  await moveTo(alice, canvas, AWAY);
  await moveTo(bob, canvasOf(bob), AWAY);
  const P = { x: 1.7, y: 2.3 }; // in the 0.60 zone, outside the 0.40 one, off the chair
  const F = await floorRef(bob, { x: 0.9, y: 2.3 }); // off the 1 m grid line: the room has no label, so no floor fill
  const amber = async () => distance(await pixelAt(bob, canvasOf(bob), P), F);
  await expect.poll(amber, { timeout: 5000 }).toBeGreaterThan(12); // the chair blocks the zone

  await select(alice, { x: 3.05, y: 2.05 });
  await dragFromTo(alice, canvas, { x: 1.6, y: 1.825 }, { x: 1.8, y: 1.825 }); // the left depth handle: 0.60 → 0.40
  await moveTo(alice, canvas, AWAY);
  await expect(status).toHaveText("saved");
  await expectPixel(bob, canvasOf(bob), P, F);

  const twelve = nulls(ZONE_KEYS);
  await expect.poll(() => zonesOf(project, "bed", "Layout")).toEqual({ ...twelve, leftDepth: 0.4, leftStart: 0.45, leftEnd: 0 });
  expect(await zonesOf(project, "bed", "Layout 2")).toEqual(twelve);

  const bar = alice.getByTestId("floating-bar");
  await bar.locator('[data-action="undo"]').click();
  await expect.poll(amber, { timeout: 5000 }).toBeGreaterThan(12);
  await expect.poll(async () => (await zonesOf(project, "bed", "Layout"))?.leftDepth).toBeNull();

  await bar.locator('[data-action="redo"]').click();
  await expectPixel(bob, canvasOf(bob), P, F);
  await expect.poll(async () => (await zonesOf(project, "bed", "Layout"))?.leftDepth).toBe(0.4);

  await alice.getByTestId("state-add").click(); // "Layout 3", a copy of Layout
  await expect(status).toHaveText("saved");
  await expect.poll(() => zonesOf(project, "bed", "Layout 3")).toEqual({ ...twelve, leftDepth: 0.4, leftStart: 0.45, leftEnd: 0 });
});

test("a nightstand at the head raises no warning; trimming the zone's foot end clears one at the foot (AC-19, AC-20)", async ({ page }) => {
  const canvas = canvasOf(page);
  await page.goto("/?name=Alice&server=off");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 6, 4);
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 0.6, y: 0.6 });

  await placeTile(page, "bed", { x: 3.05, y: 2.05 }); // left zone x 1.60–2.20, y 1.00–2.65
  await placeTile(page, "nightstand", { x: 1.9, y: 2.9 }); // y 2.70–3.10: 0.05 above the zone's end
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  const Q = { x: 1.7, y: 2 };
  const G = await floorRef(page, { x: 1, y: 2 });
  await expectPixel(page, canvas, Q, G); // a full-side zone (y 1.00–3.10) would be amber here

  await placeTile(page, "nightstand", { x: 1.9, y: 1.3 }); // y 1.10–1.50 (or 1.00–1.40 aligned to the foot): in the zone
  await page.keyboard.press("Escape");
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => distance(await pixelAt(page, canvas, Q), G), { timeout: 5000 }).toBeGreaterThan(12);

  await select(page, { x: 3.05, y: 2.05 });
  await dragFromTo(page, canvas, { x: 1.9, y: 1 }, { x: 1.9, y: 1.8 }); // the foot-end handle, mid-end (shapefit.03): the zone becomes y 1.80–2.65
  await moveTo(page, canvas, AWAY);
  await expectPixel(page, canvas, Q, G);

  await page.locator('[data-testid="floating-bar"] [data-action="undo"]').click();
  await moveTo(page, canvas, AWAY);
  await expect.poll(async () => distance(await pixelAt(page, canvas, Q), G), { timeout: 5000 }).toBeGreaterThan(12);
});

test("a project saved before this cycle opens with the default zones and takes a zone drag (AC-20, AC-21)", async ({ page }) => {
  const project = "Pre-furnish bedroom";
  const twelve = nulls(ZONE_KEYS);
  const before = await storedPlacements(project); // the server fills `zones` on load, in memory
  expect(before.map((p) => p.zones)).toEqual([twelve, twelve, twelve]);

  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.getByRole("button", { name: project }).click();
  await expect(page.getByTestId("project-name")).toHaveText(project);
  const canvas = canvasOf(page);
  await moveTo(page, canvas, AWAY);
  const R = { x: 1.9, y: 3 }; // in the new left zone (y 1.80–3.45), below the nightstand (y 3.50–3.90)
  await expectPixel(page, canvas, R, await floorRef(page, { x: 1, y: 3 }));

  const claude = await startMcp(SERVER);
  try {
    await claude.call("open_project", { id: "pre-furnish" });
    type Drawing = {
      layouts: { id: string; blocked: unknown[] }[];
      objects: { id: string; kind: string; placements: Record<string, { zones: Record<string, unknown> } | null> }[];
    };
    const drawing = async (): Promise<Drawing> => {
      const d: unknown = await claude.call("get_drawing");
      if (!isRecord(d) || !Array.isArray(d.layouts) || !Array.isArray(d.objects)) throw new Error("not a drawing");
      return d as Drawing; // e2e, not core: the shape is get_drawing's
    };
    const zonesIn = (d: Drawing, kind: string): unknown => {
      const place = placeIn(d.objects.find((o) => o.kind === kind), "s0");
      return typeof place === "object" && place !== null && "zones" in place ? place.zones : undefined;
    };
    const first = await drawing();
    expect(first.layouts.find((s) => s.id === "s0")?.blocked).toEqual([]);
    expect(zonesIn(first, "bed")).toEqual({ left: { depth: 0.6, start: 0.45, end: 0 }, right: { depth: 0.6, start: 0.45, end: 0 } });
    expect(zonesIn(first, "desk")).toEqual({ front: { depth: 0.8, start: 0.25, end: 0.25 } });

    const desk = first.objects.find((o) => o.kind === "desk")?.id;
    await claude.call("set_size", { object: desk, width: 1.6, depth: 0.6 });
    expect(zonesIn(await drawing(), "desk")).toEqual({ front: { depth: 0.8, start: 0.45, end: 0.45 } }); // still 0.70, centred
  } finally {
    claude.close();
  }

  await select(page, { x: 3, y: 2.8 });
  await dragFromTo(page, canvas, { x: 1.55, y: 2.625 }, { x: 1.95, y: 2.625 }); // the left depth handle: 0.60 → 0.20
  await moveTo(page, canvas, AWAY);
  await expect(page.getByTestId("project-status")).toHaveText("saved");
  await expect.poll(() => zonesOf(project, "bed", "Layout")).toEqual({ ...twelve, leftDepth: 0.2, leftStart: 0.45, leftEnd: 0 });
});
