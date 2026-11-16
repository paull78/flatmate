import { describe, expect, it } from "vitest";
import type { ExportContent } from "@fm/editor";
import { FakeShell, clearRoomDoc, withCommands } from "@fm/editor/testing";
import { toPdf } from "../src/pdf";
import { toSvg } from "../src/svg";
import { readPdf } from "./pdf-reader";

// The cycle's ten new kinds in the downloads (catalog AC-08): one of each at its default size, read back out of the
// written SVG text and PDF stream, not the primitives handed to the writers. The pieces stand apart, since a rug's lines
// drop where a filled piece overlaps it (catalog.15). `at` is the back edge's middle (a placement's own point): a
// piece covers x at.x ± w/2, y at.y − d to at.y. The colours are written out, so they don't come from the code.

const GREY = "#e0e0de";
const RUG = "#ecebe6";

type Point = { x: number; y: number };
type Piece = { kind: string; at: Point; w: number; d: number; arm?: { back: number; left: number }; outlineOnly: number };

// What the piece's outline alone would draw: a rectangle's four sides and its heavier front; an `L`'s six sides and its
// two inner edges again as the front; a plant's and a rug's outline has no front (catalog.54), a round one 32 sides.
const RECT = 4 + 1;
const RUG_RECT = 4;
const ELL = 6 + 2;
const ROUND = 32;

const PIECES: readonly Piece[] = [
  { kind: "cornerDesk", at: { x: 1.5, y: 8.5 }, w: 1.6, d: 1.2, arm: { back: 0.6, left: 0.6 }, outlineOnly: ELL },
  { kind: "cornerWardrobe", at: { x: 4, y: 8.5 }, w: 1.5, d: 1, arm: { back: 0.6, left: 0.6 }, outlineOnly: ELL },
  { kind: "cornerCounter", at: { x: 7, y: 8.5 }, w: 2.4, d: 1.8, arm: { back: 0.6, left: 0.6 }, outlineOnly: ELL },
  { kind: "cornerSofa", at: { x: 11, y: 8.5 }, w: 2.6, d: 2, arm: { back: 0.9, left: 0.9 }, outlineOnly: ELL },
  { kind: "plant", at: { x: 1.5, y: 5 }, w: 0.4, d: 0.4, outlineOnly: ROUND },
  { kind: "rug", at: { x: 4, y: 5 }, w: 2, d: 1.4, outlineOnly: RUG_RECT },
  { kind: "roundRug", at: { x: 7, y: 5 }, w: 1.6, d: 1.6, outlineOnly: ROUND },
  { kind: "cot", at: { x: 10, y: 5 }, w: 0.66, d: 1.26, outlineOnly: RECT },
  { kind: "radiator", at: { x: 12.5, y: 5 }, w: 0.8, d: 0.1, outlineOnly: RECT },
  { kind: "towelRail", at: { x: 1.5, y: 3 }, w: 0.5, d: 0.1, outlineOnly: RECT },
];

/** Every piece's fill together spans this box, which ties the PDF's page points to the world. */
const SPAN = { minX: 0.7, maxX: 12.9, minY: 2.9, maxY: 8.5 };

function drawing() {
  return withCommands(
    clearRoomDoc(14, 9, "cat"),
    ...PIECES.map((p) => ({ type: "placeObject" as const, opId: p.kind, state: "s0", object: { kind: p.kind }, at: p.at, rotation: 0, deck: null })),
  );
}

function download(format: "svg" | "pdf"): ExportContent {
  const shell = FakeShell.withDocument(drawing());
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format });
  const content = shell.effectsOf("saveFile")[0]?.content;
  if (content?.kind !== format) throw new Error(`no ${format} download`);
  return content;
}

/** What a written file holds, in world metres: each stroke's end points, each fill's corners with its colour. */
type Read = { strokes: Point[][]; fills: { color: string; corners: Point[] }[] };

const NUMBER = /-?\d*\.?\d+/g;
const numbers = (s: string): number[] => (s.match(NUMBER) ?? []).map(Number);
const pointsOf = (s: string, to: (x: number, y: number) => Point): Point[] => {
  const v = numbers(s);
  return Array.from({ length: Math.floor(v.length / 2) }, (_, i) => to(v[2 * i] ?? NaN, v[2 * i + 1] ?? NaN));
};

function readSvg(): Read {
  const content = download("svg");
  if (content.kind !== "svg") throw new Error("not an svg");
  const { min, max, zoom } = content.frame;
  const world = (x: number, y: number): Point => ({ x: x / zoom + min.x, y: max.y - y / zoom });
  const svg = toSvg(content.primitives, content.frame);
  const attr = (el: string, name: string): string => new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1] ?? "";
  const num = (el: string, name: string): number => Number(attr(el, name));
  const lines = [...svg.matchAll(/<line\b[^>]*>/g)].map(([el]) => [world(num(el, "x1"), num(el, "y1")), world(num(el, "x2"), num(el, "y2"))]);
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map(([el]) => el);
  // An arc's "M x y A r r 0 large sweep x y": its start and end, without the radii and the flags.
  const arcs = paths.filter((el) => attr(el, "fill") === "none").map((el) => {
    const d = attr(el, "d");
    const start = /^M(\S+) (\S+)A/.exec(d);
    const ends = [...d.matchAll(/A\S+ \S+ 0 [01] [01] (\S+) (\S+?)(?=A|$)/g)];
    return [world(Number(start?.[1]), Number(start?.[2])), ...ends.map((m) => world(Number(m[1]), Number(m[2])))];
  });
  const fills = paths.filter((el) => attr(el, "fill") !== "none").map((el) => ({ color: attr(el, "fill"), corners: pointsOf(attr(el, "d"), world) }));
  return { strokes: [...lines, ...arcs], fills };
}

const hexOf = (rgb: number[]): string => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;

/** The fills in page points, then every shape in world metres through the map the pieces' fills give. */
function readPdfFile(): Read {
  const content = download("pdf");
  if (content.kind !== "pdf") throw new Error("not a pdf");
  const pdf = readPdf(toPdf(content.pages));
  expect(pdf.header).toBe("%PDF-1.4");
  expect(pdf.offsetsOk).toBe(true);
  expect(pdf.startxrefOk).toBe(true);
  expect(pdf.pages).toHaveLength(1);
  const lines = (pdf.pages[0]?.content ?? "").split("\n");
  const rawFills = lines.flatMap((line) => {
    const m = /^(\S+ \S+ \S+) rg (\S+ \S+ m (?:\S+ \S+ l )+h) f$/.exec(line);
    return m ? [{ color: hexOf(numbers(m[1] ?? "")), corners: pointsOf((m[2] ?? "").replace(/\b[mlh]\b/g, " "), (x, y) => ({ x, y })) }] : [];
  });
  const furniture = rawFills.filter((f) => f.color === GREY || f.color === RUG).flatMap((f) => f.corners);
  const [xs, ys] = [furniture.map((q) => q.x), furniture.map((q) => q.y)];
  const k = (Math.max(...xs) - Math.min(...xs)) / (SPAN.maxX - SPAN.minX);
  expect((Math.max(...ys) - Math.min(...ys)) / (SPAN.maxY - SPAN.minY), "the map is uniform").toBeCloseTo(k, 3);
  const world = (x: number, y: number): Point => ({ x: (x - Math.min(...xs)) / k + SPAN.minX, y: (y - Math.min(...ys)) / k + SPAN.minY });
  const fills = rawFills.map((f) => ({ color: f.color, corners: f.corners.map((q) => world(q.x, q.y)) }));
  const strokes = lines.flatMap((line) => {
    if (!/ S$/.test(line)) return [];
    const path = /(\S+ \S+ m .*) S$/.exec(line)?.[1] ?? "";
    // "x y m x y l" or "x y m c1 c2 x y c …": the start and each segment's end, without a Bézier's control points.
    const start = /^(\S+) (\S+) m/.exec(path);
    const ends = [...path.matchAll(/(\S+) (\S+) [lc](?= |$)/g)];
    return [[world(Number(start?.[1]), Number(start?.[2])), ...ends.map((m) => world(Number(m[1]), Number(m[2])))]];
  });
  return { strokes, fills };
}

const NEAR = 0.012; // metres: a line's end on the footprint's edge, and the SVG's and the PDF's rounding
const inBox = (p: Piece, q: Point): boolean =>
  q.x >= p.at.x - p.w / 2 - NEAR && q.x <= p.at.x + p.w / 2 + NEAR && q.y >= p.at.y - p.d - NEAR && q.y <= p.at.y + NEAR;
const strokesIn = (read: Read, p: Piece): Point[][] => read.strokes.filter((s) => s.every((q) => inBox(p, q)));
const fillsIn = (read: Read, p: Piece): Read["fills"] => read.fills.filter((f) => f.corners.every((q) => inBox(p, q)));

/** An `L`'s six corners in the world: the spec's outline, written out (catalog.02). */
function ellCorners(p: Piece): Point[] {
  const { back, left } = p.arm ?? { back: 0, left: 0 };
  const [l, r, b, f] = [p.at.x - p.w / 2, p.at.x + p.w / 2, p.at.y, p.at.y - p.d];
  return [{ x: l, y: b }, { x: r, y: b }, { x: r, y: b - back }, { x: l + left, y: b - back }, { x: l + left, y: f }, { x: l, y: f }];
}

/** Whether a point lies strictly in an `L`'s empty quarter. */
function inEmptyQuarter(p: Piece, q: Point): boolean {
  const { back, left } = p.arm ?? { back: 0, left: 0 };
  return q.x > p.at.x - p.w / 2 + left + NEAR && q.y < p.at.y - back - NEAR;
}

function expectSameCorners(got: readonly Point[], want: readonly Point[], message: string): void {
  expect(got, message).toHaveLength(want.length);
  for (const w of want) expect(got.some((q) => Math.hypot(q.x - w.x, q.y - w.y) < NEAR), `${message}: the corner (${w.x}, ${w.y})`).toBe(true);
}

describe.each<[string, () => Read]>([["the SVG", readSvg], ["the PDF", readPdfFile]])("the ten new kinds in %s (AC-08)", (_name, read) => {
  const file = read();

  it.each(PIECES.map((p): [string, Piece] => [p.kind, p]))("%s draws its symbol's strokes inside its footprint, more than its outline", (_kind, p) => {
    expect(strokesIn(file, p).length).toBeGreaterThan(p.outlineOnly);
  });

  it.each(PIECES.filter((p) => p.arm !== undefined).map((p): [string, Piece] => [p.kind, p]))("%s fills one six-corner path, its arms, and draws nothing in the empty quarter", (_kind, p) => {
    const fills = fillsIn(file, p);
    expect(fills.map((f) => f.color)).toEqual([GREY]);
    expectSameCorners(fills[0]?.corners ?? [], ellCorners(p), p.kind);
    expect(strokesIn(file, p).flat().filter((q) => inEmptyQuarter(p, q))).toEqual([]);
  });

  it.each(PIECES.filter((p) => p.kind === "rug" || p.kind === "roundRug").map((p): [string, Piece] => [p.kind, p]))("%s fills in the rug's colour, not the pieces' grey", (_kind, p) => {
    expect(fillsIn(file, p).map((f) => f.color)).toEqual([RUG]);
  });

  it.each(PIECES.filter((p) => p.arm === undefined && !p.kind.toLowerCase().includes("rug")).map((p): [string, Piece] => [p.kind, p]))("%s fills in the pieces' grey", (_kind, p) => {
    expect(fillsIn(file, p).map((f) => f.color)).toEqual([GREY]);
  });
});
