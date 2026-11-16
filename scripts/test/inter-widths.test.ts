import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interWidthsSource } from "../src/inter-widths";

const TTF = readFileSync(new URL("../../packages/editor/fonts/Inter-Regular.ttf", import.meta.url));
const COMMITTED = readFileSync(new URL("../../packages/editor/src/view/inter-widths.ts", import.meta.url), "utf8");

/** The table as committed, read from the file's text (scripts/ may not import the editor). */
function committedWidths(): number[] {
  const body = /INTER_WIDTHS: readonly number\[\] = \[([^\]]*)\]/.exec(COMMITTED)?.[1] ?? "";
  return body.split(",").map((s) => s.trim()).filter((s) => s !== "").map(Number);
}

/** A second reader, independent of the generator: the advance of the glyph a code point maps to. */
function advanceOf(codePoint: number): number {
  const view = new DataView(TTF.buffer, TTF.byteOffset, TTF.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...TTF.subarray(rec, rec + 4));
    tables.set(tag, view.getUint32(rec + 8));
  }
  const cmap = tables.get("cmap") ?? 0;
  let sub = -1;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    if (view.getUint16(rec) === 3 && view.getUint16(rec + 2) === 1) sub = cmap + view.getUint32(rec + 4);
  }
  expect(view.getUint16(sub)).toBe(4);
  const segX2 = view.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  let glyph = 0;
  for (let s = 0; s < segX2; s += 2) {
    if (view.getUint16(ends + s) < codePoint) continue;
    const start = view.getUint16(starts + s);
    if (start > codePoint) break;
    const delta = view.getUint16(deltas + s);
    const ro = view.getUint16(rangeOffsets + s);
    const raw = ro === 0 ? codePoint : view.getUint16(rangeOffsets + s + ro + (codePoint - start) * 2);
    glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
    break;
  }
  expect(glyph).toBeGreaterThan(0);
  const metrics = view.getUint16((tables.get("hhea") ?? 0) + 34);
  return view.getUint16((tables.get("hmtx") ?? 0) + Math.min(glyph, metrics - 1) * 4);
}

describe("Inter widths (render F · Fonts, AC-03)", () => {
  it("the committed table is fresh: the generator writes exactly inter-widths.ts", () => {
    expect(interWidthsSource(TTF)).toBe(COMMITTED);
  });

  it("interWidth spot checks against the TTF", () => {
    const widths = committedWidths();
    expect(widths).toHaveLength(256);
    // character → its Windows-1252 byte
    const spots: [string, number][] = [["M", 0x4d], ["i", 0x69], ["0", 0x30], ["?", 0x3f], ["²", 0xb2], ["×", 0xd7], ["·", 0xb7], ["—", 0x97]];
    for (const [ch, byte] of spots) expect(widths[byte], ch).toBe(advanceOf(ch.codePointAt(0) ?? 0));
  });

  it("bytes with no character measure as \"?\"", () => {
    const widths = committedWidths();
    for (const byte of [0x00, 0x0a, 0x1f, 0x7f, 0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(widths[byte]).toBe(widths[0x3f]);
  });
});

describe("the generator's guards (render.22)", () => {
  /** A copy of the TTF with one u16 of a table changed. */
  function patched(tag: string, at: number, value: number): Uint8Array {
    const copy = new Uint8Array(TTF);
    const view = new DataView(copy.buffer);
    for (let i = 0, n = view.getUint16(4); i < n; i++) {
      const record = 12 + 16 * i;
      if (String.fromCharCode(...copy.subarray(record, record + 4)) === tag) {
        view.setUint16(view.getUint32(record + 8) + at, value);
        return copy;
      }
    }
    throw new Error(`no ${tag}`);
  }

  it("refuses a font that isn't 2048 units per em", () => {
    expect(() => interWidthsSource(patched("head", 18, 1000))).toThrow(/2048 units per em/);
  });

  it("refuses a font without a cmap it can read", () => {
    expect(() => interWidthsSource(patched("cmap", 2, 0))).toThrow(/cmap/); // no encoding records
  });
});
