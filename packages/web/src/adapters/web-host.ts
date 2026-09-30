import type { FontSpec, Host } from "@fm/editor";

type TextMetricsResult = { width: number; ascent: number; descent: number };

/** CSS font shorthand; the Canvas2D renderer draws text with the same string (weight 400). */
export function fontString(font: FontSpec): string {
  return `${font.weight ?? 400} ${font.size}px ${font.family}`;
}

const MAX_CACHE = 2000;

/** Browser Host: synchronous queries only (spec §5.2). */
export function createWebHost(): Host {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (ctx === null) throw new Error("OffscreenCanvas 2D context unavailable");
  const cache = new Map<string, TextMetricsResult>();

  return {
    textMetrics(text: string, font: FontSpec): TextMetricsResult {
      const css = fontString(font);
      const key = `${css}|${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      ctx.font = css;
      const m = ctx.measureText(text);
      // Font-box metrics keep tag heights stable regardless of which glyphs a name contains.
      const result = { width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
      if (cache.size >= MAX_CACHE) cache.clear();
      cache.set(key, result);
      return result;
    },
    now: () => performance.now(),
    newId: () => crypto.randomUUID(),
  };
}
