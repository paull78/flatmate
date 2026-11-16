import type { Logo } from "@fm/domain";
import type { PageImage } from "../ports/effects";
import type { Size } from "./paper";

// The studio's logo on paper (sheetset.21): as large as its box lets it, keeping its shape, whatever its pixels.

export function logoSize(logo: Pick<Logo, "width" | "height">, maxW: number, maxH: number): Size {
  const k = Math.min(maxW / logo.width, maxH / logo.height);
  return { w: logo.width * k, h: logo.height * k };
}

/** The logo with its top-left at (x, top), millimetres, y up. */
export function logoImage(logo: Logo, x: number, top: number, maxW: number, maxH: number): PageImage {
  const { w, h } = logoSize(logo, maxW, maxH);
  return { rect: { x, y: top - h, w, h }, jpeg: logo.data };
}
