import { describe, expect, it } from "vitest";
import { helveticaWidth, type Primitive } from "@fm/editor";
import { FakeShell, labelledDoc, withCommands } from "@fm/editor/testing";
import { toPdf } from "../src/pdf";
import { download, MOSAIC, PLANKS } from "./finished-rooms";
import { operands, readPdf } from "./pdf-reader";

// The PDF writer (export.13, .16, .17; AC-08, AC-12, AC-13): pages in millimetres, y up, written as PDF 1.4 with the
// built-in Helvetica in Windows-1252, no font embedding.

const MM = 72 / 25.4;
const A4 = { widthMm: 210, heightMm: 297 };
const page = (primitives: Primitive[]) => ({ ...A4, primitives });
const wall: Primitive = { kind: "segment", a: { x: 20, y: 100 }, b: { x: 100, y: 100 }, width: { px: 0.25 }, color: "#1a1a1a", cap: "butt" };
const label = (text: string, align: "left" | "center" | "right" = "left"): Primitive => ({ kind: "text", text, at: { x: 50, y: 50 }, size: 2.5, color: "#1a1a1a", align, rotation: 0, font: "helvetica" });
const styled = (text: string, style: "bold" | "oblique", align: "left" | "center" = "left"): Primitive => ({ kind: "text", text, at: { x: 50, y: 50 }, size: 2.5, color: "#1a1a1a", align, rotation: 0, font: "helvetica", style });
const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("toPdf (AC-12)", () => {
  it("starts with %PDF-1.4 and ends with %%EOF", () => {
    const text = latin1(toPdf([page([])]));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("every cross-reference offset points at its object, and startxref at the table", () => {
    const pdf = readPdf(toPdf([page([wall, label("Kitchen")]), page([wall])]));
    expect(pdf.offsetsOk).toBe(true);
    expect(pdf.startxrefOk).toBe(true);
  });

  it("one page per sheet page, with its size in points", () => {
    const pdf = readPdf(toPdf([page([]), { widthMm: 297, heightMm: 210, primitives: [] }]));
    expect(pdf.pages.map((p) => p.mediaBox)).toEqual([[0, 0, 595.28, 841.89], [0, 0, 841.89, 595.28]]);
  });
});

describe("a cover in the file (sheetset AC-08)", () => {
  /** The file a cover saves: the shell's own download, the cover the first page (sheetset.70). */
  function saved(): string {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.ui({ type: "openExport" });
    shell.ui({ type: "addSheet", kind: "cover" });
    shell.ui({ type: "setSheetSetting", key: "accent", value: "#0a7d55" });
    shell.ui({ type: "download", format: "pdf" });
    const content = shell.effectsOf("saveFile")[0]?.content;
    if (content?.kind !== "pdf") throw new Error("no pdf");
    return readPdf(toPdf(content.pages)).pages[0]?.content ?? "";
  }
  const TINT = "0.9686 0.9608 0.949 rg"; // #f7f5f2
  const BAND = "0.0392 0.4902 0.3333 rg"; // the accent, #0a7d55

  it("its column's tint and its band are drawn in the PDF", () => {
    const content = saved();
    expect(content).toContain(TINT);
    expect(content).toContain(BAND);
  });

  it("the tint goes down before the column's words, and one clip holds the plan, closed before the tint", () => {
    const content = saved();
    expect(content.indexOf("(DRAWINGS)")).toBeGreaterThan(content.indexOf(TINT));
    expect(content.match(/\bre W n\b/g)).toHaveLength(1);
    const clip = content.indexOf("re W n");
    const closed = content.indexOf("\nQ\n", clip);
    expect(closed).toBeGreaterThan(clip);
    expect(content.indexOf(TINT)).toBeGreaterThan(closed);
  });
});

describe("drawing (AC-08)", () => {
  it("a segment 80 mm long is 226.77 pt long in the content stream", () => {
    const content = readPdf(toPdf([page([wall])])).pages[0]?.content ?? "";
    const [move] = operands(content, "m");
    const [line] = operands(content, "l");
    expect((line?.[0] ?? 0) - (move?.[0] ?? 0)).toBeCloseTo(80 * MM, 1);
    expect((line?.[0] ?? 0) - (move?.[0] ?? 0)).toBeCloseTo(226.77, 1);
    expect(operands(content, "w")[0]?.[0]).toBeCloseTo(0.25 * MM, 3);
  });

  it("a polygon is filled with its colour", () => {
    const fill: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [], color: "#ff0000" };
    const content = readPdf(toPdf([page([fill])])).pages[0]?.content ?? "";
    expect(operands(content, "rg")[0]).toEqual([1, 0, 0]);
    expect(content).toMatch(/\bh\s+f\b/);
    expect(content).not.toMatch(/f\*/);
  });

  it("a polygon with a hole is two subpaths filled even-odd", () => {
    const fill: Primitive = {
      kind: "polygon",
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      holes: [[{ x: 2, y: 2 }, { x: 2, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 2 }]],
      color: "#ff0000",
    };
    const content = readPdf(toPdf([page([fill])])).pages[0]?.content ?? "";
    const moves = operands(content, "m");
    expect(moves).toHaveLength(2);
    expect(moves[1]?.[0]).toBeCloseTo(2 * MM, 2);
    expect(moves[1]?.[1]).toBeCloseTo(2 * MM, 2);
    expect(content).toMatch(/\bh\s+f\*/);
  });

  it("a colour with alpha draws through a graphics state with that opacity", () => {
    const fill: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [], color: "#ff000080" };
    const pdf = readPdf(toPdf([page([fill])]));
    expect(pdf.pages[0]?.content).toMatch(/\/GS\d+ gs/);
    expect([...pdf.objects.values()].some((o) => /\/ca 0\.50/.test(o))).toBe(true);
  });

  it("an arc becomes Bézier curves within 0.05 mm of the circle", () => {
    const arc: Primitive = { kind: "arc", center: { x: 100, y: 100 }, radius: 40, from: 0, to: Math.PI / 2, width: { px: 0.18 }, color: "#000000" };
    const content = readPdf(toPdf([page([arc])])).pages[0]?.content ?? "";
    const curves = operands(content, "c");
    expect(curves.length).toBeGreaterThan(0);
    // The end of each curve lies on the circle.
    for (const c of curves) {
      const x = (c[4] ?? 0) / MM - 100;
      const y = (c[5] ?? 0) / MM - 100;
      expect(Math.abs(Math.hypot(x, y) - 40)).toBeLessThan(0.05);
    }
    const last = curves[curves.length - 1] ?? [];
    expect((last[4] ?? 0) / MM).toBeCloseTo(100, 2);
    expect((last[5] ?? 0) / MM).toBeCloseTo(140, 2);
  });
});

describe("text (AC-13)", () => {
  it("uses Helvetica in Windows-1252: × is 0xD7 and ² is 0xB2", () => {
    const content = readPdf(toPdf([page([label("4.20 × 3.10 m"), label("13.02 m²")])])).pages[0]?.content ?? "";
    expect(content).toContain("(4.20 \\327 3.10 m) Tj");
    expect(content).toContain("(13.02 m\\262) Tj");
    expect(content).toMatch(/\/F1 [\d.]+ Tf/);
  });

  it("characters outside Windows-1252 become ?", () => {
    const content = readPdf(toPdf([page([label("Κουζίνα")])])).pages[0]?.content ?? "";
    expect(content).toContain("(???????) Tj");
  });

  it("escapes parentheses and backslashes", () => {
    const content = readPdf(toPdf([page([label("a(b)c\\d")])])).pages[0]?.content ?? "";
    expect(content).toContain("(a\\(b\\)c\\\\d) Tj");
  });

  it("the bold and oblique fonts are in the file, no embedded font", () => {
    const pdf = readPdf(toPdf([page([label("plain"), styled("strong", "bold"), styled("slanted", "oblique")])]));
    const bodies = [...pdf.objects.values()];
    for (const font of ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique"]) expect(bodies.filter((o) => o.includes(`/BaseFont /${font} /Encoding /WinAnsiEncoding`))).toHaveLength(1);
    expect(bodies.some((o) => /FontFile|FontDescriptor|\/Widths/.test(o))).toBe(false);
    const content = pdf.pages[0]?.content ?? "";
    const faceOf = (word: string): string | undefined => new RegExp(`/(F\\d) [\\d.]+ Tf [^()]*\\(${word}\\) Tj`).exec(content)?.[1];
    const resource = /\/Font << ([^>]*) >>/.exec(bodies.find((o) => o.includes("/Type /Page ")) ?? "")?.[1] ?? "";
    const baseFontOf = (face: string | undefined): string | undefined => {
      const id = new RegExp(`/${face ?? ""} (\\d+) 0 R`).exec(resource)?.[1];
      return /\/BaseFont \/(\S+)/.exec(pdf.objects.get(Number(id)) ?? "")?.[1];
    };
    expect(baseFontOf(faceOf("plain"))).toBe("Helvetica");
    expect(baseFontOf(faceOf("strong"))).toBe("Helvetica-Bold");
    expect(baseFontOf(faceOf("slanted"))).toBe("Helvetica-Oblique");
    expect(pdf.offsetsOk).toBe(true);
  });

  it("characters outside Windows-1252 warn as today", () => {
    const shell = FakeShell.withDocument(withCommands(labelledDoc(), { type: "addSheet", opId: "r", after: null, kind: "report", title: "Report", drawings: [], text: "# Κουζίνα\n\nè e €" }));
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.warning).toMatch(/characters the PDF can't show/);
    const content = readPdf(toPdf([page([styled("Κουζίνα", "bold")])])).pages[0]?.content ?? "";
    expect(content).toContain("(???????) Tj");
  });

  it("centred bold text is moved left by half its bold width", () => {
    // "nn": two n at 611/1000 em bold, 556 regular; 2.5 mm text → width 2 × 0.611 × 2.5 mm = 3.055 mm.
    const content = readPdf(toPdf([page([styled("nn", "bold", "center")])])).pages[0]?.content ?? "";
    const [tm] = operands(content, "Tm");
    expect((tm?.[4] ?? 0) / MM).toBeCloseTo(50 - 3.055 / 2, 2);
  });

  it("centred text is moved left by half its Helvetica width", () => {
    // "HH": two H at 722/1000 em; 2.5 mm text → width 2 × 0.722 × 2.5 mm = 3.61 mm.
    const content = readPdf(toPdf([page([{ ...label("HH", "center") }])])).pages[0]?.content ?? "";
    const [tm] = operands(content, "Tm");
    expect(((tm?.[4] ?? 0) / MM)).toBeCloseTo(50 - 3.61 / 2, 2);
  });

  it("text turned a quarter turn reads bottom to top, centred on its point", () => {
    const turned: Primitive = { kind: "text", text: "6.20", at: { x: 50, y: 50 }, size: 2.5, color: "#b3261e", align: "center", rotation: Math.PI / 2, font: "helvetica" };
    const content = readPdf(toPdf([page([turned])])).pages[0]?.content ?? "";
    const [tm] = operands(content, "Tm");
    expect(tm?.slice(0, 4)).toEqual([0, 1, -1, 0]);
    // The baseline sits 0.35 em right of the point (below the text as it reads): 0.35 × 2.5 mm = 0.875 mm.
    expect((tm?.[4] ?? 0) / MM).toBeCloseTo(50 + 0.875, 2);
    expect(tm?.[5] ?? 0).toBeCloseTo(50 * MM - helveticaWidth("6.20", 2.5 * MM) / 2, 2);
  });
});

describe("finishes in the PDF (AC-12)", () => {
  const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const has = (ops: number[][], hex: string): boolean => ops.some((o) => o.length === 3 && o.every((v, i) => Math.abs(v - (channels(hex)[i] ?? NaN)) < 1e-3));
  const contentOf = (finishes?: "with" | "without"): string => {
    const content = download("pdf", finishes);
    if (content.kind !== "pdf") throw new Error("not a pdf");
    return readPdf(toPdf(content.pages)).pages[0]?.content ?? "";
  };

  it("with finishes (the default), fills the rooms in their base colours and strokes the planks' lines", () => {
    const content = contentOf();
    expect(has(operands(content, "rg"), PLANKS.fill)).toBe(true);
    expect(has(operands(content, "rg"), MOSAIC.fill)).toBe(true);
    expect(has(operands(content, "RG"), PLANKS.line)).toBe(true);
  });

  it("without finishes, neither", () => {
    const content = contentOf("without");
    expect(has(operands(content, "rg"), PLANKS.fill)).toBe(false);
    expect(has(operands(content, "rg"), MOSAIC.fill)).toBe(false);
    expect(has(operands(content, "RG"), PLANKS.line)).toBe(false);
    expect(operands(content, "RG").length).toBeGreaterThan(0);
  });
});

describe("clips (sheetset.17)", () => {
  const rect = { x: 10, y: 20, w: 30, h: 40 };
  const RE = "28.3465 56.6929 85.0394 113.3858 re W n"; // the rect in points, written out so it doesn't come from the code
  const WALL = "0.102 0.102 0.102 RG 0.7087 w 0 J [] 0 d 56.6929 283.4646 m 283.4646 283.4646 l S";
  const KITCHEN = "BT /F1 7.0866 Tf 0.102 0.102 0.102 rg 1 0 0 1 141.7323 139.252 Tm (Kitchen) Tj ET";
  const HALF_RED = "1 0 0 rg 0 0 m 28.3465 0 l 28.3465 28.3465 l h f";
  const halfRed: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [], color: "#ff000080" };
  const kitchen = label("Kitchen");
  const lines = (bytes: Uint8Array): string[] => (readPdf(bytes).pages[0]?.content ?? "").split("\n");

  it("a clip writes re W n inside q and Q, in that order, before its content", () => {
    expect(lines(toPdf([{ ...A4, primitives: [wall, kitchen], clips: [{ rect, from: 0, to: 2 }] }]))).toEqual(["q", RE, WALL, KITCHEN, "Q"]);
  });

  it("draws only its range inside: what comes before and after stays outside", () => {
    expect(lines(toPdf([{ ...A4, primitives: [wall, kitchen, wall], clips: [{ rect, from: 1, to: 2 }] }]))).toEqual([WALL, "q", RE, KITCHEN, "Q", WALL]);
  });

  it("two clips on a page, each its own q and Q", () => {
    const clips = [{ rect, from: 0, to: 1 }, { rect, from: 2, to: 3 }];
    expect(lines(toPdf([{ ...A4, primitives: [wall, kitchen, wall], clips }]))).toEqual(["q", RE, WALL, "Q", KITCHEN, "q", RE, WALL, "Q"]);
  });

  it("an opacity inside a clip nests its own q and Q", () => {
    expect(lines(toPdf([{ ...A4, primitives: [halfRed], clips: [{ rect, from: 0, to: 1 }] }]))).toEqual(["q", RE, "q", "/GS0 gs", HALF_RED, "Q", "Q"]);
  });

  it("the file stays well formed", () => {
    const pdf = readPdf(toPdf([{ ...A4, primitives: [wall], clips: [{ rect, from: 0, to: 1 }] }, page([wall])]));
    expect(pdf.offsetsOk).toBe(true);
    expect(pdf.startxrefOk).toBe(true);
    expect(pdf.pages[1]?.content).toBe(WALL); // clips belong to their page
  });

  it("no clips writes today's bytes", () => {
    const primitives = [wall, halfRed, kitchen];
    // Pinned from the writer before clips existed.
    expect(lines(toPdf([page(primitives)]))).toEqual([WALL, "q", "/GS0 gs", HALF_RED, "Q", KITCHEN]);
    expect(toPdf([{ ...A4, primitives, clips: [] }])).toEqual(toPdf([page(primitives)]));
  });
});

describe("a page image (sheetset.21; AC-13)", () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const base64 = (bytes: readonly number[]): string => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const [a = 0, b, c] = bytes.slice(i, i + 3);
      const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
      out += `${ALPHABET[n >> 18] ?? ""}${ALPHABET[(n >> 12) & 63] ?? ""}${b === undefined ? "=" : (ALPHABET[(n >> 6) & 63] ?? "")}${c === undefined ? "=" : (ALPHABET[n & 63] ?? "")}`;
    }
    return out;
  };
  /** A JPEG as far as a reader needs: a marker before the frame's, then the frame, then bytes that matter to no text encoding. */
  const jpegBytes = (width: number, height: number, components = 3, marker = 0xc0): number[] => [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
    0xff, marker, 0x00, 8 + 3 * components, 8, height >> 8, height & 255, width >> 8, width & 255, components, ...new Array<number>(3 * components).fill(1),
    0xff, 0xda, 0x00, 0x7f, 0x80, 0x0a, 0x0d, 0x28, 0x29, 0x5c, 0xc3, 0xa9, 0xff, 0xd9,
  ];
  const JPEG = jpegBytes(600, 200);
  const rect = { x: 150, y: 270, w: 30, h: 10 };
  const imaged = (primitives: Primitive[] = [wall], jpeg = base64(JPEG), at = rect) => ({ ...A4, primitives, images: [{ rect: at, jpeg }] });
  const xObjects = (pdf: ReturnType<typeof readPdf>): string[] => [...pdf.objects.values()].filter((o) => o.includes("/Subtype /Image"));
  const bytesOf = (object: string): number[] => {
    const start = object.indexOf("stream\n") + "stream\n".length;
    return Array.from(object.slice(start, object.lastIndexOf("\nendstream")), (ch) => ch.charCodeAt(0));
  };

  it("a page image writes one XObject per file, DCTDecode, drawn at its rect", () => {
    const pdf = readPdf(toPdf([imaged(), imaged()]));
    const [image, ...more] = xObjects(pdf);
    expect(more).toEqual([]);
    expect(image).toContain("/Type /XObject");
    expect(image).toContain("/Filter /DCTDecode");
    expect(image).toContain("/Width 600");
    expect(image).toContain("/Height 200");
    expect(image).toContain("/ColorSpace /DeviceRGB");
    expect(image).toContain("/BitsPerComponent 8");
    for (const { content } of pdf.pages) {
      // A unit square scaled to the rect and moved to its corner, in points, last so a tint can't cover it.
      expect(content.split("\n").slice(-3)).toEqual(["q", `${(30 * MM).toFixed(4)} 0 0 ${(10 * MM).toFixed(4)} ${(150 * MM).toFixed(4)} ${(270 * MM).toFixed(4)} cm /Im0 Do`, "Q"]);
    }
  });

  it("the file's structure holds, and the stream is the JPEG's bytes as they are, however they read", () => {
    const pdf = readPdf(toPdf([imaged(), page([wall])]));
    expect(pdf.offsetsOk).toBe(true);
    expect(pdf.startxrefOk).toBe(true);
    const [image] = xObjects(pdf);
    expect(bytesOf(image ?? "")).toEqual(JPEG);
    expect(image).toContain(`/Length ${JPEG.length}`);
  });

  it("every length of base64 ending decodes", () => {
    for (const extra of [[], [1], [1, 2]]) {
      const bytes = [...JPEG, ...extra];
      expect(bytesOf(xObjects(readPdf(toPdf([imaged([], base64(bytes))])))[0] ?? "")).toEqual(bytes);
    }
  });

  it("two files, two XObjects; only a page showing one names one", () => {
    const pdf = readPdf(toPdf([imaged([wall], base64(JPEG)), page([wall]), imaged([wall], base64(jpegBytes(100, 400)))]));
    expect(xObjects(pdf)).toHaveLength(2);
    const bodies = [...pdf.objects.values()].filter((o) => /\/Type \/Page\b/.test(o));
    expect(bodies.map((b) => /\/XObject << ([^>]*) >>/.exec(b)?.[1]?.replace(/\d+ 0 R/, "ref") ?? null)).toEqual(["/Im0 ref", null, "/Im1 ref"]);
    expect(pdf.pages[0]?.content).toContain("/Im0 Do");
    expect(pdf.pages[1]?.content).not.toContain(" Do");
    expect(pdf.pages[2]?.content).toContain("/Im1 Do");
  });

  it("a page's objects stay numbered from 7, so what a file without images holds doesn't move", () => {
    const pdf = readPdf(toPdf([imaged(), imaged()]));
    expect(pdf.objects.get(7)).toContain("/Type /Page");
    expect(pdf.objects.get(9)).toContain("/Type /Page");
    expect(pdf.objects.get(11)).toContain("/Subtype /Image");
  });

  it("the size and colours are read from the JPEG, as it's the frame a reader decodes that counts", () => {
    const [grey] = xObjects(readPdf(toPdf([imaged([], base64(jpegBytes(40, 30, 1)))])));
    expect(grey).toContain("/ColorSpace /DeviceGray");
    expect(grey).toContain("/Width 40");
    expect(grey).toContain("/Height 30");
    const [progressive] = xObjects(readPdf(toPdf([imaged([], base64(jpegBytes(40, 30, 3, 0xc2)))])));
    expect(progressive).toContain("/Width 40");
  });

  it.each([["not base64 at all", "@@@@"], ["a JPEG's start with no frame", base64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9])], ["a frame cut short", base64([0xff, 0xd8, 0xff, 0xc0, 0x00])], ["CMYK", base64(jpegBytes(40, 30, 4))]])("%s draws nothing, and the file still saves", (_, jpeg) => {
    const pdf = readPdf(toPdf([imaged([wall], jpeg)]));
    expect(xObjects(pdf)).toEqual([]);
    expect(pdf.pages[0]?.content).not.toContain(" Do");
    expect(pdf.offsetsOk).toBe(true);
    expect(toPdf([imaged([wall], jpeg)])).toEqual(toPdf([page([wall])]));
  });

  it("no images writes today's bytes", () => {
    // Pinned from the writer before images existed.
    const today = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [7 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n6 0 obj\n<<  >>\nendobj\n7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /ExtGState 6 0 R >> /Contents 8 0 R >>\nendobj\n8 0 obj\n<< /Length 81 >>\nstream\n0.102 0.102 0.102 RG 0.7087 w 0 J [] 0 d 56.6929 283.4646 m 283.4646 283.4646 l S\nendstream\nendobj\nxref\n0 9\n0000000000 65535 f \n0000000015 00000 n \n0000000064 00000 n \n0000000121 00000 n \n0000000218 00000 n \n0000000320 00000 n \n0000000425 00000 n \n0000000447 00000 n \n0000000616 00000 n \ntrailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n747\n%%EOF\n";
    expect(latin1(toPdf([page([wall])]))).toBe(today);
    expect(latin1(toPdf([{ ...page([wall]), images: [] }]))).toBe(today);
  });
});
