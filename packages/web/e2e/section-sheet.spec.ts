import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PRESENTATION_STYLE } from "@fm/editor";
import { drawRectRoom } from "./support/canvas";
import { waitSaved } from "./support/app-driver";
import { SERVER } from "./support/server";
import { deleteProjects, storedDocument } from "./support/stored";
import { copyStudio } from "./support/studio-copy";

// A Section sheet through the real server (spec "On paper", AC-10's model): offered once there's a section, stored, and
// read back. The studio's copy is a project saved before the kind existed, given two sections.

const SECTIONS = {
  A: { id: "A", a: { x: -0.5, y: 1.25 }, b: { x: 7.5, y: 1.25 }, side: 1, depth: null },
  B: { id: "B", a: { x: 5.75, y: -0.5 }, b: { x: 5.75, y: 3 }, side: 1, depth: null },
};

let projects: string[] = [];
test.afterEach(async () => {
  await deleteProjects(projects);
  projects = [];
});

const menuItem = (page: Page) => page.getByTestId("sheets-add-menu").locator('[data-kind="section"]');

test("with no section, Section is off in the menu and says why", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRectRoom(page, canvas, 5, 4);
  await page.getByTestId("export-button").click();
  await page.getByTestId("sheets-add").click();
  await expect(menuItem(page)).toBeDisabled();
  await expect(menuItem(page)).toHaveAttribute("title", "Draw a section first");
});

test("a Section sheet is added from the menu, picks its section and is stored", async ({ page }) => {
  const name = `Sheet ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  await copyStudio(name, (doc) => ({ ...doc, sections: SECTIONS }));
  projects.push(name);
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.getByTestId("export-button").click();
  const rows = await page.getByTestId("sheet-row").count();

  await page.getByTestId("sheets-add").click();
  await menuItem(page).click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(rows + 1);
  await waitSaved(page);
  await expect(page.getByText("Section sheet", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sheet-title")).toHaveValue("Section A–A");
  await expect(page.getByTestId("sheet-finishes")).toHaveCount(0);

  await page.getByRole("group", { name: "Section", exact: true }).getByRole("button", { name: "B–B" }).click();
  await expect(page.getByTestId("sheet-title")).toHaveValue("Section B–B");
  await waitSaved(page);

  const sheets = Object.values((await storedDocument(name)).sheets);
  expect(sheets.filter((s) => s.kind === "section")).toEqual([expect.objectContaining({ kind: "section", section: "B", title: "Section B–B" })]);
  expect(sheets.filter((s) => s.kind !== "section").every((s) => s.section === null)).toBe(true);
  expect(sheets.length).toBeGreaterThan(1); // the check above ran on the studio's own sheets too
});

/** A colour as the PDF writer's `rg` prints it: "#2a2a2a" → "0.1647 0.1647 0.1647". */
const rgOf = (hex: string): string => [1, 3, 5].map((i) => String(Math.round((Number.parseInt(hex.slice(i, i + 2), 16) / 255) * 1e4) / 1e4)).join(" ");

/** Each page's operators, in order: the writer's streams are uncompressed, and with no image they're all pages. */
const pageContents = (pdf: string): string[] => Array.from(pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g), (m) => m[1] ?? "");

/** What a page draws inside each of its clips, in order. */
const clipped = (content: string): string[] => content.split(/ re W n\n/).slice(1).map((after) => after.split("\nQ\n")[0] ?? "");

/** Where the fills of one colour reach, in points, y up, in the writer's own line of operators. */
function fillsBox(content: string, rgb: string): { left: number; right: number; bottom: number; top: number } {
  const lines = content.split("\n").filter((l) => l.startsWith(`${rgb} rg `) && / f\*?$/.test(l));
  const points = lines.flatMap((l) => Array.from(l.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g), (m) => ({ x: Number(m[1]), y: Number(m[2]) })));
  expect(points.length).toBeGreaterThan(0);
  const [xs, ys] = [points.map((p) => p.x), points.map((p) => p.y)];
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}

/** One page of a PDF through a real renderer: the RGB at a point on it, in points from its bottom left. */
async function renderedPage(file: string, dir: string, page: number, dpi: number): Promise<(x: number, y: number) => number[]> {
  const out = join(dir, `page-${page}`);
  execFileSync("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), "-singlefile", file, out]);
  const ppm = await readFile(`${out}.ppm`);
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 40).toString("latin1"));
  if (!header) throw new Error("not a PPM");
  const [width, height] = [Number(header[1]), Number(header[2])];
  return (x, y) => {
    const at = header[0].length + ((height - Math.round((y * dpi) / 72)) * width + Math.round((x * dpi) / 72)) * 3;
    return [ppm[at] ?? -1, ppm[at + 1] ?? -1, ppm[at + 2] ?? -1];
  };
}

test("Save PDF prints the section as vector: Day against Night, to scale, and a real renderer paints the cut", async ({ page }) => {
  const name = `Sheet ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  await copyStudio(name, (doc) => ({ ...doc, sections: SECTIONS }));
  projects.push(name);
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.getByTestId("export-button").click();
  const before = await page.getByTestId("sheet-row").count();

  // Both sections are offered, on the studio's own list, and Add draws one for the viewed layout.
  await expect(page.getByTestId("sheets-missing-section-add")).toHaveCount(2);
  await page.getByTestId("sheets-missing-section-add").first().click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(before + 1);
  await expect(page.getByTestId("sheets-missing-section-add")).toHaveCount(1);
  await expect(page.getByTestId("sheet-title")).toHaveValue("Section A–A");
  await waitSaved(page);

  await page.getByTestId("sheet-pane").nth(1).click();
  await expect(page.locator('[data-testid="sheet-pane"]:checked')).toHaveCount(2);
  await waitSaved(page);
  await page.getByRole("group", { name: "Scale", exact: true }).getByRole("button", { name: "1:50" }).click();
  await waitSaved(page);
  await page.getByRole("group", { name: "Split", exact: true }).getByRole("button", { name: "Stacked" }).click();
  await waitSaved(page);
  await expect(page.locator(".sheets-sheet.picked").getByTestId("sheet-frame")).toHaveCount(2); // drawn on screen, in both panes

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sheets-save-pdf").click()]);
  const file = await download.path();
  const pdf = (await readFile(file)).toString("latin1");
  const pages = pageContents(pdf);
  expect(pages).toHaveLength(before + 1);
  const at = pages.findIndex((content) => content.includes("(SECTION A\\226A"));
  expect(at).toBeGreaterThanOrEqual(0);
  const sheet = pages[at];
  if (sheet === undefined) throw new Error("no section page");

  // Vector: no image anywhere in the file, each pane a clip, its fills and its text real operators.
  expect(pdf).not.toContain("/Subtype /Image");
  const panes = clipped(sheet);
  expect(panes).toHaveLength(2);
  for (const pane of panes) {
    expect(pane).toContain("(+3.05) Tj"); // the studio's ceiling
    expect(pane).toContain("(\\2610.00) Tj"); // ±, in Windows-1252's octal
  }
  expect(sheet).toContain("(DAY) Tj");
  expect(sheet).toContain("(NIGHT) Tj");

  // To scale at 1:50, in points: 8 m of line, and 3.05 m of ceiling with its two 0.10 m bands.
  const mm = 72 / 25.4;
  const [top, foot] = panes.map((pane) => fillsBox(pane, rgOf(PRESENTATION_STYLE.section.cut)));
  if (!top || !foot) throw new Error("not two panes");
  expect(top.right - top.left).toBeCloseTo(160 * mm, 1);
  expect(top.top - top.bottom).toBeCloseTo(65 * mm, 1);
  expect(foot.left).toBeCloseTo(top.left, 1); // one framing
  expect(foot.top - foot.bottom).toBeCloseTo(65 * mm, 1);

  // A real renderer: the top pane's bands, and the paper past them, at the middle of the line.
  const dir = await mkdtemp(join(tmpdir(), "fm-section-pdf-"));
  try {
    const pixel = await renderedPage(file, dir, at + 1, 150);
    const x = (top.left + top.right) / 2;
    const dark = (rgb: number[]): boolean => rgb.every((c) => c >= 0 && c < 90);
    const white = (rgb: number[]): boolean => rgb.every((c) => c > 240);
    expect(dark(pixel(x, top.top - 1 * mm))).toBe(true); // in the ceiling's band
    expect(dark(pixel(x, top.bottom + 1 * mm))).toBe(true); // in the floor's band
    expect(white(pixel(x, top.top + 1 * mm))).toBe(true); // above the ceiling
    expect(white(pixel(x, top.bottom - 1 * mm))).toBe(true); // under the floor
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a plan sheet's Section marks tick takes the marks off its page and puts them back (AC-21)", async ({ page }) => {
  const name = `Sheet ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  await copyStudio(name, (doc) => ({ ...doc, sections: SECTIONS }));
  projects.push(name);
  await page.goto(`/?name=Alice&server=${encodeURIComponent(SERVER)}`);
  await page.getByRole("button", { name, exact: true }).click({ timeout: 60_000 });
  await page.getByPlaceholder("Project name").waitFor({ state: "hidden" });
  await page.getByTestId("export-button").click();
  const tick = page.getByTestId("sheet-marks");
  await expect(tick).toBeChecked();
  const sheet = page.locator(".sheet-canvas").first();
  const look = (): Promise<Buffer> => sheet.screenshot();
  const before = await look();
  await tick.click();
  await expect(tick).not.toBeChecked();
  await expect.poll(async () => (await look()).equals(before)).toBe(false);
  await tick.click();
  await expect.poll(async () => (await look()).equals(before)).toBe(true);
});

