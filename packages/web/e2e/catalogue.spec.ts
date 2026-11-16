import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { clickAt, moveTo, type WorldPoint } from "./support/canvas";
import { openProject, waitSaved } from "./support/app-driver";
import { placeIn } from "./support/mcp-listing";
import { startMcp } from "./support/mcp-stdio";
import { drawChain, pieces, type Piece } from "./support/pieces";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { deleteProjects } from "./support/stored";
import { pickCard, showGroup } from "./support/palette";
import { SERVER } from "./support/server";

// Milestone 2 of the furnish cycle in a real browser (step 15), with the library cycle's rail and cards: the palette's
// groups and card shapes (AC-13, AC-16; library AC-01–AC-03), a bathroom laid out by clicks with corner pieces turned into their corners (AC-13, AC-14, AC-04), a Small
// single bed in a 0.95 m room (AC-17), and one piece of every new kind placed over MCP, with its class legend (AC-15),
// the retired blocks refused (AC-16), and the SVG and PDF exports filling each shape (AC-13). Stored rows are read from
// the server; the exports are saved under test-results/furnish-exports for the gate's validators.

const AWAY: WorldPoint = { x: 5.0, y: 0.5 }; // empty floor in every fixture below

/** A fill's point count → the strokes its outline and front draw: corner 3 + 1, rect 4 + 1, ell 6 + 2, quarter 10 + 8; a round piece with no front, a soft, a pan or a plant's canopy its ring alone. */
const OUTLINE: Record<number, number> = { 3: 4, 4: 5, 6: 8, 10: 18, 20: 20, 32: 32, 33: 33, 48: 48, 78: 78, 90: 90, 132: 132 };

/** The points of an SVG path's rings: one per M or L command. */
const fillPoints = (d: string): number => d.split(/[ML]/).length - 1;

/** The 22 MCP pieces' fill point counts, sorted: corner basin and Corner box 3, corner shower 10, round table and Round box 32. */
const SHAPES = [3, 3, ...Array.from({ length: 12 }, () => 4), 10, 20, 20, 32, 32, 33, 33, 33];

const canvasOf = (page: Page) => page.getByTestId("canvas");

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function openAs(browser: Browser, name: string, project: string, seeded = false): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  // A seeded project's own button, waited for: with its row missing, openProject would make a new one (clarity.40).
  if (seeded) await expect(page.getByRole("button", { name: project, exact: true })).toBeVisible();
  await openProject(page, project);
  await expect(page.getByTestId("project-name")).toHaveText(project);
  return page;
}

/** A fresh project name; the suffix keeps names apart when repeats run in parallel workers. */
function newProject(): string {
  const name = `zz-catalogue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(name);
  return name;
}

function expectNear(p: WorldPoint, want: WorldPoint, within = 0.001): void {
  expect(Math.abs(p.x - want.x), `x ${p.x} vs ${want.x}`).toBeLessThanOrEqual(within);
  expect(Math.abs(p.y - want.y), `y ${p.y} vs ${want.y}`).toBeLessThanOrEqual(within);
}

/** The one stored piece of `kind`. */
function pieceOf(all: Piece[], kind: string): Piece {
  const found = all.filter((p) => p.kind === kind);
  expect(found, kind).toHaveLength(1);
  const [piece] = found;
  if (piece === undefined) throw new Error(`no ${kind}`);
  return piece;
}

const hex = (rgb: number[]): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** The rail's groups and each group's cards in order: a kind, or a kind and its seat-count preset (library.05). */
const RAIL: [string, string[]][] = [
  ["Sleep", ["bed", "mattress", "liftBed", "loftBed", "murphyBed", "builtInTable", "sofaBed/2 seats", "sofaBed/3 seats", "nightstand", "cot"]],
  [
    "Sit and eat",
    [
      "foldingTable",
      "extendingTable/4 seats",
      "extendingTable/6 seats",
      "extendingTable/8 seats",
      "extendingTable/10 seats",
      "extendingTable/12 seats",
      "roundTable",
      "seatedDining/4 seats",
      "seatedDining/6 seats",
      "seatedDining/8 seats",
      "seatedDining/10 seats",
      "seatedRound/4 seats",
      "seatedRound/6 seats",
      "seatedRound/8 seats",
      "sofa/2 seats",
      "sofa/3 seats",
      "sofa/4 seats",
      "armchair",
      "chair",
      "stool",
      "barTable",
      "bench",
      "coffeeTable",
      "cornerSofa",
    ],
  ],
  ["Work", ["desk", "deskSet", "cornerDesk"]],
  ["Kitchen", ["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"]],
  ["Bathroom", ["toilet", "bidet", "washbasin", "vanityUnit", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine", "towelRail"]],
  ["Storage", ["wardrobe", "drawers", "storageChest", "shelf", "glassCabinet", "halfGlassCabinet", "tvUnit", "cornerWardrobe", "wallTv", "pegboard", "coatHooks", "coatStand"]],
  ["Sets", ["bedAndNightstands", "sofaAndRug"]],
  ["Basic", ["block", "roundBlock", "cornerBlock", "plant", "palm", "fern", "rosette", "radiator", "wheelWell", "beam", "woodStove", "electricFireplace", "wallUnit", "rug", "roundRug", "picture", "mirror", "clock"]],
  ["Stairs", ["stair", "openStair", "storageStair", "storageSteps", "winderStair", "shipsLadder", "alternatingTread", "rungLadder", "spiralStair"]],
  ["Floors", []], // floor finishes: cards by motif, not kind (finishes.08)
];

test("the palette's rail shows ten groups, one at a time, as a dark pill; 90 cards in the spec's order, each shape on its card (an aggregate's parts) with a detail beyond its outline, a bold name and a grey size; no retired block; the group survives a reload; search hides the rail and cards (AC-01, AC-02, AC-03, AC-13, AC-16)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  await expect(canvasOf(page)).toBeVisible();
  await expect(page.getByTestId("palette-column")).toHaveJSProperty("offsetWidth", 312); // library.08
  const rail = page.locator(".palette-rail-button");
  await expect(rail).toHaveCount(10);
  expect(await rail.evaluateAll((buttons) => buttons.map((b) => [b.getAttribute("data-group"), b.textContent, b.querySelectorAll("svg").length]))).toEqual(
    RAIL.map(([g]) => [g, g === "Sit and eat" ? "Sit & eat" : g, 1]),
  );
  await expect(page.locator('.palette-rail-button[aria-pressed="true"]')).toHaveAttribute("data-group", "Sleep"); // Sleep first
  const pill = await rail.first().evaluate((b) => getComputedStyle(b).backgroundColor);
  expect(pill).toBe("rgb(29, 29, 31)"); // --fm-text: the dark pill

  type Card = { id: string; fills: string[]; strokes: number; name: string; size: string };
  const all: Card[] = [];
  for (const [group, ids] of RAIL) {
    await showGroup(page, group);
    await expect(page.locator(".palette-rail-button[aria-pressed=\"true\"]")).toHaveAttribute("data-group", group);
    const cards = await page.locator(".palette-card[data-kind]").evaluateAll((buttons) =>
      buttons.map((b) => ({
        id: b.getAttribute("data-preset") === null ? (b.getAttribute("data-kind") ?? "") : `${b.getAttribute("data-kind") ?? ""}/${b.getAttribute("data-preset") ?? ""}`,
        fills: [...b.querySelectorAll('svg path[fill="#e0e0de"], svg path[fill="#ecebe6"]')].map((p) => p.getAttribute("d") ?? ""),
        strokes: b.querySelectorAll("svg line, svg path[fill=\"none\"]").length,
        name: b.querySelector(".palette-card-name")?.textContent ?? "",
        size: b.querySelector(".palette-card-size")?.textContent ?? "",
      })),
    );
    expect(cards.map((c) => c.id), group).toEqual(ids); // only this group's cards
    all.push(...cards);
  }
  expect(all).toHaveLength(99);
  for (const gone of ["kitchenBlock", "bathroomBlock", "builtInDesk"]) expect(all.some((c) => c.id === gone)).toBe(false);
  // Floors shows its switch and a card per motif (checked in finishes.spec); the last group shown is Floors.
  await expect(page.getByTestId("finishes-switch")).toBeVisible();

  const shaped: Record<string, number> = { nightstand: 20, washbasin: 20, toilet: 33, bidet: 33, plant: 78, palm: 90, fern: 132, rosette: 48, roundTable: 32, seatedRound: 32, roundBlock: 32, stool: 32, coatStand: 32, cornerShower: 10, cornerBasin: 3, cornerBlock: 3, cornerDesk: 6, cornerWardrobe: 6, cornerCounter: 6, cornerSofa: 6, roundRug: 32 };
  // An aggregate fills its parts (seating.15): each chair's rectangle, then its table's shape, last; a set of N seats
  // draws N chairs, the desk with chair one.
  const sets = ["seatedDining", "seatedRound"];
  for (const t of all) {
    const kind = t.id.split("/")[0] ?? "";
    const seats = Number(/\/(\d+) seats$/.exec(t.id)?.[1] ?? 0);
    if (t.id === "bedAndNightstands" || t.id === "sofaAndRug") { // its three pieces' fills (seated.06), each as its own piece draws it
      expect(t.fills, t.id).toHaveLength(3);
      continue;
    }
    expect(t.fills, t.id).toHaveLength(sets.includes(kind) ? seats + 1 : kind === "deskSet" ? 2 : 1);
    expect(t.fills.slice(0, -1).map(fillPoints), `${t.id} chairs`).toEqual(t.fills.slice(0, -1).map(() => 4));
    const n = fillPoints(t.fills.at(-1) ?? "");
    expect(n, `${t.id} fill points`).toBe(shaped[kind] ?? 4);
    // The plain desk is just its top (seating.04): no detail beyond its outline.
    if (kind !== "desk") expect(t.strokes, `${t.id} strokes beyond its outline`).toBeGreaterThan(OUTLINE[n] ?? Infinity);
    expect(t.name, t.id).not.toBe("");
    expect(t.size, t.id).toMatch(/^(\d+\.\d\d × \d+\.\d\d|Ø \d+\.\d\d) m$/);
  }
  const text = (id: string) => all.find((c) => c.id === id);
  expect(text("sofa/3 seats")).toMatchObject({ name: "Sofa · 3 seats", size: "2.10 × 0.90 m" });
  expect(text("roundTable")?.size).toMatch(/^Ø /);
  const nameStyle = await page.locator(".palette-card-name").first().evaluate((e) => getComputedStyle(e).fontWeight);
  expect(Number(nameStyle)).toBeGreaterThanOrEqual(600);

  // The chosen group survives a reload in this browser; typing hides the rail and the cards, clearing shows them again.
  await showGroup(page, "Work");
  await page.reload();
  await expect(canvasOf(page)).toBeVisible();
  await expect(page.locator('.palette-rail-button[aria-pressed="true"]')).toHaveAttribute("data-group", "Work");
  await page.getByTestId("quick-add-input").fill("bed");
  await expect(page.locator(".quick-add-row").first()).toBeVisible();
  await expect(rail).toHaveCount(0);
  await expect(page.locator(".palette-card")).toHaveCount(0);
  await page.getByTestId("quick-add-input").fill("");
  await expect(page.locator('.palette-rail-button[aria-pressed="true"]')).toHaveAttribute("data-group", "Work");
  await expect(page.locator(".palette-card[data-kind]")).toHaveCount(3);
});

test("a bathroom laid out by clicks: pieces flush on the walls and touching, the washing machine turned onto its wall, corner pieces turned into their corners with no key (AC-13, AC-14, AC-04)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const canvas = canvasOf(page);
  // Inner faces x 0.1 / 5.9, y 0.1 / 3.9.
  await drawChain(page, project, [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }], [1, 1, 1, 1]);

  type Step = { kind: string; pointer: WorldPoint; turns?: number; want: { w: number; d: number; at: WorldPoint; rotation: number } };
  const steps: Step[] = [
    // Back 0.05 below the top face, left side 0.05 right of the left face: flush into the corner.
    { kind: "bathtub", pointer: { x: 1.0, y: 3.5 }, want: { w: 1.7, d: 0.7, at: { x: 0.95, y: 3.9 }, rotation: 0 } },
    // Its left edge 1.85 pulled by a guide to the bathtub's right edge 1.80 (y is locked by the wall).
    { kind: "toilet", pointer: { x: 2.03, y: 3.6 }, want: { w: 0.36, d: 0.54, at: { x: 1.98, y: 3.9 }, rotation: 0 } },
    // Its left edge 2.21 pulled to the toilet's right edge 2.16.
    { kind: "washbasin", pointer: { x: 2.51, y: 3.65 }, want: { w: 0.6, d: 0.45, at: { x: 2.46, y: 3.9 }, rotation: 0 } },
    // The top-right corner turn (a shape-blind corner rule gives 0 at (5.5, 3.9)).
    { kind: "cornerShower", pointer: { x: 5.47, y: 3.47 }, want: { w: 0.8, d: 0.8, at: { x: 5.9, y: 3.5 }, rotation: 270 } },
    // The bottom-right corner turn from an R start of 90: the turn comes from the faces, not the start angle.
    { kind: "cornerBasin", pointer: { x: 5.64, y: 0.36 }, turns: 1, want: { w: 0.45, d: 0.45, at: { x: 5.675, y: 0.1 }, rotation: 180 } },
    // Its front, 0.05 above the bottom face, turns to be its back because the turned piece fits; no piece's line lies
    // within 0.125 of x 3.2 / 3.5 / 3.8.
    { kind: "washingMachine", pointer: { x: 3.5, y: 0.45 }, want: { w: 0.6, d: 0.6, at: { x: 3.5, y: 0.1 }, rotation: 180 } },
  ];
  for (const [i, s] of steps.entries()) {
    await pickCard(page, s.kind);
    await moveTo(page, canvas, s.pointer);
    for (let r = 0; r < (s.turns ?? 0); r++) await page.keyboard.press("r");
    await clickAt(page, canvas, s.pointer);
    await expect.poll(async () => (await pieces(project)).length, { message: `${s.kind} placed` }).toBe(i + 1);
    await waitSaved(page);
  }

  const all = await pieces(project);
  for (const s of steps) {
    const p = pieceOf(all, s.kind);
    expect(p.w, `${s.kind} w`).toBeCloseTo(s.want.w, 6);
    expect(p.d, `${s.kind} d`).toBeCloseTo(s.want.d, 6);
    expect(p.rotation, `${s.kind} rotation`).toBe(s.want.rotation);
    expectNear(p.at, s.want.at);
  }
});

test("a Small single bed picked in the size picker goes into a 0.95 m room unturned; the bed lists both narrow presets (AC-17)", async ({ browser }) => {
  const project = newProject();
  const page = await openAs(browser, "Alice", project);
  const canvas = canvasOf(page);
  // Inner faces x 0.1 / 1.05, y 0.1 / 2.9: a room 0.95 m wide.
  await page.locator('[data-snap-step="0.05"]').click();
  await drawChain(page, project, [{ x: 0, y: 0 }, { x: 1.15, y: 0 }, { x: 1.15, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 0 }], [1, 1, 1, 1]);
  await page.locator('[data-snap-step="auto"]').click();

  await pickCard(page, "bed");
  const picker = page.getByTestId("size-picker-select");
  await expect(picker.locator('option[value="Small single 85 × 195"]')).toHaveCount(1);
  await expect(picker.locator('option[value="Narrow single 95 × 205"]')).toHaveCount(1);
  await picker.selectOption("Small single 85 × 195");
  // Side gaps 0.055 and 0.045, both within the tolerance; the bed turned (1.95 long) can't fit across 0.95 m.
  await clickAt(page, canvas, { x: 0.58, y: 1.5 });
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);

  const all = await pieces(project);
  expect(all).toHaveLength(1);
  const bed = pieceOf(all, "bed");
  expect(bed.w).toBeCloseTo(0.85, 6);
  expect(bed.d).toBeCloseTo(1.95, 6);
  expect(bed.rotation).toBe(0);
  expect(bed.at.x - 0.425).toBeGreaterThanOrEqual(0.099);
  expect(bed.at.x + 0.425).toBeLessThanOrEqual(1.051);
  await expect(page.locator(".fm-toast")).toBeHidden();
});

type McpObject = { kind: string; sizes: Record<string, { width: number; depth: number }>; placements: Record<string, { sides: string[] } | null> };

/** get_drawing's objects (and classes, gone since mcp.12), checked field by field (the e2e package has no MCP types). */
function drawingOf(value: unknown): { objects: McpObject[]; classes: unknown } {
  if (typeof value !== "object" || value === null || !("objects" in value) || !Array.isArray(value.objects)) throw new Error("no objects");
  const objects = value.objects.map((o: unknown): McpObject => {
    if (typeof o !== "object" || o === null || !("kind" in o) || typeof o.kind !== "string") throw new Error("malformed object");
    if (!("sizes" in o) || typeof o.sizes !== "object" || o.sizes === null || !("placements" in o || "placement" in o)) {
      throw new Error("malformed object");
    }
    return { kind: o.kind, sizes: { ...o.sizes }, placements: { s0: placeIn(o, "s0") as { sides: string[] } | null } };
  });
  return { objects, classes: "classes" in value ? value.classes : undefined };
}

const FRONT = ["front"];
/** Each new kind's default size and use-zone sides (the spec's catalogue table and default zones), and its class. */
const NEW_KINDS: Record<string, { width: number; depth: number; sides: string[]; semanticClass: string }> = {
  toilet: { width: 0.36, depth: 0.54, sides: FRONT, semanticClass: "IfcSanitaryTerminal TOILETPAN" },
  bidet: { width: 0.36, depth: 0.54, sides: FRONT, semanticClass: "IfcSanitaryTerminal BIDET" },
  washbasin: { width: 0.6, depth: 0.45, sides: FRONT, semanticClass: "IfcSanitaryTerminal WASHHANDBASIN" },
  cornerBasin: { width: 0.45, depth: 0.45, sides: FRONT, semanticClass: "IfcSanitaryTerminal WASHHANDBASIN" },
  showerTray: { width: 0.8, depth: 0.8, sides: FRONT, semanticClass: "IfcSanitaryTerminal SHOWER" },
  cornerShower: { width: 0.8, depth: 0.8, sides: FRONT, semanticClass: "IfcSanitaryTerminal SHOWER" },
  bathtub: { width: 1.7, depth: 0.7, sides: FRONT, semanticClass: "IfcSanitaryTerminal BATH" },
  washingMachine: { width: 0.6, depth: 0.6, sides: FRONT, semanticClass: "IfcElectricAppliance WASHINGMACHINE" },
  hobUnit: { width: 0.6, depth: 0.6, sides: FRONT, semanticClass: "IfcElectricAppliance ELECTRICCOOKER" },
  sinkUnit: { width: 0.8, depth: 0.6, sides: FRONT, semanticClass: "IfcSanitaryTerminal SINK" },
  counter: { width: 0.6, depth: 0.6, sides: FRONT, semanticClass: "IfcFurniture USERDEFINED" },
  fridge: { width: 0.6, depth: 0.65, sides: FRONT, semanticClass: "IfcElectricAppliance FRIDGE_FREEZER" },
  dishwasher: { width: 0.6, depth: 0.6, sides: FRONT, semanticClass: "IfcElectricAppliance DISHWASHER" },
  ovenColumn: { width: 0.6, depth: 0.6, sides: FRONT, semanticClass: "IfcElectricAppliance ELECTRICCOOKER" },
  roundTable: { width: 0.9, depth: 0.9, sides: ["front", "back", "left", "right"], semanticClass: "IfcFurniture TABLE" },
  armchair: { width: 0.8, depth: 0.8, sides: FRONT, semanticClass: "IfcFurniture CHAIR" },
  coffeeTable: { width: 1.0, depth: 0.5, sides: [], semanticClass: "IfcFurniture TABLE" },
  tvUnit: { width: 1.2, depth: 0.4, sides: [], semanticClass: "IfcAudioVisualAppliance DISPLAY" },
  nightstand: { width: 0.45, depth: 0.4, sides: [], semanticClass: "IfcFurniture USERDEFINED" },
  roundBlock: { width: 0.6, depth: 0.6, sides: [], semanticClass: "IfcFurnishingElement USERDEFINED" },
  cornerBlock: { width: 0.6, depth: 0.6, sides: [], semanticClass: "IfcFurnishingElement USERDEFINED" },
};

/**
 * The 22 MCP pieces of a 12 × 7 room (inner faces x 0.1 / 11.9, y 0.1 / 6.9), centres, all at rotation 0. At least
 * 0.2 m apart and 0.05 m off the walls, so no piece's box in the export picks up a neighbour's strokes.
 */
const ROW_X = [1.0, 2.7, 4.4, 6.1, 7.8, 9.5, 11.2];
const LAYOUT: [string, WorldPoint][] = [
  ...["bathtub", "toilet", "bidet", "washbasin", "cornerBasin", "showerTray", "cornerShower"].map((k, i): [string, WorldPoint] => [k, { x: ROW_X[i] ?? 0, y: 5.6 }]),
  ["toilet", { x: 3.4, y: 5.6 }], // a second toilet: a class listed per object would show twice
  ...["washingMachine", "hobUnit", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn"].map((k, i): [string, WorldPoint] => [k, { x: ROW_X[i] ?? 0, y: 3.0 }]),
  ["roundTable", { x: 1.3, y: 1.3 }], // its left zone band (x 0.25–0.85) touches nothing, so it stays unwarned
  ...["armchair", "coffeeTable", "tvUnit", "nightstand", "roundBlock", "cornerBlock"].map((k, i): [string, WorldPoint] => [k, { x: ROW_X[i + 1] ?? 0, y: 1.2 }]),
];

const STROKES = ["#2a2c2f", "#8f9296"]; // COLORS.objectEdge and objectDetail; walls are #1a1a1a

/** The numbers of a path or a PDF line, as [x, y] pairs. */
const pairs = (numbers: number[]): [number, number][] => numbers.flatMap((v, i) => (i % 2 === 0 ? [[v, numbers[i + 1] ?? NaN] satisfies [number, number]] : []));

test("every new kind placed over MCP: default sizes and sides, no class legend, the retired blocks refused; the SVG and the PDF fill each shape and draw each piece's details; a selected round table highlights its rectangle (AC-13, AC-15, AC-16)", async ({ browser }) => {
  test.setTimeout(90_000);
  const project = newProject();
  const claude = await startMcp(SERVER);
  try {
    await claude.call("create_project", { name: project });
    await claude.call("draw_room", { corner: { x: 0, y: 0 }, width: 12, depth: 7 });
    for (const [kind, at] of LAYOUT) await claude.call("place_object", { layout: "s0", kind, centre: at });

    const drawing = drawingOf(await claude.call("get_drawing"));
    expect(drawing.objects).toHaveLength(22);
    for (const o of drawing.objects) {
      const want = NEW_KINDS[o.kind];
      if (want === undefined) throw new Error(`unexpected kind ${o.kind}`);
      expect(o.sizes.standard, o.kind).toMatchObject({ width: want.width, depth: want.depth }); // heights: catalogue tests in domain
      expect(o.placements.s0?.sides, o.kind).toEqual(want.sides);
    }
    expect(drawing.classes).toBeUndefined(); // the semantic classes left Claude's listing (mcp.12); the domain keeps them

    // On free floor (x 4.8–7.2 × y 3.95–4.55 and x 5.1–6.9 × y 3.5–5.0), so only retirement can refuse them.
    for (const kind of ["kitchenBlock", "bathroomBlock"]) {
      await expect(claude.call("place_object", { layout: "s0", kind, centre: { x: 6, y: 4.25 } })).rejects.toThrow();
    }
    expect(drawingOf(await claude.call("get_drawing")).objects).toHaveLength(22);
  } finally {
    claude.close();
  }

  const alice = await openAs(browser, "Alice", project, true);
  const canvas = canvasOf(alice);
  const exports = join(test.info().project.outputDir, "furnish-exports");
  const download = async (format: "svg" | "pdf", file: string): Promise<string> => {
    await alice.getByTestId("export-button").click();
    await expect(alice.getByTestId("sheets-view")).toBeVisible();
    if (format === "svg") await alice.getByTestId("images-button").click();
    const save = format === "svg" ? alice.locator('[data-format="svg"]') : alice.getByTestId("sheets-save-pdf");
    const [d] = await Promise.all([alice.waitForEvent("download"), save.click()]);
    const path = join(exports, file);
    await d.saveAs(path);
    await alice.getByTestId("sheets-close").click();
    await expect(alice.getByTestId("sheets-view")).toBeHidden();
    return path;
  };

  // SVG: planPicture fills each piece in PRESENTATION_STYLE.objectFill (#e0e0de), a colour no other layer uses.
  const svg = await readFile(await download("svg", "catalogue.svg"), "utf8");
  expect(svg.startsWith("<svg")).toBe(true);
  const fills = [...svg.matchAll(/<path d="([^"]+)" fill="#e0e0de"\/>/g)].map((m) => m[1] ?? "");
  expect(fills).toHaveLength(22);
  expect(fills.map(fillPoints).sort((a, b) => a - b)).toEqual(SHAPES);
  const lines = [...svg.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)" stroke="(#[0-9a-f]{6})"/g)]
    .filter((m) => STROKES.includes(m[5] ?? ""))
    .map((m) => [m[1], m[2], m[3], m[4]].map(Number));
  const arcs = [...svg.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)A[^"]*" fill="none" stroke="(#[0-9a-f]{6})"/g)]
    .filter((m) => STROKES.includes(m[3] ?? ""))
    .map((m) => [Number(m[1]), Number(m[2])]);
  for (const d of fills) {
    const points = pairs([...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0])));
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const box = { minX: Math.min(...xs) - 0.01, maxX: Math.max(...xs) + 0.01, minY: Math.min(...ys) - 0.01, maxY: Math.max(...ys) + 0.01 };
    const inside = (x: number | undefined, y: number | undefined): boolean =>
      x !== undefined && y !== undefined && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
    const strokes = lines.filter(([x1, y1, x2, y2]) => inside(x1, y1) && inside(x2, y2)).length + arcs.filter(([x, y]) => inside(x, y)).length;
    const n = fillPoints(d);
    expect(strokes, `the piece at ${d.slice(0, 24)}… draws a detail beyond its outline`).toBeGreaterThan(OUTLINE[n] ?? Infinity);
  }

  // PDF: one page (one layout, so no layout key); each fill is one line in #e0e0de, which has no alpha.
  const pdf = (await readFile(await download("pdf", "catalogue.pdf"))).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toMatch(/%%EOF\s*$/);
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
  const pdfFills = pdf.split("\n").filter((l) => l.startsWith("0.8784 0.8784 0.8706 rg ") && l.endsWith(" f"));
  expect(pdfFills).toHaveLength(22);
  expect(pdfFills.map((l) => l.split(" ").filter((t) => t === "m" || t === "l").length).sort((a, b) => a - b)).toEqual(SHAPES);

  // The round table's rectangle is x 0.85–1.75, y 0.85–1.75; `corner` is inside it but 0.566 from the centre, outside
  // the 0.45 circle; `floor` is outside it, in the unwarned left zone band. Both sit 0.1 m off the 0.2 m grid lines.
  const corner = { x: 0.9, y: 0.9 };
  const floor = { x: 0.7, y: 0.9 };
  await alice.keyboard.press("v");
  await moveTo(alice, canvas, AWAY);
  await expect.poll(async () => distance(await pixelAt(alice, canvas, corner), hex(await pixelAt(alice, canvas, floor)))).toBeLessThanOrEqual(12);
  await clickAt(alice, canvas, { x: 1.3, y: 1.3 });
  await moveTo(alice, canvas, AWAY);
  // The highlight fills the circle only, the shape fit checks (shapefit.01): inside it, not in the square's corner.
  await expectPixel(alice, canvas, { x: 1.3, y: 1.05 }, COLORS.objectSelected);
  await expect.poll(async () => distance(await pixelAt(alice, canvas, corner), hex(await pixelAt(alice, canvas, floor)))).toBeLessThanOrEqual(12);
});
