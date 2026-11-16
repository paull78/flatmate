import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { sheetPages, type SheetPage } from "../src/export/sheet";
import type { Primitive } from "../src/view/scene-types";
import { emptyDocument, rectangleRoom } from "@fm/domain";
import { bed160x200, roomDoc, wallDoc, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

// The PDF sheet as data (export.05, .06, .07; AC-08, AC-09, AC-10): pages in paper millimetres, origin at the
// bottom-left corner, y up, like the world and like PDF.

/** The fake host's calendar says 2026-10-13; its monotonic clock (now) starts at 0, like performance.now(). */
function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}

/** roomDoc (6 × 4) with a second layout, Night. */
function twoLayouts(): Document {
  return withCommands(roomDoc(), { type: "renameState", stateId: "s0", name: "Day" }, { type: "addState", opId: "n", name: "Night" });
}

const texts = (page: SheetPage): string[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));

describe("sheetPages", () => {
  it("one page per layout, in order, of the paper in the orientation that fits", () => {
    const sheet = sheetPages(twoLayouts(), { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true });
    if (sheet === null) throw new Error("no sheet");
    expect(sheet.pages).toHaveLength(2);
    expect(sheet.pages.map((p) => [p.widthMm, p.heightMm])).toEqual([[297, 210], [297, 210]]);
    expect(sheet.orientation).toBe("landscape");
  });

  it("a 4.00 m wall at 1:50 spans 80.0 mm on the page", () => {
    // A lone wall's body runs joint to joint: its fill polygon is 4 m long, 80 mm on paper.
    const page = sheetPages(wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 }), { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    const fills = page.primitives.flatMap((p) => (p.kind === "polygon" && p.color === "#1a1a1a" ? [p.points] : []));
    expect(fills).toHaveLength(1);
    const xs = (fills[0] ?? []).map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 6);
  });

  it("the date is the host's calendar day, not its monotonic clock", () => {
    const h = host();
    h.advance(5000);
    const page = sheetPages(roomDoc(), { projectName: "Flat", paper: "A4", scale: 50, host: h, finishes: true })?.pages[0];
    expect(page ? texts(page) : []).toContain("2026-10-13");
  });

  it("a page holds the project, its title and scale, the paper, the date and the sheet number (sheetset.19)", () => {
    const sheet = sheetPages(twoLayouts(), { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true });
    const [day, night] = sheet?.pages ?? [];
    if (!day || !night) throw new Error("no pages");
    expect(texts(day)).toEqual(expect.arrayContaining(["Flat", "DAY  ·  scale 1:50", "A4", "2026-10-13", "Sheet 01 / 02"]));
    expect(texts(night)).toEqual(expect.arrayContaining(["NIGHT  ·  scale 1:50", "Sheet 02 / 02"]));
  });

  it("the scale bar's labelled length measures true: 2 m at 1:50 is 40.0 mm", () => {
    const page = sheetPages(roomDoc(), { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    expect(texts(page)).toEqual(expect.arrayContaining(["0", "2 m"]));
    // The labels sit at the bar's two ends.
    const label = (t: string) => page.primitives.find((p) => p.kind === "text" && p.text === t);
    const zero = label("0");
    const two = label("2 m");
    if (zero?.kind !== "text" || two?.kind !== "text") throw new Error("no labels");
    expect(two.at.x - zero.at.x).toBeCloseTo(40, 6);
  });

  it("the disclaimer is there and there is no north arrow", () => {
    const page = sheetPages(roomDoc(), { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    expect(texts(page)).toContain("Dimensions are approximate; check on site.");
    expect(texts(page).some((t) => /^N$/.test(t))).toBe(false);
  });

  it("fit picks the scale; a fixed scale the plan does not fit still prints, clipped (sheetset.17)", () => {
    expect(sheetPages(roomDoc(), { projectName: "Flat", paper: "A4", scale: "fit", host: host(), finishes: true })?.scale).toBe(50);
    const big = withCommands(roomDoc(), { type: "addWall", opId: "far", from: { at: { x: 6, y: 0 } }, to: { at: { x: 60, y: 0 } } });
    expect(sheetPages(big, { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true }).scale).toBe(50);
  });

  it("everything on the page lies inside the paper", () => {
    const page = sheetPages(twoLayouts(), { projectName: "Flat", paper: "A4", scale: "fit", host: host(), finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    const pts = page.primitives.flatMap((p) => (p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : []));
    for (const q of pts) {
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(page.widthMm);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(page.heightMm);
    }
    expect(segments(page.primitives).length).toBeGreaterThan(0);
  });

  it("each sheet's area table uses that sheet's layout (AC-10)", () => {
    const doc = withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Studio", finish: null }, { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, deck: null, opId: "bed", state: "n/s0", object: { kind: "bed" }, at: { x: 5, y: 3 } }, bed160x200("bed/o0"));
    const sheet = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true });
    const [day, night] = sheet?.pages ?? [];
    if (!day || !night) throw new Error("no pages");
    expect(texts(day)).toEqual(expect.arrayContaining(["Studio", "22.04 m²", "22.0 m²", "Total"]));
    expect(texts(night)).toEqual(expect.arrayContaining(["Studio", "18.8 m²"]));
  });

  it("a drawing with many rooms lists every one in the column's table", () => {
    // Twelve 1 × 1 m rooms in a row, labelled (the bottom band that grew with the table is gone, sheet.07).
    let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 12, 1, "row"));
    for (let i = 1; i < 12; i++) doc = withCommands(doc, { type: "addWall", opId: `d${i}`, from: { at: { x: i, y: 0 } }, to: { at: { x: i, y: 1 } } });
    for (let i = 0; i < 12; i++) doc = withCommands(doc, { type: "labelZone", id: `L${i}`, at: { x: i + 0.5, y: 0.5 }, name: `Room ${String(i).padStart(2, "0")}`, finish: null });
    const sheet = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host: host(), finishes: true });
    // At fit (1:75: the plan is 12.2 m wide, more than the 217 mm left of the column at 1:50) each 1 m room is 13 mm
    // wide, too small for its tag; the column's table lists all twelve.
    const page = sheet?.pages[0] ?? { widthMm: 0, heightMm: 0, primitives: [] };
    expect(sheet?.scale).toBe(75);
    const column = page.widthMm - 10 - 60;
    const rows = page.primitives.flatMap((p) => (p.kind === "text" && p.text.startsWith("Room ") && p.at.x >= column ? [p.text] : []));
    expect(rows).toEqual(Array.from({ length: 12 }, (_, i) => `Room ${String(i).padStart(2, "0")}`));
  });
});
