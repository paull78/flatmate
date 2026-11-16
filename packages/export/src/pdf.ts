import type { FontStyle, PageClip, PageImage, Primitive, Width } from "@fm/editor";
import { assertNever, type Point } from "@fm/protocol";
import { colorChannels, helveticaWidth, toWinAnsi } from "@fm/editor";
import { jpegObject } from "./jpeg";

// A small PDF 1.4 writer (export.13, .17): pages in millimetres with the origin at the bottom-left corner and y up
// (the editor's sheet pages), drawn with lines, fills, Bézier arcs, the built-in Helvetica in Windows-1252 and JPEGs,
// passed through as they are. No compression, no font embedding: regular, bold and oblique are all base fonts
// (sheetset.05). Pure: returns bytes. Every
// text draws in Helvetica whatever its `font`: only the presentation style, which measures in Helvetica, reaches paper
// (render.15, tidy.23).

export type PdfPage = { widthMm: number; heightMm: number; primitives: readonly Primitive[]; clips?: readonly PageClip[]; images?: readonly PageImage[] };

const PT = 72 / 25.4; // points per millimetre
const BASELINE = 0.35; // text is centred vertically on its point, as on the canvas: the baseline sits this many ems below
const FONT_OBJECT = (baseFont: string): string => `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /Encoding /WinAnsiEncoding >>`;
const faceOf = (style: FontStyle | undefined): string => (style === "bold" ? "F2" : style === "oblique" ? "F3" : "F1");

/** The PDF file for the pages, as bytes. */
export function toPdf(pages: readonly PdfPage[]): Uint8Array {
  const alphas = new Map<string, string>(); // opacity → graphics state name
  // Objects: 1 catalog, 2 page tree, 3 to 5 fonts, 6 graphics states, a page and its content per page, then the images.
  const pageIds = pages.map((_, i) => 7 + 2 * i);
  const images = imageObjects(pages, 7 + 2 * pages.length);
  const contents = pages.map((p) => content(p, alphas, images));
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    FONT_OBJECT("Helvetica"),
    FONT_OBJECT("Helvetica-Bold"),
    FONT_OBJECT("Helvetica-Oblique"),
    `<< ${[...alphas].map(([a, name]) => `/${name} << /Type /ExtGState /ca ${a} /CA ${a} >>`).join(" ")} >>`,
  ];
  pages.forEach((p, i) => {
    const box = `[0 0 ${(p.widthMm * PT).toFixed(2)} ${(p.heightMm * PT).toFixed(2)}]`;
    const contentId = (pageIds[i] ?? 0) + 1; // each page's content is the object after it
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /ExtGState 6 0 R${xObjects(p, images)} >> /Contents ${contentId} 0 R >>`);
    const stream = contents[i] ?? "";
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push(...[...images.values()].map((image) => image.body));

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff);
}

type ImageObject = { name: string; id: number; body: string };

/** One object per file, by its base64, however many pages show it, numbered from `firstId`. One no reader could draw has none. */
function imageObjects(pages: readonly PdfPage[], firstId: number): Map<string, ImageObject> {
  const images = new Map<string, ImageObject>();
  for (const jpeg of new Set(pages.flatMap((p) => (p.images ?? []).map((image) => image.jpeg)))) {
    const body = jpegObject(jpeg);
    if (body !== null) images.set(jpeg, { name: `Im${images.size}`, id: firstId + images.size, body });
  }
  return images;
}

/** The page's image resources, or nothing, so a page without any writes what it always has. */
function xObjects(page: PdfPage, images: ReadonlyMap<string, ImageObject>): string {
  const shown = [...new Set((page.images ?? []).flatMap(({ jpeg }) => images.get(jpeg) ?? []))];
  return shown.length === 0 ? "" : ` /XObject << ${shown.map((image) => `/${image.name} ${image.id} 0 R`).join(" ")} >>`;
}

/** One page's content stream, images last, as a tint is a primitive. Every string in it is Latin-1, one char per byte. */
function content(page: PdfPage, alphas: Map<string, string>, images: ReadonlyMap<string, ImageObject>): string {
  const ops: string[] = [];
  const drawRange = (from: number, to: number): void => {
    for (const p of page.primitives.slice(from, to)) {
      const { rgb, alpha } = colour(p.color);
      const gs = alpha < 1 ? stateFor(alphas, alpha) : null;
      if (gs) ops.push("q", `/${gs} gs`);
      ops.push(draw(p, rgb));
      if (gs) ops.push("Q");
    }
  };
  let drawn = 0;
  for (const { rect, from, to } of page.clips ?? []) {
    drawRange(drawn, from);
    ops.push("q", `${n(rect.x * PT)} ${n(rect.y * PT)} ${n(rect.w * PT)} ${n(rect.h * PT)} re W n`);
    drawRange(from, to);
    ops.push("Q");
    drawn = to;
  }
  drawRange(drawn, page.primitives.length);
  for (const { rect, jpeg } of page.images ?? []) {
    const image = images.get(jpeg);
    if (image) ops.push("q", `${n(rect.w * PT)} 0 0 ${n(rect.h * PT)} ${n(rect.x * PT)} ${n(rect.y * PT)} cm /${image.name} Do`, "Q");
  }
  return ops.join("\n");
}

function draw(p: Primitive, rgb: string): string {
  switch (p.kind) {
    case "segment": {
      const dash = p.dash && p.dash.length > 0 ? `[${p.dash.map((d) => n(d * PT)).join(" ")}] 0 d` : "[] 0 d";
      return `${rgb} RG ${n(width(p.width) * PT)} w ${p.cap === "round" ? 1 : 0} J ${dash} ${pt(p.a)} m ${pt(p.b)} l S`;
    }
    case "polygon": {
      if (p.points.length < 3) return "";
      const ring = ([first, ...rest]: readonly Point[]) => (first && rest.length >= 2 ? `${pt(first)} m ${rest.map((q) => `${pt(q)} l`).join(" ")} h` : "");
      const path = [p.points, ...p.holes].map(ring).filter((s) => s !== "").join(" ");
      return `${rgb} rg ${path} ${p.holes.length > 0 ? "f*" : "f"}`;
    }
    case "arc":
      return `${rgb} RG ${n(width(p.width) * PT)} w 0 J [] 0 d ${arcPath(p.center, p.radius, p.from, p.to)} S`;
    case "disc":
      return `${rgb} rg ${arcPath(p.center, width(p.radius), 0, 2 * Math.PI)} h f`;
    case "text": {
      const size = p.size * PT;
      const w = helveticaWidth(p.text, size, p.style);
      const dx = p.align === "center" ? -w / 2 : p.align === "right" ? -w : 0;
      const dy = -BASELINE * size;
      const cos = Math.cos(p.rotation);
      const sin = Math.sin(p.rotation);
      const x = p.at.x * PT + dx * cos - dy * sin;
      const y = p.at.y * PT + dx * sin + dy * cos;
      return `BT /${faceOf(p.style)} ${n(size)} Tf ${rgb} rg ${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x)} ${n(y)} Tm (${pdfString(p.text)}) Tj ET`;
    }
    default:
      return assertNever(p);
  }
}

/** Counter-clockwise from `from` to `to`, as cubic Béziers of at most a quarter turn each. */
function arcPath(c: Point, r: number, from: number, to: number): string {
  const parts = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2) - 1e-9));
  const step = (to - from) / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const on = (a: number): Point => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  let d = `${pt(on(from))} m`;
  for (let i = 0; i < parts; i++) {
    const a = from + i * step;
    const b = a + step;
    const p0 = on(a);
    const p3 = on(b);
    const p1 = { x: p0.x - k * r * Math.sin(a), y: p0.y + k * r * Math.cos(a) };
    const p2 = { x: p3.x + k * r * Math.sin(b), y: p3.y - k * r * Math.cos(b) };
    d += ` ${pt(p1)} ${pt(p2)} ${pt(p3)} c`;
  }
  return d;
}

/** Page widths are millimetres; the sheet has no world widths left, but a { m } one is taken as millimetres too. */
function width(w: Width): number {
  return "px" in w ? w.px : w.m;
}

function pt(p: Point): string {
  return `${n(p.x * PT)} ${n(p.y * PT)}`;
}

/** `#rrggbb` or `#rrggbbaa` as PDF colour operands and an opacity. */
function colour(color: string): { rgb: string; alpha: number } {
  const [r, g, b, alpha] = colorChannels(color);
  return { rgb: `${n(r)} ${n(g)} ${n(b)}`, alpha };
}

function stateFor(alphas: Map<string, string>, alpha: number): string {
  const key = alpha.toFixed(2);
  let name = alphas.get(key);
  if (!name) {
    name = `GS${alphas.size}`;
    alphas.set(key, name);
  }
  return name;
}

/** A PDF literal string body: Windows-1252 bytes, with ( ) \ escaped and bytes above 0x7e as octal. */
function pdfString(text: string): string {
  return toWinAnsi(text)
    .map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b > 0x7e ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b)))
    .join("");
}

/** Numbers to at most four decimals, without trailing zeros or negative zero. */
function n(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}
