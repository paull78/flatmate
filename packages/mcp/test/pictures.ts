import { MAX_UNDERLAY_DATA_CHARS } from "@fm/protocol";
import { encode } from "jpeg-js";
import { svgToPixels } from "../src/rasterise";

// Test pictures (import steps 01, 08): real JPEGs, because resvg does not sniff types and the drawing stores JPEG only.

/**
 * look's test quadrants (AC-08): TL black, TR red, BL green, BR light yellow, each pair at least 45 luma apart under
 * Rec.601 and Rec.709, so the grey look still tells them apart.
 */
export const QUADRANTS = ["#000000", "#dc0000", "#00c800", "#ffff78"] as const;

/** A seeded PRNG in [0, 1): the same seed gives the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `#rrggbb` as [r, g, b]. */
export function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** w × h RGBA pixels in four flat quadrants: colours top-left, top-right, bottom-left, bottom-right. */
function quadrantPixels(w: number, h: number, colours: readonly [string, string, string, string]): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = (y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1);
      const [r, g, b] = rgb(colours[q] ?? "#000000");
      rgba.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return rgba;
}

/** A w × h JPEG in four flat quadrants: colours top-left, top-right, bottom-left, bottom-right. */
export function quadrantJpeg(w: number, h: number, colours: readonly [string, string, string, string], quality: number): Uint8Array {
  return encode({ data: quadrantPixels(w, h, colours), width: w, height: h }, quality).data;
}

/** RGBA pixels plus seeded grain of ±amplitude per channel, as a JPEG: a photo-like worst case for the size budget. */
export function grainJpeg(rgba: Uint8Array, w: number, h: number, amplitude: number, seed: number, quality: number): Uint8Array {
  const random = mulberry32(seed);
  const noisy = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i++) {
    noisy[i] = i % 4 === 3 ? 255 : Math.max(0, Math.min(255, Math.round((rgba[i] ?? 0) + (random() * 2 - 1) * amplitude)));
  }
  return encode({ data: noisy, width: w, height: h }, quality).data;
}

/** A PNG's pixel size from its IHDR chunk (big-endian at bytes 16 and 20). */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const base64Length = (bytes: Uint8Array): number => 4 * Math.ceil(bytes.length / 3);
const noisy = new Map<number, Uint8Array>();

/**
 * look's worst case (AC-14): a 2000 × 1500 JPEG of QUADRANTS under seeded grain at the largest amplitude, in steps of
 * 8, whose base64 fits MAX_UNDERLAY_DATA_CHARS at q60 (step 01's search). Cached per seed: each encode costs ~0.3 s.
 */
export function noisyJpeg(seed: number): Uint8Array {
  const cached = noisy.get(seed);
  if (cached) return cached;
  const base = quadrantPixels(2000, 1500, QUADRANTS);
  let best: Uint8Array | null = null;
  for (let amplitude = 8; amplitude <= 128; amplitude += 8) {
    const jpeg = grainJpeg(base, 2000, 1500, amplitude, seed, 60);
    if (base64Length(jpeg) > MAX_UNDERLAY_DATA_CHARS) break; // more grain, more bytes
    best = jpeg;
  }
  if (best === null) throw new Error("no grain fits the underlay cap");
  noisy.set(seed, best);
  return best;
}

/** A PNG's RGBA pixels, re-rendered 1:1 through resvg: no PNG decoder dependency (import.21). */
export function pngPixels(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const { width: w, height: h } = pngSize(png);
  const href = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${href}" width="${w}" height="${h}"/></svg>`;
  return svgToPixels(svg, Math.max(w, h));
}
