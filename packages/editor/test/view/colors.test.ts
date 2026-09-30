import { describe, expect, it } from "vitest";
import { COLORS } from "../../src/view/colors";

function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb or #rrggbbaa colour: ${hex}`);
  return [parseInt(m[1] ?? "0", 16), parseInt(m[2] ?? "0", 16), parseInt(m[3] ?? "0", 16)];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("COLORS", () => {
  it("uses hex colours only, so renderers and tests can compare them", () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(() => channels(value), name).not.toThrow();
    }
  });

  it("keeps walls and text readable on the canvas background (WCAG contrast)", () => {
    expect(contrast(COLORS.wall, COLORS.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(COLORS.text, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.textMuted, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.helper, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.invalid, COLORS.background)).toBeGreaterThanOrEqual(3);
  });

  it("keeps invalid distinct from selection and preview", () => {
    const rgb = (c: string) => c.slice(0, 7).toLowerCase();
    expect(rgb(COLORS.invalid)).not.toBe(rgb(COLORS.wallSelected));
    expect(rgb(COLORS.invalid)).not.toBe(rgb(COLORS.preview));
  });
});
