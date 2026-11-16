import { describe, expect, it } from "vitest";
import type { Primitive } from "@fm/editor";
import { FORMAT_VERSION, encodeLayer, readHeader } from "../src/index";

// readHeader refuses anything but this version of the render format (render.14): a reader never draws a layout it
// misreads.

const dot: Primitive = { kind: "disc", center: { x: 1, y: 2 }, radius: { px: 3 }, color: "#000000" };
/** A valid buffer with one header word changed. */
function withWord(index: number, value: number): ArrayBuffer {
  const buffer = encodeLayer([dot]);
  new DataView(buffer).setUint32(4 * index, value, true);
  return buffer;
}
const DISC_WORD = 2 + 3 * 3; // disc is the fourth kind: count, byteOffset, strideBytes

describe("readHeader", () => {
  it("reads a valid buffer", () => {
    expect(readHeader(encodeLayer([dot])).sections.disc.count).toBe(1);
  });

  it("refuses a short buffer, a bad magic and another version", () => {
    expect(() => readHeader(new ArrayBuffer(16))).toThrow(/too short/);
    expect(() => readHeader(withWord(0, 0x12345678))).toThrow(/bad magic/);
    expect(() => readHeader(withWord(1, FORMAT_VERSION + 1))).toThrow(/version/);
  });

  it("refuses a stride the layout table doesn't have", () => {
    expect(() => readHeader(withWord(DISC_WORD + 2, 36))).toThrow(/stride/);
  });

  it("refuses a section outside the buffer", () => {
    expect(() => readHeader(withWord(DISC_WORD, 1000))).toThrow(/outside/);
    expect(() => readHeader(withWord(DISC_WORD + 1, 58))).toThrow(/outside/); // not a multiple of 4
  });
});
