import { assertNever } from "@fm/protocol";
import { unsupportedChars, toWinAnsi } from "../export/charset";
import { helveticaWidth } from "../export/helvetica";
import { INTER_ASCENT, INTER_DESCENT, INTER_UNITS_PER_EM, INTER_WIDTHS } from "./inter-widths";
import type { Font } from "./scene-types";

// The editor owns the fonts it lays text out with (render.15): which ones, their CSS families, and their metrics. The
// Inter file sits in packages/editor/fonts/, from which inter-widths.ts is generated.

/** Text drawn outside a plan style: presence names, helper, handle and distance labels. */
export const CHROME_FONT: Font = "inter";

/** The bundled font's family name: the web's FontFace and look's resvg register the file under it. */
export const INTER_FAMILY = "Inter";

/** The CSS family each font draws with: a generic fallback if the file fails to load. Arial shares Helvetica's widths. */
export const FONT_FAMILY: Record<Font, string> = { inter: `${INTER_FAMILY}, sans-serif`, helvetica: "Helvetica, Arial, sans-serif" };

/**
 * A character outside Windows-1252 (a CJK name, an emoji) has no entry in the tables but draws at its real width,
 * about 1 em for CJK in the browser: it measures as 1.25 em, so its plate is a little wide rather than too narrow.
 */
const UNSUPPORTED_EM = 1.25;

/** Ascent and descent above and below the baseline, in em: Inter's hhea, Helvetica's AFM. */
export function fontMetrics(font: Font): { ascent: number; descent: number } {
  switch (font) {
    case "inter":
      return { ascent: INTER_ASCENT / INTER_UNITS_PER_EM, descent: INTER_DESCENT / INTER_UNITS_PER_EM };
    case "helvetica":
      return { ascent: 0.718, descent: 0.207 };
    default:
      return assertNever(font);
  }
}

/** The width of a text at `size`, in the same unit as `size`, unkerned; UNSUPPORTED_EM for a character outside Windows-1252. */
export function textWidth(font: Font, text: string, size: number): number {
  if (unsupportedChars(text)) return Array.from(text, (ch) => (unsupportedChars(ch) ? UNSUPPORTED_EM * size : textWidth(font, ch, size))).reduce((a, b) => a + b, 0);
  switch (font) {
    case "inter":
      return (toWinAnsi(text).reduce((sum, b) => sum + (INTER_WIDTHS[b] ?? 0), 0) * size) / INTER_UNITS_PER_EM;
    case "helvetica":
      return helveticaWidth(text, size);
    default:
      return assertNever(font);
  }
}

/** A font at a size: what a label is measured and drawn with. */
export type TextStyle = { font: Font; size: number };

/** A room tag's size on the canvas, in screen px. */
export const TAG_SIZE = 12;
/** Helper, handle and distance labels on the canvas. */
export const HELPER_FONT: TextStyle = { font: CHROME_FONT, size: 11 };
