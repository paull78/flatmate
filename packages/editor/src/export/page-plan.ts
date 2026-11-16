import type { Document, Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import { pictureLayers, planPicture, presentationStyle } from "../view/picture";
import { paperView } from "../view/plan-view";
import type { Color, Primitive } from "../view/scene-types";
import { helveticaWidth } from "./helvetica";
import type { Rect, Size } from "./paper";
import { toPage } from "./to-page";
import { wrapText } from "./wrap";

// One page of a sheet set: what's on it in drawing order, its plan clipped to the frame (sheetset.17), then the title and
// scale at the drawing's bottom left (sheetset.19), the frame and the column. In paper millimetres, y up.

/** Where a page's parts go: the paper, the drawing area and the title block column, which share a vertical edge. */
export type PageParts = { page: Size; area: Rect; column: Rect };

export type PlanOnPage = { layout: string; level: Level; title: string; scale: number; framing: Point; finishes: boolean; marks: boolean };

export const INK = "#1a1a1a";
const FRAME_MM = 0.35;
const TAG_SIZE = 3.6;
const TAG_INSET = 2; // from the frame's left and bottom edges
const TAG_PAD = 1;

/** A framed page with nothing in its drawing area. */
export function blankPage(parts: PageParts, titleBlock: readonly Primitive[]): ExportPage {
  return { widthMm: parts.page.w, heightMm: parts.page.h, primitives: [...frame(parts), ...titleBlock] };
}

/** The plan on paper, centred on `framing` in `box`, for the page to clip to it. */
export function planInBox(doc: Document, plan: Omit<PlanOnPage, "title">, box: Rect): Primitive[] {
  const k = 1000 / plan.scale; // paper millimetres per metre
  const dx = box.x + box.w / 2 - plan.framing.x * k;
  const dy = box.y + box.h / 2 - plan.framing.y * k;
  const picture = planPicture(doc, paperView(plan.layout, plan.level), presentationStyle(doc), k, plan.finishes);
  return pictureLayers(plan.marks ? picture : { ...picture, marks: [] }).map((p) => toPage(p, k, dx, dy));
}

/** A framed page holding a plan centred on `framing`, whatever part of it the frame shows. */
export function planPage(doc: Document, parts: PageParts, plan: PlanOnPage, titleBlock: readonly Primitive[]): ExportPage {
  const { area } = parts;
  const picture = planInBox(doc, plan, area);
  return {
    widthMm: parts.page.w,
    heightMm: parts.page.h,
    primitives: [...picture, ...titleTag(plan.title, plan.scale, area, presentationStyle(doc).accent), ...frame(parts), ...titleBlock],
    clips: [{ rect: area, from: 0, to: picture.length }],
  };
}

/** One line of the frame, or of a seam between its panes. */
export const edge = (a: Point, b: Point): Primitive => ({ kind: "segment", a, b, width: { px: FRAME_MM }, color: INK, cap: "round" });

/** "DAY  ·  scale 1:50" on a white plate, underlined in the accent as in the mockup. The plate keeps it legible over a plan that reaches this corner. */
export function titleTag(title: string, scale: number, area: Rect, accent: Color): Primitive[] {
  const suffix = `scale 1:${scale}`;
  const separator = "  ·  ";
  const room = area.w - 2 * (TAG_INSET + TAG_PAD) - helveticaWidth(separator + suffix, TAG_SIZE);
  const cut = wrapText(title.toUpperCase(), TAG_SIZE, room, 1)[0];
  const line = cut ? `${cut}${separator}${suffix}` : suffix;
  const x = area.x + TAG_INSET;
  const y = area.y + TAG_INSET;
  const w = helveticaWidth(line, TAG_SIZE) + 2 * TAG_PAD;
  const h = TAG_SIZE + 2 * TAG_PAD;
  return [
    { kind: "polygon", points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [], color: "#ffffff" },
    { kind: "segment", a: { x, y }, b: { x: x + w, y }, width: { px: 0.5 }, color: accent, cap: "butt" },
    { kind: "text", text: line, at: { x: x + TAG_PAD, y: y + h / 2 }, size: TAG_SIZE, color: INK, align: "left", rotation: 0, font: "helvetica" },
  ];
}

/** One solid frame, its area and column sharing a vertical edge with no gap (sheetset.08). Round caps close the corners. */
export function frame({ area, column }: PageParts): Primitive[] {
  const [l, b, r, t] = [area.x, area.y, column.x + column.w, area.y + area.h];
  return [
    edge({ x: l, y: b }, { x: r, y: b }),
    edge({ x: r, y: b }, { x: r, y: t }),
    edge({ x: r, y: t }, { x: l, y: t }),
    edge({ x: l, y: t }, { x: l, y: b }),
    edge({ x: column.x, y: b }, { x: column.x, y: t }),
  ];
}
