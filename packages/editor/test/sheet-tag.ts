import type { SheetPage } from "../src/export/sheet";

/** The drawing's title and scale, as a page prints them on one line. */
export function sheetTag(page: SheetPage): string | undefined {
  return page.primitives.flatMap((p) => (p.kind === "text" && p.text.includes("scale 1:") ? [p.text] : []))[0];
}
