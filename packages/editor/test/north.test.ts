import { describe, expect, it } from "vitest";
import { LOGO_ID, PAPER_NAMES, PROJECT_FIELDS, SHEET_SCALES, STUDIO_FIELDS, sheetSetNorth, type Command, type Document } from "@fm/domain";
import { SHORTEST_COLUMN, columnFits, type ColumnContent } from "../src/export/column";
import { MARGIN_MM, columnMm } from "../src/export/paper";
import { sheetPages, type SheetPage } from "../src/export/sheet";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The project's north (sheetset.15, .18; AC-10): degrees clockwise from up on the plan, drawn beside the scale bar.
//
//      N          0° points up the page, 90° to its right: plans aren't rotated on paper, so paper and plan agree.
//     (^)  0   2 m

const north = (angle: string): Command => ({ type: "setProjectField", key: "north", value: angle });
const nightAndCompare: Command[] = [
  { type: "addState", opId: "n", name: "Night" },
  { type: "addSheet", opId: "c", after: null, kind: "compare", title: "Compare", drawings: [{ layout: "s0", deck: null }, { layout: "n/s0", deck: null }] },
];

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}
const pages = (doc: Document): SheetPage[] => sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true }).pages;
const firstPage = (doc: Document): SheetPage => {
  const [page] = pages(doc);
  if (!page) throw new Error("no page");
  return page;
};
const texts = (page: SheetPage): string[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));
/** What's in the title block column: plan arcs and polygons are all left of it. */
const inColumn = (page: SheetPage): Primitive[] => {
  const left = page.widthMm - MARGIN_MM - columnMm("A4");
  const xOf = (p: Primitive): number => {
    switch (p.kind) {
      case "arc":
      case "disc":
        return p.center.x;
      case "polygon":
        return p.points[0]?.x ?? 0;
      case "text":
        return p.at.x;
      case "segment":
        return p.a.x;
    }
  };
  return page.primitives.filter((p) => xOf(p) >= left);
};

/** The arrow as a reader finds it: a ring, a three-cornered filled half, whose far corner is the tip, and an N. */
function arrowOf(page: SheetPage): { degrees: number; nDegrees: number } {
  const column = inColumn(page);
  const rings = column.flatMap((p) => (p.kind === "arc" ? [p] : []));
  const needles = column.flatMap((p) => (p.kind === "polygon" && p.points.length === 3 ? [p] : []));
  const labels = column.flatMap((p) => (p.kind === "text" && p.text === "N" ? [p] : []));
  expect(rings).toHaveLength(1);
  expect(needles).toHaveLength(1);
  expect(labels).toHaveLength(1);
  const [ring] = rings;
  const [needle] = needles;
  const [label] = labels;
  if (!ring || !needle || !label) throw new Error("no arrow");
  const reach = (x: number, y: number): number => Math.hypot(x - ring.center.x, y - ring.center.y);
  const tip = [...needle.points].sort((a, b) => reach(b.x, b.y) - reach(a.x, a.y))[0];
  if (!tip) throw new Error("no tip");
  const clockwiseFromUp = (x: number, y: number): number => ((Math.atan2(x - ring.center.x, y - ring.center.y) * 180) / Math.PI + 360) % 360;
  return { degrees: clockwiseFromUp(tip.x, tip.y), nDegrees: clockwiseFromUp(label.at.x, label.at.y) };
}

describe("north on the page (AC-10)", () => {
  it("unset: no arrow, no \"N\" in the page", () => {
    const page = firstPage(roomDoc());
    expect(page.primitives.length).toBeGreaterThan(0);
    expect(texts(page)).not.toContain("N");
    expect(inColumn(page).filter((p) => p.kind === "arc" || (p.kind === "polygon" && p.points.length === 3))).toEqual([]);
    expect(sheetSetNorth(roomDoc())).toBeNull();
  });

  it.each([0, 90, 235])("set: an arrow at that angle, %i°", (angle) => {
    const { degrees, nDegrees } = arrowOf(firstPage(withCommands(roomDoc(), north(String(angle)))));
    expect(degrees).toBeCloseTo(angle, 6);
    expect(nDegrees).toBeCloseTo(angle, 6); // the N stands off the tip, so the mark can't be read backwards
  });

  it("the N stays upright at any angle, as the rest of the column does", () => {
    const n = firstPage(withCommands(roomDoc(), north("235"))).primitives.find((p) => p.kind === "text" && p.text === "N");
    expect(n?.kind === "text" ? n.rotation : null).toBe(0);
  });

  it("on plan and compare", () => {
    const doc = withCommands(roomDoc(), ...nightAndCompare, north("90"));
    const all = pages(doc);
    expect(all).toHaveLength(3);
    for (const page of all) expect(arrowOf(page).degrees).toBeCloseTo(90, 6);
  });

  it("not on a report", () => {
    const report: Command = { type: "addSheet", opId: "r", after: null, kind: "report", title: "Report", drawings: [], text: "Words" };
    const all = pages(withCommands(roomDoc(), report, north("45")));
    expect(all).toHaveLength(2);
    expect(texts(all[0] ?? firstPage(roomDoc()))).toContain("N");
    expect(texts(all[1] ?? firstPage(roomDoc()))).not.toContain("N");
    expect(all[1]?.primitives.some((p) => p.kind === "polygon" && p.points.length === 3)).toBe(false);
  });

  it("the bar still measures true beside it", () => {
    const page = firstPage(withCommands(roomDoc(), north("90")));
    const label = (t: string) => page.primitives.find((p) => p.kind === "text" && p.text === t);
    const zero = label("0");
    const metre = label("1 m");
    if (zero?.kind !== "text" || metre?.kind !== "text") throw new Error("no bar");
    expect(metre.at.x - zero.at.x).toBeCloseTo(20, 6); // 1 m at 1:50
  });

  it("the bar's end label never reaches the N, on any paper at any scale, with the N on the bar's side", () => {
    for (const paper of PAPER_NAMES) {
      for (const scale of SHEET_SCALES) {
        const [page] = sheetPages(withCommands(roomDoc(), north("270")), { projectName: "Flat", paper, scale, host: host(), finishes: true }).pages;
        const end = page?.primitives.find((p) => p.kind === "text" && /^[\d.]+ m$/.test(p.text));
        const n = page?.primitives.find((p) => p.kind === "text" && p.text === "N");
        if (end?.kind !== "text" || n?.kind !== "text") throw new Error("no bar or N");
        expect(end.at.x + 3).toBeLessThanOrEqual(n.at.x - 0.9); // a label half 3 mm wide, an N half 0.9
      }
    }
  });

  it("a column with every field at its limit, the studio's too, still fits the shortest page with it and a square logo (sheetset.45)", () => {
    const fields = Object.fromEntries([...PROJECT_FIELDS, ...STUDIO_FIELDS].map((f) => [f.key, { id: f.key, value: "Field value long enough to wrap ".repeat(20).slice(0, f.maxLength) }]));
    const content: ColumnContent = { projectName: "A project name long enough to wrap ".repeat(3), fields, rooms: { rows: [], total: null }, date: "2026-10-13", accent: "#b3261e", scale: 50, north: 45, paperLabel: "A4", sheet: 10, sheets: 12, logo: { id: LOGO_ID, data: "/9j/", width: 300, height: 300 } };
    expect(columnFits({ x: 0, y: 0, w: columnMm("A4"), h: 210 - 2 * MARGIN_MM }, content, SHORTEST_COLUMN)).toBe(true);
  });
});

describe("setting north (AC-10)", () => {
  const opened = (): FakeShell => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "openExport" });
    return shell;
  };
  const set = (shell: FakeShell, value: string): void => shell.ui({ type: "setSheetSetting", key: "north", value });

  it.each(["360", "1.5", "x", "-5", "045", " 45", "9999"])("an invalid angle is refused: %s", (value) => {
    const shell = opened();
    set(shell, value);
    expect(shell.view().toast).toMatch(/^North must be/);
    expect(shell.doc().projectFields).toEqual({});
  });

  it.each([["0", 0], ["359", 359], ["45", 45]])("takes %s", (value, angle) => {
    const shell = opened();
    set(shell, value);
    expect(shell.view().sheetsView?.north).toBe(angle);
  });

  it("setting and clearing are one undo step each", () => {
    const shell = opened();
    expect(shell.view().sheetsView?.north).toBeNull();
    set(shell, "45");
    set(shell, "60");
    expect(shell.view().sheetsView?.north).toBe(60);
    set(shell, "");
    expect(shell.view().sheetsView?.north).toBeNull();
    expect(shell.doc().projectFields).toEqual({});
    shell.ui({ type: "undo" });
    expect(shell.view().sheetsView?.north).toBe(60);
    shell.ui({ type: "undo" });
    expect(shell.view().sheetsView?.north).toBe(45);
    shell.ui({ type: "undo" });
    expect(shell.view().sheetsView?.north).toBeNull();
    shell.ui({ type: "redo" });
    expect(shell.view().sheetsView?.north).toBe(45);
  });

  it("a page already drawn redraws with it", () => {
    const shell = opened();
    const page = () => shell.view().sheetsView?.sheets[0]?.pages()[0];
    expect(page()?.primitives.some((p) => p.kind === "text" && p.text === "N")).toBe(false);
    set(shell, "45");
    const drawn = page();
    if (!drawn) throw new Error("no page");
    expect(arrowOf(drawn).degrees).toBeCloseTo(45, 6);
  });

  it("is never printed as a field in the title block", () => {
    const page = firstPage(withCommands(roomDoc(), north("45")));
    expect(texts(page).some((t) => /north/i.test(t) || t === "45")).toBe(false);
    expect(PROJECT_FIELDS.map((f) => f.key)).not.toContain("north");
  });
});
