import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { COLORS } from "@fm/editor";
import { isRecord } from "@fm/protocol";
import { clickAt, dragFromTo, moveTo, type WorldPoint } from "./support/canvas";
import { openProject, waitSaved } from "./support/app-driver";
import { drawChain, pieces, type Piece } from "./support/pieces";
import { distance, expectPixel, pixelAt } from "./support/pixels";
import { deleteProjects, storedDocument } from "./support/stored";
import { SERVER } from "./support/server";
import { pickCard } from "./support/palette";

// The shapefit cycle in a real browser (step 04). A round table fits, highlights and is clicked by its circle
// (shapefit.01): chairs at 45° stand in its square's empty corners, placed and dragged without Ctrl (AC-03, AC-09),
// a click in an empty corner selects nothing and the highlight is round (AC-07). A bed's zone end handles sit at the
// middle of the zone's end sides (shapefit.03, AC-02); the rotation grip shows the grab cursor and turns (AC-01).
// The room is 6 × 4 with inner faces at x 0.1 / 5.9 and y 0.1 / 3.9; stored rows are read from the server.

const AWAY: WorldPoint = { x: 8, y: -1 }; // the cursor off the drawing, so no hover changes the probes
const ROOM = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }];

const canvasOf = (page: Page) => page.getByTestId("canvas");

let projects: string[] = [];
let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts) await c.close();
  await deleteProjects(projects);
  projects = [];
  contexts = [];
});

async function openFresh(browser: Browser): Promise<{ page: Page; project: string }> {
  const project = `zz-shapefit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  projects.push(project);
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  await openProject(page, project);
  await expect(page.getByTestId("project-name")).toHaveText(project);
  await drawChain(page, project, ROOM, [1, 1, 1, 1]);
  return { page, project };
}

/** The footprint centre of a stored piece: its anchor (the back edge's middle) moved d/2 toward the front. */
function centreOf(p: Piece): WorldPoint {
  const t = (p.rotation * Math.PI) / 180;
  return { x: p.at.x + (Math.sin(t) * p.d) / 2, y: p.at.y - (Math.cos(t) * p.d) / 2 };
}

function expectNear(p: WorldPoint, want: WorldPoint, within = 0.002): void {
  expect(Math.abs(p.x - want.x), `x ${p.x} vs ${want.x}`).toBeLessThanOrEqual(within);
  expect(Math.abs(p.y - want.y), `y ${p.y} vs ${want.y}`).toBeLessThanOrEqual(within);
}

const chairs = async (project: string): Promise<Piece[]> => (await pieces(project)).filter((p) => p.kind === "chair");

const hex = (rgb: number[]): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

test("chairs at 45° stand in a round table's empty corners, placed and dragged without Ctrl; one on the circle is refused; the table is clicked and highlighted by its circle (AC-03, AC-07, AC-09)", async ({ browser }) => {
  const { page, project } = await openFresh(browser);
  const canvas = canvasOf(page);
  const angle = page.locator('[data-field-id="angle"]');

  // The 0.90 table centred at T: its square x 2.65–3.55, y 1.65–2.55; its circle radius 0.45.
  const T = { x: 3.1, y: 2.1 };
  await pickCard(page, "roundTable");
  await clickAt(page, canvas, T);
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  const [table] = await pieces(project);
  if (table === undefined) throw new Error("no table");
  expectNear(centreOf(table), T, 0.001);

  // A chair at 0° on free floor, turned to 225° in Properties (R turns by 90°): the 45° footprint with its back to the
  // table, since a chair facing a piece you sit at would tuck under it (seating.11).
  await pickCard(page, "chair");
  await clickAt(page, canvas, { x: 1.6, y: 3.2 });
  await expect.poll(async () => (await chairs(project)).length).toBe(1);
  await waitSaved(page);
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 1.6, y: 3.2 });
  await angle.fill("225");
  await angle.press("Enter");
  await expect.poll(async () => (await chairs(project))[0]?.rotation).toBe(225);
  await waitSaved(page);
  const [turned] = await chairs(project);
  if (turned === undefined) throw new Error("no chair");
  const start = centreOf(turned);

  // AC-09: dragged without Ctrl into the top-left empty corner, by a delta on the 0.2 m step. Its centre (2.60, 2.60)
  // puts its front corner 0.482 from T, clear of the circle but inside the square; the guides from the square's
  // lines (its centre 0.05 from x 2.65 and y 2.55) would pull it onto the circle, so they don't apply.
  const left = { x: T.x - 0.5, y: T.y + 0.5 };
  const delta = { x: Math.round((left.x - start.x) / 0.2) * 0.2, y: Math.round((left.y - start.y) / 0.2) * 0.2 };
  const landing = { x: start.x + delta.x, y: start.y + delta.y };
  expectNear(landing, left, 0.011); // the fixture: the free chair's centre is on the step from the corner
  await dragFromTo(page, canvas, start, { x: start.x + delta.x, y: start.y + delta.y });
  await waitSaved(page);
  await expect.poll(async () => {
    const [c] = await chairs(project);
    return c ? Math.hypot(centreOf(c).x - landing.x, centreOf(c).y - landing.y) : null;
  }, { message: "the chair landed in the corner" }).toBeLessThanOrEqual(0.002);
  await expect(page.locator(".fm-toast")).toBeHidden();

  // AC-03, AC-09: a copy turned to 135° placed by a click in the top-right empty corner, without Ctrl. The ghost is centred
  // on the pointer: hover the original, pick it up, click 1.00 m to the right.
  const right = { x: landing.x + 1, y: landing.y };
  await moveTo(page, canvas, landing);
  await page.keyboard.press("ControlOrMeta+d");
  for (let i = 0; i < 3; i++) await page.keyboard.press("r"); // 225 + 270 = 135: its back to the table too
  await moveTo(page, canvas, right);
  await clickAt(page, canvas, right);
  await expect.poll(async () => (await chairs(project)).length).toBe(2);
  await waitSaved(page);
  const placed = await chairs(project);
  expect(placed.map((c) => c.rotation).sort()).toEqual([135, 225]);
  const centres = placed.map(centreOf).sort((a, b) => a.x - b.x);
  expectNear(centres[0] ?? AWAY, landing);
  expectNear(centres[1] ?? AWAY, right);
  for (const c of centres) expect(Math.hypot(c.x - T.x, c.y - T.y) - 0.225 * Math.SQRT2).toBeLessThan(0.45 * Math.SQRT2); // its corner is inside the square

  // AC-03: the copy dragged onto the circle (Ctrl: exactly where the pointer goes) is refused; it stays.
  await page.keyboard.down("Control");
  await dragFromTo(page, canvas, right, { x: right.x - 0.1, y: right.y - 0.1 });
  await page.keyboard.up("Control");
  await expect(page.locator(".fm-toast")).toBeVisible();
  const after = (await chairs(project)).map(centreOf).sort((a, b) => a.x - b.x);
  expectNear(after[1] ?? AWAY, right);

  // AC-07: a click in the square's empty bottom-right corner (0.566 from T) selects nothing; inside the circle the table.
  const corner = { x: 3.5, y: 1.7 };
  await page.keyboard.press("Escape");
  await clickAt(page, canvas, corner);
  await expect(angle).toHaveCount(0);
  await clickAt(page, canvas, { x: 3.3, y: 1.9 });
  await expect(angle).toHaveValue("0");
  await moveTo(page, canvas, AWAY);
  // The highlight fills the circle only. Probes sit 0.1 m off the 0.2 m grid lines; `floor` is far from every piece.
  await expectPixel(page, canvas, { x: 3.1, y: 1.85 }, COLORS.objectSelected);
  const floor = { x: 5.1, y: 1.7 };
  await expect.poll(async () => distance(await pixelAt(page, canvas, corner), hex(await pixelAt(page, canvas, floor)))).toBeLessThanOrEqual(12);
});

type Zones = Record<string, unknown>;

/** The stored zones of the one bed. */
async function bedZones(project: string): Promise<Zones | undefined> {
  const doc = await storedDocument(project);
  const bed = Object.values(doc.placements).find((p) => typeof p.object === "string" && doc.objects[p.object]?.kind === "bed");
  return bed && isRecord(bed.zones) ? bed.zones : undefined;
}

test("a bed's zone end handles sit at the middle of the end sides: the head end drags toward the foot, one undo; the rotation grip shows grab and turns (AC-01, AC-02)", async ({ browser }) => {
  const { page, project } = await openFresh(browser);
  const canvas = canvasOf(page);
  const cursor = () => canvas.evaluate((c) => c.style.cursor);
  const undo = page.locator('[data-testid="floating-bar"] [data-action="undo"]');

  // The bed: x 2.20–3.90, y 1.00–3.10, its foot (front) at y 1.00. The left zone: x 1.60–2.20, y 1.00–2.65 (0.45 head
  // inset), so its end handles are at (1.90, 1.00) and (1.90, 2.65), halfway across its 0.60 depth.
  await pickCard(page, "bed");
  await clickAt(page, canvas, { x: 3.05, y: 2.05 });
  await expect.poll(async () => (await pieces(project)).length).toBe(1);
  await waitSaved(page);
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 3.05, y: 2.05 });
  await expect(page.locator('[data-field-id="angle"]')).toHaveValue("0");

  const head = { x: 1.9, y: 2.65 };
  await moveTo(page, canvas, { x: 1.6, y: 2.65 }); // the zone's outer corner: no handle there any more
  await expect.poll(cursor).not.toBe("ns-resize");
  await moveTo(page, canvas, head);
  await expect.poll(cursor).toBe("ns-resize");

  await dragFromTo(page, canvas, head, { x: 1.9, y: 2.25 }); // 0.40 toward the foot: the head inset 0.45 → 0.85
  await waitSaved(page);
  await expect.poll(async () => (await bedZones(project))?.leftStart).toBe(0.85);
  expect((await bedZones(project))?.leftEnd).toBe(0);
  await undo.click();
  await waitSaved(page);
  await expect.poll(async () => (await bedZones(project))?.leftStart ?? null).toBeNull();

  // AC-01: the rotation grip, 24 px (0.30 m) beyond the foot's middle: grab on hover; a press 5 px off its centre turns.
  const grip = { x: 3.05, y: 0.7 };
  await moveTo(page, canvas, { x: 3.05, y: 2.05 });
  await expect.poll(cursor).not.toBe("grab");
  await moveTo(page, canvas, grip);
  await expect.poll(cursor).toBe("grab");
  const c = { x: 3.05, y: 2.05 };
  await dragFromTo(page, canvas, { x: grip.x + 5 / 80, y: grip.y }, { x: c.x + Math.SQRT1_2, y: c.y - Math.SQRT1_2 }); // −90° → −45°
  await expect(page.locator('[data-field-id="angle"]')).toHaveValue("45");
  await waitSaved(page);
  await expect.poll(async () => (await pieces(project))[0]?.rotation).toBe(45);
});
