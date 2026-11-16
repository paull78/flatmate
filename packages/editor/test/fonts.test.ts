import { describe, expect, it } from "vitest";
import { helveticaWidth } from "../src/export/helvetica";
import { CHROME_FONT, FONT_FAMILY, INTER_FAMILY, fontMetrics, textWidth } from "../src/view/fonts";
import { INTER_ASCENT, INTER_DESCENT, INTER_UNITS_PER_EM, INTER_WIDTHS } from "../src/view/inter-widths";

const width = (ch: string): number => INTER_WIDTHS[ch.charCodeAt(0)] ?? NaN;

describe("fonts (render F · Fonts)", () => {
  it("Inter has 2048 units per em and a width for every Windows-1252 byte", () => {
    expect(INTER_UNITS_PER_EM).toBe(2048);
    expect(INTER_WIDTHS).toHaveLength(256);
  });

  it("textWidth sums advances", () => {
    expect(textWidth("inter", "00", 10)).toBe((2 * width("0") * 10) / 2048);
    expect(textWidth("inter", "", 10)).toBe(0);
    for (const s of ["Kitchen 8.64 m²", "3.20 × 4.10", "—", ""]) {
      expect(textWidth("helvetica", s, 12)).toBe(helveticaWidth(s, 12));
    }
  });

  it("a character outside Windows-1252 measures 1.25 em, in either font", () => {
    expect(textWidth("inter", "→", 10)).toBe(12.5);
    expect(textWidth("inter", "a→b", 10)).toBe(textWidth("inter", "a", 10) + 12.5 + textWidth("inter", "b", 10));
    expect(textWidth("helvetica", "a→b", 10)).toBe(helveticaWidth("a", 10) + 12.5 + helveticaWidth("b", 10));
    expect(textWidth("inter", "🛏️", 10)).toBe(25); // a code point and its variation selector
    // Ten CJK characters draw 122.5 px in Chromium's 12 px Inter fallback (render.28): the plate holds them.
    expect(textWidth("inter", "客厅卧室厨房浴室书房", 12)).toBeGreaterThan(122.5);
  });

  it("fontMetrics: ascent and descent in em", () => {
    const inter = fontMetrics("inter");
    expect(inter).toEqual({ ascent: INTER_ASCENT / 2048, descent: INTER_DESCENT / 2048 }); // generated from hhea
    expect(inter.ascent + inter.descent).toBeCloseTo(1.21, 2);
    const helvetica = fontMetrics("helvetica");
    expect(helvetica).toEqual({ ascent: 0.718, descent: 0.207 });
    expect(helvetica.ascent + helvetica.descent).toBeCloseTo(0.925, 9);
  });

  it("the chrome draws in Inter; Helvetica falls back to Arial", () => {
    expect(CHROME_FONT).toBe("inter");
    expect(FONT_FAMILY).toEqual({ inter: "Inter, sans-serif", helvetica: "Helvetica, Arial, sans-serif" }); // a fallback if the file fails
    expect(INTER_FAMILY).toBe("Inter");
  });
});
