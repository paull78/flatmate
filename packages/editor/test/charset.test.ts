import { describe, expect, it } from "vitest";
import { toWinAnsi, unsupportedChars } from "../src/export/charset";

// Windows-1252 for the built-in Helvetica (export.16, AC-13).

describe("Windows-1252", () => {
  it("maps Latin-1 and the 0x80–0x9F extras, and anything else to ?", () => {
    expect(toWinAnsi("Cucina è")).toEqual([67, 117, 99, 105, 110, 97, 32, 0xe8]);
    expect(toWinAnsi("€ – ’")).toEqual([0x80, 32, 0x96, 32, 0x92]);
    expect(toWinAnsi("Κ😀")).toEqual([63, 63]); // one ? per character, an emoji included
  });

  it("unsupportedChars says whether a text has characters the PDF can't show", () => {
    expect(unsupportedChars("Κουζίνα")).toBe(true);
    expect(unsupportedChars("Cucina è · 4.20 × 3.10 m²")).toBe(false);
  });
});
