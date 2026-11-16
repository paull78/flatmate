import { shown } from "@fm/domain";

/** "4.20 m²": an area as every plan label writes it. A leaf, so deck-label.ts can use it without the tags (an import cycle). */
export function formatArea(area: number): string {
  return `${shown(area)} m²`;
}
