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

/** Channel-max distance, as the e2e pixel probes measure (packages/web/e2e/support/pixels.ts). */
function distance(a: string, b: string): number {
  const ca = channels(a);
  const cb = channels(b);
  return Math.max(...ca.map((c, i) => Math.abs(c - (cb[i] ?? 0))));
}

/** A #rrggbbaa colour composited over an opaque one, by its alpha byte, as #rrggbb. */
function over(top: string, base: string): string {
  const a = parseInt(top.slice(7, 9) || "ff", 16) / 255;
  const b = channels(base);
  return `#${channels(top).map((c, i) => Math.round(c * a + (b[i] ?? 0) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}

describe("COLORS", () => {
  it("uses hex colours only, so renderers and tests can compare them", () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(() => channels(value), name).not.toThrow();
    }
  });

  it("keeps walls and text readable on the canvas background (WCAG contrast)", () => {
    expect(contrast(COLORS.wall, COLORS.background)).toBeGreaterThanOrEqual(3); // state graphics, WCAG 1.4.11
    expect(contrast(COLORS.ink, COLORS.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(COLORS.ink, COLORS.wall)).toBeGreaterThanOrEqual(3); // what's drawn on a wall reads against it
    expect(contrast(COLORS.text, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.textMuted, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.helper, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.invalid, COLORS.background)).toBeGreaterThanOrEqual(3);
  });

  it("the furniture fill stays distinct where pixel probes and the eye need it", () => {
    expect(distance(COLORS.object, COLORS.background)).toBeGreaterThanOrEqual(20);
    expect(distance(COLORS.object, COLORS.openingFloor)).toBeGreaterThanOrEqual(20); // the room floor
    expect(distance(COLORS.object, COLORS.objectSelected)).toBeGreaterThanOrEqual(24);
    expect(distance(over(COLORS.ghostFill, COLORS.background), COLORS.background)).toBeGreaterThanOrEqual(16);
    expect(contrast(COLORS.objectEdge, COLORS.object)).toBeGreaterThanOrEqual(3);
    // Colour-filtered tests (boxes(shell, COLORS.ghostFill), the zone outlines and chips) must pick their marks only.
    const furniture = {
      object: COLORS.object, objectEdge: COLORS.objectEdge, ghostFill: COLORS.ghostFill, ghostEdge: COLORS.ghostEdge,
      zoneOutline: COLORS.zoneOutline, chip: COLORS.chip, chipOff: COLORS.chipOff, chipOffHover: COLORS.chipOffHover,
    };
    for (const [name, value] of Object.entries(furniture)) {
      for (const [other, v] of Object.entries(COLORS)) if (other !== name) expect(v.toLowerCase(), `${name} vs ${other}`).not.toBe(value.toLowerCase());
    }
  });

  it("the \"+\" chip is lighter than the \"×\" chip until hovered (AC-11)", () => {
    expect(luminance(COLORS.chipOff)).toBeGreaterThan(luminance(COLORS.chip));
    expect(luminance(COLORS.chipOffHover)).toBeLessThan(luminance(COLORS.chipOff));
    expect(contrast(COLORS.chipOffHover, COLORS.handle)).toBeGreaterThanOrEqual(4.5); // the hovered glyph on its white disc
  });

  it("keeps invalid distinct from selection and preview", () => {
    const rgb = (c: string) => c.slice(0, 7).toLowerCase();
    expect(rgb(COLORS.invalid)).not.toBe(rgb(COLORS.wallSelected));
    expect(rgb(COLORS.invalid)).not.toBe(rgb(COLORS.preview));
  });
});
