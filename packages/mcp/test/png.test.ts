import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng } from "../src/png";
import { pngPixels } from "./pictures";

// The PNG encoder look's 3D picture goes through (real3d.11, AC-15): decoded here by hand, chunk by chunk, with every
// CRC checked, so the test doesn't trust the encoder's own CRC table.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Uint8Array): number => (bytes.reduce((c, b) => (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

/** The RGBA pixels of a filter-0, 8-bit RGBA PNG, every chunk's CRC checked. */
export function decodePng(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (;;) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length), `${type} CRC`).toBe(crc(png.subarray(at + 4, at + 8 + length)));
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([...data.subarray(8, 13)]).toEqual([8, 6, 0, 0, 0]); // 8-bit RGBA, deflate, filter set 0, no interlace
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
    if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)], `row ${y} filter`).toBe(0);
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, pixels };
}

describe("encodePng", () => {
  const W = 37;
  const H = 23;
  const rgba = new Uint8Array(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));

  it("round-trips exactly, every CRC right, as 8-bit RGBA", () => {
    const back = decodePng(encodePng(W, H, rgba));
    expect([back.width, back.height]).toEqual([W, H]);
    expect([...back.pixels]).toEqual([...rgba]);
  });

  it("ends with the standard IEND chunk and decodes through resvg too", () => {
    const png = encodePng(W, H, rgba);
    expect([...png.subarray(png.length - 12)]).toEqual([0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82]);
    expect([...pngPixels(png).pixels]).toEqual([...rgba]);
  });
});
