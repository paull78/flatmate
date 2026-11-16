import { describe, expect, it } from "vitest";
import { helveticaWidth } from "../src/export/helvetica";
import { wrapText } from "../src/export/wrap";

// Wrapping for the sheet's title block column (sheet.05, .14; AC-05): measured in Helvetica, the PDF's font, so the
// lines fit on paper whichever shell built the sheet.

const W = 54; // the 60 mm column's inner width at 3 mm padding
const fits = (lines: string[], size = 2.5, width = W) => lines.every((l) => helveticaWidth(l, size) <= width + 1e-9);

describe("wrapText", () => {
  it("keeps a short value on one line", () => {
    expect(wrapText("Rossi", 2.5, W, 2)).toEqual(["Rossi"]);
  });

  it("breaks at spaces, every line within the width", () => {
    const address = "Via Giuseppe Garibaldi 128, scala B, interno 14, 20121 Milano";
    const lines = wrapText(address, 2.5, W, 2);
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toBe(address);
    expect(fits(lines)).toBe(true);
  });

  it("ends the last allowed line with an ellipsis when the text needs more lines", () => {
    const long = "word ".repeat(60).trim();
    const lines = wrapText(long, 2.5, W, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(fits(lines)).toBe(true);
  });

  it("splits a word longer than the width inside the word", () => {
    const word = "Supercalifragilisticexpialidocious".repeat(2);
    const lines = wrapText(word, 2.5, W, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(word);
    expect(fits(lines)).toBe(true);
  });

  it("honours line breaks (the notes)", () => {
    expect(wrapText("a\nb", 2.5, W, 8)).toEqual(["a", "b"]);
    expect(wrapText("a\n\nb", 2.5, W, 8)).toEqual(["a", "", "b"]);
  });

  it("an ellipsis also marks lines cut by a line break past the limit", () => {
    expect(wrapText("one\ntwo\nthree", 2.5, W, 2)).toEqual(["one", "two…"]);
  });

  it("gives no lines for an empty text", () => {
    expect(wrapText("", 2.5, W, 2)).toEqual([]);
  });
});
