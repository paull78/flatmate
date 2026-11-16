import { useRef } from "react";
import type { SheetRow } from "@fm/editor";
import { PageCanvas, useOnScreen, type DrawPage } from "./SheetPage";

export const THUMB_WIDTH = 60; // CSS pixels, as on the mockup

export const thumbSize = (size: { widthMm: number; heightMm: number }, width: number) => ({ w: width, h: Math.round((width * size.heightMm) / size.widthMm) });

/** A small real picture of a sheet's first page (sheetset.13), built and drawn only while on screen, as a page is. */
export function SheetThumb({ sheet, size, drawPage }: { sheet: SheetRow; size: { widthMm: number; heightMm: number }; drawPage: DrawPage }) {
  const host = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(host);
  const page = onScreen ? (sheet.pages()[0] ?? null) : null;
  const css = thumbSize(page ?? size, THUMB_WIDTH);
  return (
    <div ref={host} className="sheets-thumb" style={{ width: css.w, height: css.h }}>
      <PageCanvas page={page} css={css} drawPage={drawPage} testId="sheet-thumb" />
    </div>
  );
}
