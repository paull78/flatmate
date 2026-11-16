import type { Document, Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import { presentationStyle } from "../view/picture";
import type { Primitive } from "../view/scene-types";
import { text } from "./column";
import { MUTED, coverColumn, coverLogo, rectangle, type CoverColumn } from "./cover-column";
import { helveticaWidth } from "./helvetica";
import { INK, planInBox } from "./page-plan";
import type { Rect, Size } from "./paper";
import { wrapText } from "./wrap";

// A cover's page (sheetset.06; AC-08), as on the mockup: an accent band on the page's edge, a to-scale plan clipped to the
// left part with no border, its title and scale at the bottom left, and a tinted column on the right. In paper
// millimetres, y up.
//
//   |  +----------------+  +-----------+
//   |  |                |  |           |
//   |  |     plan       |  |  column   |
//   |  |                |  |           |
//   |  | TITLE          |  |           |
//   |  | scale 1:50     |  |           |
//   |  +----------------+  +-----------+
//   ^ the band

const COLUMN_SHARE = 0.41; // of the page's width, margin included
const BAND_MM = 2.5;
const AREA_LEFT = 14; // clear of the band
const AREA_GAP = 12; // from the area to the column
const AREA_MARGIN = 10; // above and below the plan
const COLUMN_MARGIN = 6;
const TAG_INSET = 2;
const TAG_PAD = 0.5;
const TITLE_SIZE = 4.2;
const SCALE_SIZE = 3.2;
const LEADING = 1.3;

/** Where a cover's parts go: the plan's frame is `area`. */
export function coverParts(page: Size): { band: Rect; area: Rect; column: Rect } {
  const share = page.w * COLUMN_SHARE;
  return {
    band: { x: 0, y: 0, w: BAND_MM, h: page.h },
    area: { x: AREA_LEFT, y: AREA_MARGIN, w: page.w - share - AREA_LEFT - AREA_GAP, h: page.h - 2 * AREA_MARGIN },
    column: { x: page.w - share, y: COLUMN_MARGIN, w: share - COLUMN_MARGIN, h: page.h - 2 * COLUMN_MARGIN },
  };
}

/** Two lines at the area's bottom left, on a white plate for a plan that reaches this corner. Outside the clip, and not counted by the fit (sheetset.27). */
function coverTag(title: string, scale: number, area: Rect): Primitive[] {
  const [titleLh, scaleLh] = [TITLE_SIZE * LEADING, SCALE_SIZE * LEADING];
  const x = area.x + TAG_INSET;
  const scaleLine = `scale 1:${scale}`;
  const [line] = wrapText(title.toUpperCase(), TITLE_SIZE, area.w - 2 * TAG_INSET, 1, "bold");
  const w = Math.max(helveticaWidth(line ?? "", TITLE_SIZE, "bold"), helveticaWidth(scaleLine, SCALE_SIZE));
  const plate: Rect = { x: x - TAG_PAD, y: area.y, w: w + 2 * TAG_PAD, h: titleLh + scaleLh };
  return [
    { kind: "polygon", points: rectangle(plate), holes: [], color: "#ffffff" },
    ...(line ? [text(line, x, area.y + scaleLh + titleLh / 2, TITLE_SIZE, INK, "left", "bold")] : []),
    text(scaleLine, x, area.y + scaleLh / 2, SCALE_SIZE, MUTED),
  ];
}

export type CoverOnPage = { drawing: { layout: string; level: Level } | null; title: string; scale: number; framing: Point; finishes: boolean; marks: boolean };

export function coverPage(doc: Document, page: Size, plan: CoverOnPage, column: CoverColumn): ExportPage {
  const { band, area, column: box } = coverParts(page);
  const picture = plan.drawing ? planInBox(doc, { ...plan.drawing, scale: plan.scale, framing: plan.framing, finishes: plan.finishes, marks: plan.marks }, area) : [];
  return {
    widthMm: page.w,
    heightMm: page.h,
    primitives: [...picture, { kind: "polygon", points: rectangle(band), holes: [], color: presentationStyle(doc).accent }, ...coverTag(plan.title, plan.scale, area), ...coverColumn(box, column)],
    clips: [{ rect: area, from: 0, to: picture.length }],
    ...(column.logo ? { images: [coverLogo(box, column.logo)] } : {}),
  };
}
