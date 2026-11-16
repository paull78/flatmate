import type { Sheet } from "@fm/domain";
import type { ExportPage } from "../ports/effects";
import type { Primitive } from "../view/scene-types";
import { frame, type PageParts } from "./page-plan";
import type { Rect } from "./paper";
import { flowReport, type ReportFlow } from "./report-flow";

// A report sheet's pages (sheetset.05, .08; AC-09): its text in the frame, each page with its own title block column, whose
// number is the only thing that differs.

/** By row, as a row changes only with its own text or size; numbering reads it for every report on every document. */
const flows = new WeakMap<Sheet, Map<string, ReportFlow>>();

export function reportFlow(sheet: Sheet, area: Rect): ReportFlow {
  const key = `${area.w} ${area.h}`;
  const known = flows.get(sheet)?.get(key);
  if (known) return known;
  const flow = flowReport(sheet.text, sheet.size, area);
  const forSheet = flows.get(sheet) ?? new Map<string, ReportFlow>();
  forSheet.set(key, flow);
  flows.set(sheet, forSheet);
  return flow;
}

export function reportPages(parts: PageParts, flow: ReportFlow, titleBlock: (page: number) => readonly Primitive[]): ExportPage[] {
  return flow.pages.map((text, i) => ({ widthMm: parts.page.w, heightMm: parts.page.h, primitives: [...text, ...frame(parts), ...titleBlock(i)] }));
}
