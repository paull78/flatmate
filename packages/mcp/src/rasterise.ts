import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { INTER_FAMILY } from "@fm/editor";

// SVG to pixels with resvg (import.08, .12): the only module that imports the native renderer. Text draws in the
// editor's bundled Inter, the font look's widths come from (render.15); no system font is scanned.

/**
 * resvg's font options: the bundled Inter only, the fallback for any family the SVG names (Helvetica on paper styles).
 * Characters Inter lacks (CJK, emoji) draw as empty boxes in look; get_drawing gives the names as text.
 */
export const LOOK_FONTS = {
  fontFiles: [fileURLToPath(import.meta.resolve("@fm/editor/fonts/Inter-Regular.ttf"))],
  loadSystemFonts: false,
  defaultFontFamily: INTER_FAMILY,
};

/** A PNG of `svg` with its long side at `longSide` pixels; the short side follows the SVG's aspect. */
export function svgToPng(svg: string, longSide: number): Uint8Array {
  return render(svg, longSide).asPng();
}

/** The same render as RGBA pixels, row by row from the top-left. */
export function svgToPixels(svg: string, longSide: number): { width: number; height: number; pixels: Uint8Array } {
  const image = render(svg, longSide);
  return { width: image.width, height: image.height, pixels: image.pixels };
}

/**
 * Always fitted: toSvg sizes in millimetres, which resvg would render at 96 dpi. Fitted on the long side, because a
 * width rounded from a tall frame would leave the height a pixel off the target. The size probe parses without fonts.
 */
function render(svg: string, longSide: number): ReturnType<Resvg["render"]> {
  const probe = new Resvg(svg, { font: { loadSystemFonts: false } });
  const mode = probe.height > probe.width ? "height" : "width";
  return new Resvg(svg, { fitTo: { mode, value: longSide }, font: LOOK_FONTS }).render();
}
