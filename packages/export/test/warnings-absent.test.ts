import { describe, expect, it } from "vitest";
import { COLORS, colorChannels, type ExportContent, type Primitive } from "@fm/editor";
import { FakeShell, roomDoc, wallBetween, withCommands } from "@fm/editor/testing";
import { toPdf } from "../src/pdf";
import { toSvg } from "../src/svg";
import { operands, readPdf } from "./pdf-reader";

// A standing warning is the canvas's alone (clarity spec, AC-04): the same drawing with and without the piece that
// blocks a zone or a door swing writes the same files but for the piece and the free floor it takes, which the room's
// tag states. The writers' real output is read back, one primitive per line in the SVG and in the PDF's content stream.

type Doc = ReturnType<typeof roomDoc>;

const WARNING_COLORS: readonly string[] = [COLORS.warning, COLORS.warningLine, COLORS.warningMark, COLORS.warningGlyph];
const hexOf = (rgb: readonly number[]): string => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
const WARNING_HEXES = new Set(WARNING_COLORS.map((c) => hexOf(colorChannels(c).slice(0, 3))));

/** A desk on the top wall, its front zone x 2.65–3.35, y 2.5–3.3, and the block that would stand in it. */
const desk = (): Doc => withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "desk", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 3.9 } });
const blockInZone = (doc: Doc): Doc => withCommands(doc, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 3, y: 3.2 } });

/** The desk, clear, and a door on the bottom wall (x 3–3.8, swinging up to y 0.9); the block would stand in its swing. */
function door(): Doc {
  const base = desk();
  return withCommands(base, { type: "addOpening", opId: "o", wall: wallBetween(base, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 3 });
}
const blockInSwing = (doc: Doc): Doc => withCommands(doc, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 3.4, y: 0.7 } });

function downloaded(doc: Doc, format: "svg" | "pdf"): ExportContent {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format });
  const content = shell.effectsOf("saveFile")[0]?.content;
  if (content?.kind !== format) throw new Error(`no ${format} download`);
  return content;
}

function pngPage(doc: Doc): readonly Primitive[] {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format: "png" });
  const page = shell.effectsOf("rasterise")[0]?.page;
  if (!page) throw new Error("no png page");
  return page.primitives;
}

function svgOf(doc: Doc): { text: string; primitives: readonly Primitive[] } {
  const content = downloaded(doc, "svg");
  if (content.kind !== "svg") throw new Error("not an svg");
  return { text: toSvg(content.primitives, content.frame), primitives: content.primitives };
}

function pdfOf(doc: Doc): { text: string; primitives: readonly Primitive[] } {
  const content = downloaded(doc, "pdf");
  if (content.kind !== "pdf") throw new Error("not a pdf");
  const read = readPdf(toPdf(content.pages));
  expect(read.pages).toHaveLength(1);
  return { text: read.pages[0]?.content ?? "", primitives: content.pages.flatMap((p) => p.primitives) };
}

/** The room tag's free floor, the one figure the piece rightly changes: left out when two files are compared. */
const withoutFreeFloor = (text: string): string => text.replace(/free \d+\.\d+/g, "free");

/** The lines of `more` left over once `base`'s lines are matched in order; every line of `base` must be there. */
function linesAdded(more: string, base: string): string[] {
  const added: string[] = [];
  const left = withoutFreeFloor(base).split("\n");
  for (const line of withoutFreeFloor(more).split("\n")) {
    if (line === left[0]) left.shift();
    else added.push(line);
  }
  expect(left, "every line of the drawing without the piece is still there, in order").toEqual([]);
  return added;
}

/** Every drawn point of a written line, in that file's own units. */
function svgPoints(line: string): number[][] {
  const num = (name: string): number => Number(new RegExp(`\\b${name}="([^"]*)"`).exec(line)?.[1]);
  if (line.startsWith("<line")) return [[num("x1"), num("y1")], [num("x2"), num("y2")]];
  if (line.startsWith("<text")) return [[num("x"), num("y")]];
  const d = /\bd="([^"]*)"/.exec(line)?.[1] ?? "";
  return [...d.matchAll(/[ML](\S+) ([^MLZA]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}
const pdfPoints = (line: string): number[][] => [...line.matchAll(/(\S+) (\S+) [ml](?= )/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** The first added line is the piece's fill: every other added line lies within its bounding box. */
function expectAllInsideFirst(added: readonly string[], points: (line: string) => number[][]): void {
  const fill = points(added[0] ?? "");
  expect(fill.length, "the piece starts with its fill").toBeGreaterThanOrEqual(3);
  const xs = fill.map((p) => p[0] ?? NaN);
  const ys = fill.map((p) => p[1] ?? NaN);
  const SLACK = 0.01; // the writers' rounding, for a line on the fill's edge
  for (const line of added) {
    for (const [x, y] of points(line)) {
      expect(x, line).toBeGreaterThanOrEqual(Math.min(...xs) - SLACK);
      expect(x, line).toBeLessThanOrEqual(Math.max(...xs) + SLACK);
      expect(y, line).toBeGreaterThanOrEqual(Math.min(...ys) - SLACK);
      expect(y, line).toBeLessThanOrEqual(Math.max(...ys) + SLACK);
    }
  }
}

const scene = (doc: Doc) => FakeShell.withDocument(doc).scene().layers;
const usedOnCanvas = (doc: Doc, layer: "warnings" | "overlays"): string[] =>
  (scene(doc).find((l) => l.name === layer)?.primitives ?? []).map((p) => p.color).filter((c) => WARNING_COLORS.includes(c));

const svgHexes = (text: string): string[] => [...text.matchAll(/\b(?:fill|stroke)="(#[0-9a-f]{6})"/g)].flatMap((m) => m[1] ?? []);
const pdfHexes = (content: string): string[] => [...operands(content, "rg"), ...operands(content, "RG")].map((rgb) => hexOf(rgb.slice(-3)));

const expectNoWarningPrimitive = (primitives: readonly Primitive[]): void => {
  expect(primitives.length).toBeGreaterThan(0);
  expect(primitives.filter((p) => WARNING_COLORS.includes(p.color))).toEqual([]);
  expect(primitives.filter((p) => p.kind === "text" && p.text === "!")).toEqual([]);
};

describe.each<[string, () => Doc, (doc: Doc) => Doc]>([
  ["a blocked zone", desk, blockInZone],
  ["a blocked door swing", door, blockInSwing],
])("%s on paper", (name, clear, blocked) => {
  const without = clear();
  const withPiece = blocked(without);

  it("the drawing does warn on the canvas, in the colours looked for on paper", () => {
    expect(usedOnCanvas(without, "warnings")).toEqual([]);
    expect(usedOnCanvas(without, "overlays")).toEqual([]);
    expect(new Set(usedOnCanvas(withPiece, "warnings"))).toEqual(new Set([COLORS.warning, COLORS.warningLine]));
    expect(new Set(usedOnCanvas(withPiece, "overlays"))).toEqual(new Set([COLORS.warningLine, COLORS.warningMark, COLORS.warningGlyph]));
  });

  it(`${name} adds no warning colour or mark to SVG or the PDF`, () => {
    const svg = svgOf(withPiece);
    expectNoWarningPrimitive(svg.primitives);
    expect(svgHexes(svg.text).filter((hex) => WARNING_HEXES.has(hex))).toEqual([]);
    expect(svg.text).not.toContain(">!</text>");
    const svgAdded = linesAdded(svg.text, svgOf(without).text);
    expect(svgAdded.length).toBeGreaterThan(0);
    expectAllInsideFirst(svgAdded, svgPoints);

    const pdf = pdfOf(withPiece);
    expectNoWarningPrimitive(pdf.primitives);
    expect(pdfHexes(pdf.text).filter((hex) => WARNING_HEXES.has(hex))).toEqual([]);
    expect(pdf.text).not.toContain("(!) Tj");
    const pdfAdded = linesAdded(pdf.text, pdfOf(without).text);
    expect(pdfAdded).toHaveLength(svgAdded.length);
    expectAllInsideFirst(pdfAdded, pdfPoints);
  });

  it(`${name} adds no warning colour or mark to the PNG's picture`, () => {
    const page = pngPage(withPiece);
    expectNoWarningPrimitive(page);
    expect(page.length).toBeGreaterThan(pngPage(without).length);
  });
});
