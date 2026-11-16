import { describe, expect, it } from "vitest";
import { PRESENTATION_STYLE, type ExportContent, type Primitive } from "@fm/editor";
import { FakeShell, clearRoomDoc, withCommands } from "@fm/editor/testing";
import { toPdf } from "../src/pdf";
import { toSvg } from "../src/svg";
import { readPdf } from "./pdf-reader";

// A stair in the downloads (stairs.02, AC-13): the SVG and the PDF sheet draw the canvas's stair symbol, break line and
// UP label included, in the presentation style.
//
// The studio of the editor's stair-symbol tests, without its partition and platform: a 7 × 2.5 room under a 3.05
// ceiling (cut 1.20), the loft over x 0.1–3.6, and a storage stair with its back edge on the loft's edge at (3.6, 1.95),
// turned 90°: x 3.6–5.59, y 1.65–2.25. 10 risers of 0.215, 9 treads of 0.2211; the break lies 5 treads in, x 4.484.

const LABEL = "UP · 10 R";
const MM = 72 / 25.4;

function loftWithStair() {
  return withCommands(
    clearRoomDoc(6.8, 2.3, "st"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    { type: "placeObject", opId: "s", state: "s0", object: { kind: "storageStair" }, at: { x: 3.6, y: 1.95 }, rotation: 90, deck: null },
  );
}

function download(format: "svg" | "pdf"): ExportContent {
  const shell = FakeShell.withDocument(loftWithStair());
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format });
  const content = shell.effectsOf("saveFile")[0]?.content;
  if (content?.kind !== format) throw new Error(`no ${format} download`);
  return content;
}

type Segment = Extract<Primitive, { kind: "segment" }>;
const inStair = (s: Segment): boolean => [s.a, s.b].every((q) => q.x > 3.6 - 0.2 && q.x < 5.59 + 0.2 && q.y > 1.65 - 0.2 && q.y < 2.25 + 0.2);
/** The stair's lines as world geometry, solid or dashed, in a stable order: what the canvas and the SVG share. */
const stairLines = (ps: readonly Primitive[]): string[] =>
  ps
    .flatMap((p) => (p.kind === "segment" && inStair(p) ? [p] : []))
    .map((s) => `${[s.a.x, s.a.y, s.b.x, s.b.y].map((v) => v.toFixed(4)).join(" ")} ${s.dash ? "dashed" : "solid"}`)
    .sort();

const attr = (el: string, name: string): number => Number(new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1]);

describe("a storage stair in the SVG export (AC-13)", () => {
  const content = download("svg");
  if (content.kind !== "svg") throw new Error("not an svg");
  const svg = toSvg(content.primitives, content.frame);
  const { min, max, zoom } = content.frame;
  /** The SVG's <line>s back in world metres. */
  const lines = [...svg.matchAll(/<line\b[^>]*>/g)].map(([el]) => ({
    a: { x: attr(el, "x1") / zoom + min.x, y: max.y - attr(el, "y1") / zoom },
    b: { x: attr(el, "x2") / zoom + min.x, y: max.y - attr(el, "y2") / zoom },
    dashed: el.includes("stroke-dasharray"),
  }));
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
  const treads = lines.filter((l) => near(l.a.x, l.b.x) && near(Math.abs(l.a.y - l.b.y), 0.6) && l.a.x > 3.6 + 1e-3 && l.a.x < 5.59 - 1e-3);

  it("the SVG of a loft with a storage stair contains the UP label and dashed tread segments", () => {
    expect(svg).toContain(`>${LABEL}</text>`);
    expect(treads.filter((l) => l.dashed)).toHaveLength(3);
    expect(treads.filter((l) => !l.dashed)).toHaveLength(5);
  });

  it("draws the break line across the flight at x 4.484", () => {
    const xb = 5.59 - 5 * (1.99 / 9);
    const slanted = lines.filter((l) => !near(l.a.x, l.b.x) && !near(l.a.y, l.b.y) && Math.abs((l.a.x + l.b.x) / 2 - xb) < 0.12);
    expect(slanted.length).toBeGreaterThan(0);
    expect(Math.min(...slanted.flatMap((l) => [l.a.y, l.b.y]))).toBeLessThan(1.65);
    expect(Math.max(...slanted.flatMap((l) => [l.a.y, l.b.y]))).toBeGreaterThan(2.25);
  });

  it("draws the canvas's stair lines, segment for segment, and its label in the presentation style", () => {
    const canvas = FakeShell.withDocument(loftWithStair()).scene().layers.find((l) => l.name === "objects")?.primitives ?? [];
    expect(stairLines(content.primitives)).toEqual(stairLines(canvas));
    expect(stairLines(canvas).length).toBeGreaterThan(10);
    const label = content.primitives.find((p) => p.kind === "text" && p.text === LABEL);
    expect(label).toMatchObject({ size: PRESENTATION_STYLE.stairLabel, font: "helvetica", color: PRESENTATION_STYLE.tag.text });
  });
});

describe("a storage stair on the PDF sheet (AC-13)", () => {
  const content = download("pdf");
  if (content.kind !== "pdf") throw new Error("not a pdf");
  const pdf = readPdf(toPdf(content.pages));

  it(`the PDF sheet's text holds "${LABEL}" in Helvetica`, () => {
    // Windows-1252: the middle dot is 0xB7, octal 267.
    const shown = pdf.pages.flatMap((p) => [...p.content.matchAll(/\/F1 ([\d.]+) Tf [^()]*\(([^)]*)\) Tj/g)]).find((m) => m[2] === "UP \\267 10 R");
    expect(shown).toBeDefined();
    expect(Number(shown?.[1])).toBeCloseTo(PRESENTATION_STYLE.stairLabel * MM, 2);
    expect([...pdf.objects.values()].some((o) => o.includes("/BaseFont /Helvetica /Encoding /WinAnsiEncoding"))).toBe(true);
  });

  it("draws the stair's treads on paper: five solid in the detail line, three dashed past the cut and the dashed top", () => {
    const segs = content.pages.flatMap((p) => p.primitives).flatMap((p) => (p.kind === "segment" ? [p] : []));
    const length = (s: Segment): string => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y).toFixed(3);
    // The flight's width on paper is the one length shared by four dashed lines (no deck edge is 0.60 m).
    const dashed = segs.filter((s) => s.dash !== undefined);
    const counts = new Map<string, number>();
    for (const s of dashed) counts.set(length(s), (counts.get(length(s)) ?? 0) + 1);
    const width = [...counts].find(([, n]) => n === 4)?.[0];
    expect(width).toBeDefined();
    const solid = segs.filter((s) => s.dash === undefined && s.color === PRESENTATION_STYLE.objectDetail && length(s) === width);
    expect(solid).toHaveLength(5);
  });
  it("draws the walking line's dot small on paper: the style's 0.5 mm radius, under a tenth of the flight's width (stairs.61)", () => {
    const prims = content.pages.flatMap((p) => p.primitives);
    const dots = prims.flatMap((p) => (p.kind === "disc" ? [p] : []));
    const tread = prims.flatMap((p) => (p.kind === "segment" && p.color === PRESENTATION_STYLE.objectDetail ? [Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y)] : []));
    expect(dots).toHaveLength(1);
    expect(dots[0]?.radius).toEqual({ px: PRESENTATION_STYLE.stairDot });
    expect(PRESENTATION_STYLE.stairDot).toBeLessThan(Math.max(...tread) / 10);
  });
});
