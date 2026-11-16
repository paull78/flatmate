import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { helveticaWidth } from "../src/export/helvetica";
import { MARGIN_MM, columnMm, drawingArea } from "../src/export/paper";
import { sheetPages, type SheetPage } from "../src/export/sheet";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

// Placed dimensions on paper (dims.09, dims.19, dims.20; AC-10, AC-11, AC-12): the presentation style's sizes in
// paper millimetres, the fit and centring that take in the dimension line, and the overflow rule at the export scale.

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}

/** roomDoc's bottom outer face (−0.1 to 6.1 at y −0.1), measured right to left, its line 1 m below the wall. */
const bottom = (offset = 1): Document => withCommands(roomDoc(), { type: "addDimension", opId: "m", a: { x: 6.1, y: -0.1 }, b: { x: -0.1, y: -0.1 }, offset });
/** A short free dimension inside the room, measured right to left from (4, 2), its line 0.5 m below. */
const short = (length: number): Document => withCommands(roomDoc(), { type: "addDimension", opId: "s", a: { x: 4, y: 2 }, b: { x: 4 - length, y: 2 }, offset: 0.5 });

function pageOf(doc: Document, scale: number | "fit"): SheetPage {
  const page = sheetPages(doc, { projectName: "Flat", paper: "A4", scale, host: host(), finishes: true })?.pages[0];
  if (!page) throw new Error("no page");
  return page;
}

type Text = Extract<Primitive, { kind: "text" }>;
type Segment = Extract<Primitive, { kind: "segment" }>;
const ACCENT = PRESENTATION_STYLE.dim.ink;
const columnX = (page: SheetPage): number => page.widthMm - MARGIN_MM - columnMm("A4");
const inPlan = (page: SheetPage, q: Point): boolean => q.x < columnX(page);
const texts = (page: SheetPage, value: string): Text[] => page.primitives.flatMap((p) => (p.kind === "text" && p.text === value && inPlan(page, p.at) ? [p] : []));
/** The accent segments of a dimension in the plan area: lines and extensions (0.18 mm) and ticks (0.35 mm). */
const dimSegments = (page: SheetPage, px: number): Segment[] =>
  page.primitives.flatMap((p) => (p.kind === "segment" && p.color === ACCENT && "px" in p.width && p.width.px === px && inPlan(page, p.a) ? [p] : []));
const len = (s: Segment): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
const horizontal = (s: Segment): boolean => Math.abs(s.a.y - s.b.y) < 1e-9;
const vertical = (s: Segment): boolean => Math.abs(s.a.x - s.b.x) < 1e-9;

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  const [first] = list;
  if (first === undefined) throw new Error("none");
  return first;
}

/** The dimension line: the one horizontal 0.18 mm accent segment. */
const lineOf = (page: SheetPage): Segment => only(dimSegments(page, PRESENTATION_STYLE.dim.line).filter(horizontal));
/** Where a centred text's left edge is on the page. */
const leftEdge = (t: Text): number => t.at.x - helveticaWidth(t.text, t.size) / 2;

describe("a dimension on paper (AC-10)", () => {
  it("at 1:50 a dimension prints 2.5 mm Helvetica, 2 mm ticks and 0.18 mm lines in #b3261e", () => {
    expect(ACCENT).toBe("#b3261e");
    const page = pageOf(bottom(), 50);
    const value = only(texts(page, "6.20"));
    expect(value.color).toBe(ACCENT);
    expect(value.size).toBe(2.5);
    expect(value.align).toBe("center");
    expect(Math.abs(value.rotation)).toBeLessThan(1e-9);
    const line = lineOf(page);
    expect(len(line)).toBeCloseTo(124, 6); // 6.2 m at 20 mm per metre
    expect(value.at.y).toBeGreaterThan(line.a.y);
    const extensions = dimSegments(page, 0.18).filter(vertical);
    expect(extensions).toHaveLength(2);
    for (const e of extensions) expect(len(e)).toBeCloseTo(21, 6); // 20 mm, less the 1 mm gap, plus the 2 mm overshoot
    const ticks = dimSegments(page, 0.35);
    expect(ticks).toHaveLength(2);
    for (const t of ticks) {
      expect(len(t)).toBeCloseTo(2, 6);
      expect(Math.abs(t.b.x - t.a.x)).toBeCloseTo(Math.SQRT2, 6);
      expect(Math.abs(t.b.y - t.a.y)).toBeCloseTo(Math.SQRT2, 6);
    }
  });

  it("the fit and centring include a line 1 m outside the walls", () => {
    const sheet = sheetPages(bottom(), { projectName: "Flat", paper: "A4", scale: "fit", host: host(), finishes: true });
    const page = sheet?.pages[0];
    if (!sheet || !page) throw new Error("no page");
    expect(sheet.scale).toBe(50);
    expect(sheet.orientation).toBe("landscape");
    const area = drawingArea("A4", "landscape");
    const inside = (q: Point): boolean => q.x >= area.x - 1e-9 && q.x <= area.x + area.w + 1e-9 && q.y >= area.y - 1e-9 && q.y <= area.y + area.h + 1e-9;
    const value = only(texts(page, "6.20"));
    const marks = [...dimSegments(page, 0.18), ...dimSegments(page, 0.35)];
    expect(marks).toHaveLength(5); // the line, two extensions, two ticks
    for (const q of [value.at, ...marks.flatMap((s) => [s.a, s.b])]) expect(inside(q)).toBe(true);
    // World −1.1 (the line) and 4.1 (the top of the walls) centre on world 1.5, the bounds' centre (−1.6 to 4.6).
    const wallTop = Math.max(...page.primitives.flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall && p.points.every((q) => inPlan(page, q)) ? p.points.map((q) => q.y) : [])));
    expect((lineOf(page).a.y + wallTop) / 2).toBeCloseTo(area.y + area.h / 2, 6);
  });

  it("a dimension can change the fit scale", () => {
    // Offset 5: the line at y −5.1, so the drawn plan is 6.2 × 9.2 m, 184 mm tall at 1:50, past A4's 190 with the inset.
    const doc = bottom(5);
    expect(sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host: host(), finishes: true })?.scale).toBe(75);
    // A scale asked for still draws at that scale: the frame shows what it shows (sheetset.17).
    expect(sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host: host(), finishes: true }).scale).toBe(50);
  });
});

describe("overflow at the export scale (AC-11)", () => {
  it("a 0.30 m dimension at 1:100 puts its text past its reading end at full size", () => {
    // a→b points at 180°: it reads b→a, left to right, so its reading end is a, the right end.
    const page = pageOf(short(0.3), 100);
    const value = only(texts(page, "0.30"));
    expect(value.size).toBe(2.5);
    expect(value.align).toBe("center");
    const line = lineOf(page);
    expect(len(line)).toBeCloseTo(3, 6);
    expect(leftEdge(value)).toBeGreaterThan(Math.max(line.a.x, line.b.x));
  });

  it("a 0.40 m dimension fits between its ticks at 1:50 and overflows at 1:100", () => {
    // "0.40" at 2.5 mm is 4.865 mm wide; with a 1 mm gap at each side it needs 6.865 mm.
    expect(helveticaWidth("0.40", 2.5)).toBeCloseTo(4.865, 9);
    const at50 = pageOf(short(0.4), 50);
    const line50 = lineOf(at50);
    expect(len(line50)).toBeCloseTo(8, 6);
    expect(Math.abs(only(texts(at50, "0.40")).at.x - (line50.a.x + line50.b.x) / 2)).toBeLessThan(1e-6);
    const at100 = pageOf(short(0.4), 100);
    const line100 = lineOf(at100);
    expect(len(line100)).toBeCloseTo(4, 6);
    expect(leftEdge(only(texts(at100, "0.40")))).toBeGreaterThan(Math.max(line100.a.x, line100.b.x));
  });
});

describe("every layout prints its dimensions (AC-12)", () => {
  it("every layout's page prints the dimension", () => {
    const doc = withCommands(bottom(), { type: "renameState", stateId: "s0", name: "Day" }, { type: "addState", opId: "n", name: "Night" });
    const pages = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host: host(), finishes: true })?.pages ?? [];
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(texts(page, "6.20")).toHaveLength(1);
  });
});
