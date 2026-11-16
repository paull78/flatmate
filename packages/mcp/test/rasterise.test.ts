import { describe, expect, it } from "vitest";
import { textWidth, type Primitive } from "@fm/editor";
import { toSvg, type Frame } from "@fm/export";
import { existsSync } from "node:fs";
import { LOOK_FONTS, svgToPixels, svgToPng } from "../src/rasterise";
import { mulberry32, pngSize, quadrantJpeg, rgb } from "./pictures";

// resvg turns toSvg's output into pixels (import.12). Frames are off the origin and not square, so a wrong y flip, origin
// or square assumption moves what the probes see. Text draws in the bundled Inter only (render.15).

type Pixels = { width: number; height: number; pixels: Uint8Array };

function pixelAt(img: Pixels, x: number, y: number): [number, number, number] {
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [img.pixels[i] ?? -1, img.pixels[i + 1] ?? -1, img.pixels[i + 2] ?? -1];
}

/** The look pixel of world point p in `frame`: x from the left, y down from the top. */
function pixelOf(frame: Frame, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - frame.min.x) * frame.zoom, y: (frame.max.y - p.y) * frame.zoom };
}

function near(actual: readonly number[], expected: readonly number[], tolerance: number): boolean {
  return actual.every((v, i) => Math.abs(v - (expected[i] ?? Infinity)) <= tolerance);
}

const WHITE = [255, 255, 255] as const;
const longSide = (f: Frame): number => Math.round(Math.max(f.max.x - f.min.x, f.max.y - f.min.y) * f.zoom);
const box = (minX: number, minY: number, maxX: number, maxY: number, color: string): Primitive => ({
  kind: "polygon",
  points: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
  holes: [],
  color,
});

describe("svgToPng and svgToPixels (resvg)", () => {
  it("svgToPng returns a PNG whose size follows the long side asked and the SVG's aspect", () => {
    const zoom = 1100 / 7.7;
    const frame: Frame = { min: { x: 4.1, y: -2.2 }, max: { x: 4.1 + 3.3, y: -2.2 + 7.7 }, zoom };
    const png = svgToPng(toSvg([], frame), 1100);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(png)).toEqual({ width: Math.round(3.3 * zoom), height: 1100 });
    expect(Math.round(3.3 * zoom)).toBe(471);
  });

  it("svgToPixels puts an off-centre polygon where the frame says, y flipped", () => {
    const frame: Frame = { min: { x: -0.7, y: 0.3 }, max: { x: 2.6, y: 8.0 }, zoom: 50 };
    const img = svgToPixels(toSvg([box(0.4, 5.0, 1.0, 6.2, "#c02020")], frame), longSide(frame));
    expect([img.width, img.height]).toEqual([165, 385]);
    const c = pixelOf(frame, { x: 0.7, y: 5.6 });
    expect(near(pixelAt(img, c.x, c.y), rgb("#c02020"), 8)).toBe(true);
    const tl = pixelOf(frame, { x: 0.4, y: 6.2 });
    const br = pixelOf(frame, { x: 1.0, y: 5.0 });
    for (const [x, y] of [[tl.x - 3, c.y], [br.x + 3, c.y], [c.x, tl.y - 3], [c.x, br.y + 3]] as const) {
      expect(pixelAt(img, x, y)).toEqual(WHITE);
    }
    // The y-flip bug would draw it at the mirrored height.
    const mirrored = (frame.min.y + frame.max.y) - 5.6;
    expect(pixelAt(img, c.x, pixelOf(frame, { x: 0.7, y: mirrored }).y)).toEqual(WHITE);
  });

  it("a JPEG backdrop lands stretched, grey and faded, top row at maxY", () => {
    const colours = ["#000000", "#2040ff", "#909090", "#e0e0e0"] as const; // TL, TR, BL, BR: four different lumas
    const data = Buffer.from(quadrantJpeg(64, 48, colours, 95)).toString("base64");
    // 4:3 pixels in a 4:5 rect, probed an eighth in from each corner: a letterboxed (aspect-kept) picture leaves those
    // probes white. Fade 0.35, not 0.5, so opacity fade and 1 − fade differ.
    const rect = { minX: 0.35, minY: 0.6, maxX: 2.75, maxY: 3.6 };
    const fade = 0.35;
    const frame: Frame = { min: { x: 0.05, y: 0.3 }, max: { x: 3.25, y: 3.9 }, zoom: 100, backdrop: { data, rect, fade, grey: true } };
    const img = svgToPixels(toSvg([], frame), longSide(frame));
    // SVG's saturate-0 matrix in sRGB, then the image's opacity 1 − fade over white.
    const expected = (hex: string): number[] => {
      const [r, g, b] = rgb(hex);
      const grey = 0.213 * r + 0.715 * g + 0.072 * b;
      return [0, 1, 2].map(() => 255 * fade + grey * (1 - fade));
    };
    const qw = (rect.maxX - rect.minX) / 8;
    const qh = (rect.maxY - rect.minY) / 8;
    const centres = [
      { x: rect.minX + qw, y: rect.maxY - qh },
      { x: rect.maxX - qw, y: rect.maxY - qh },
      { x: rect.minX + qw, y: rect.minY + qh },
      { x: rect.maxX - qw, y: rect.minY + qh },
    ];
    centres.forEach((c, i) => {
      const p = pixelOf(frame, c);
      const actual = pixelAt(img, p.x, p.y);
      expect({ quadrant: i, ok: near(actual, expected(colours[i] ?? ""), 12), actual }).toMatchObject({ ok: true });
    });
    const outside = pixelOf(frame, { x: rect.maxX + 0.1, y: rect.maxY + 0.1 });
    expect(pixelAt(img, outside.x, outside.y)).toEqual(WHITE);
  });

  it("text renders ink in the bundled Inter, with no system font (render.15)", () => {
    const frame: Frame = { min: { x: 0, y: 0 }, max: { x: 2, y: 1 }, zoom: 100 };
    const label: Primitive = { kind: "text", text: "8.5", at: { x: 1, y: 0.5 }, size: 24, color: "#1a1a1a", align: "center", rotation: 0, font: "inter" };
    const img = svgToPixels(toSvg([label], frame), longSide(frame));
    const c = pixelOf(frame, label.at);
    const half = { w: textWidth("inter", label.text, 24) / 2, h: 24 / 2 };
    let darkest = 255;
    for (let y = Math.floor(c.y - half.h); y < c.y + half.h; y++) {
      for (let x = Math.floor(c.x - half.w); x < c.x + half.w; x++) {
        const [r, g, b] = pixelAt(img, x, y);
        darkest = Math.min(darkest, 0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    expect(darkest).toBeLessThan(128);
  });

  it("text draws as wide as the core measures it: the bundled Inter, unkerned (render.15)", () => {
    // Ink spans a little less than the advance width (the side bearings of the first and last glyph); with a system
    // font, or kerned, "AVATAR To Ty" comes out several percent narrower still.
    const text = "AVATAR To Ty 7.4 m²";
    const frame: Frame = { min: { x: 0, y: 0 }, max: { x: 6, y: 1 }, zoom: 100 };
    const label: Primitive = { kind: "text", text, at: { x: 0.2, y: 0.5 }, size: 40, color: "#000000", align: "left", rotation: 0, font: "inter" };
    const img = svgToPixels(toSvg([label], frame), longSide(frame));
    let left = Infinity;
    let right = -Infinity;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r] = pixelAt(img, x, y);
        if (r < 128) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    const scale = img.width / (6 * 100); // pixels per SVG unit
    const ratio = (right - left + 1) / scale / textWidth("inter", text, 40);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("random rectangles land where the frame transform says (seeded fuzz, seed 1601, 20 cases)", () => {
    const random = mulberry32(1601);
    const between = (lo: number, hi: number): number => lo + (hi - lo) * random();
    for (let i = 0; i < 20; i++) {
      const long = between(1, 20);
      const short = long * between(0.3, 0.8); // never square
      const [w, h] = random() < 0.5 ? [long, short] : [short, long];
      const min = { x: between(-500, 500), y: between(-500, 500) };
      const side = Math.round(between(200, 600));
      const frame: Frame = { min, max: { x: min.x + w, y: min.y + h }, zoom: side / Math.max(w, h) };
      // A rect at least 12 px on a side, at least 8 px inside the frame.
      const margin = 8 / frame.zoom;
      const rw = between(12 / frame.zoom, w / 2);
      const rh = between(12 / frame.zoom, h / 2);
      const x0 = between(min.x + margin, min.x + w - rw - margin);
      const y0 = between(min.y + margin, min.y + h - rh - margin);
      const color = `#${[0, 1, 2].map(() => Math.floor(between(0, 200)).toString(16).padStart(2, "0")).join("")}`;
      const img = svgToPixels(toSvg([box(x0, y0, x0 + rw, y0 + rh, color)], frame), side);
      const c = pixelOf(frame, { x: x0 + rw / 2, y: y0 + rh / 2 });
      const corner = pixelOf(frame, { x: x0, y: y0 + rh });
      const report = { case: i, centre: pixelAt(img, c.x, c.y), outside: pixelAt(img, corner.x - 3, corner.y - 3) };
      expect({ ...report, centreOk: near(report.centre, rgb(color), 8) }).toMatchObject({ centreOk: true, outside: [...WHITE] });
    }
  });
});

describe("look's fonts (render.15, AC-04)", () => {
  it("are the editor's bundled Inter only", () => {
    expect(LOOK_FONTS.loadSystemFonts).toBe(false);
    expect(LOOK_FONTS.defaultFontFamily).toBe("Inter");
    expect(LOOK_FONTS.fontFiles).toHaveLength(1);
    expect(LOOK_FONTS.fontFiles[0]).toMatch(/packages\/editor\/fonts\/Inter-Regular\.ttf$/);
    expect(existsSync(LOOK_FONTS.fontFiles[0] ?? "")).toBe(true);
  });
});
