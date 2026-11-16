import { dimensionPoints, sortedIds, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { dimensionLayout, type DimensionLayout } from "./dimension-layout";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { Color, Primitive } from "./scene-types";

/** The Dimension tool's preview: a dimension not yet in the document. */
export type DimensionDraft = { a: Point; b: Point; offset: number };

/**
 * Placed dimensions (dims.19) in a plan style: every row in every layout (dims.03), selected ones in the style's
 * selected colour, then the tool's draft. Reused while its arguments are unchanged; `selectedKey` is an `idsKey`.
 */
export const dimensionsLayer = memoLast(
  (doc: Document, style: PlanStyle, zoom: number, selectedKey: string, draft: DimensionDraft | null): readonly Primitive[] => {
    const selected = idsOf(selectedKey);
    const out: Primitive[] = [];
    for (const id of sortedIds(doc.dimensions)) {
      const d = doc.dimensions[id];
      const points = d ? dimensionPoints(doc, d) : null; // null when an anchor's joint is gone
      const layout = d && points ? dimensionLayout(points.a, points.b, d.offset, style, zoom) : null;
      if (layout) out.push(...dimensionPrimitives(layout, style, selected.has(id) ? style.dim.selected : style.dim.ink));
    }
    const preview = draft ? dimensionLayout(draft.a, draft.b, draft.offset, style, zoom) : null;
    if (preview) out.push(...dimensionPrimitives(preview, style, style.dim.selected));
    return out;
  },
);

function dimensionPrimitives(l: DimensionLayout, style: PlanStyle, color: Color): Primitive[] {
  const seg = (a: Point, b: Point, px: number): Primitive => ({ kind: "segment", a, b, width: { px }, color, cap: "butt" });
  return [
    seg(l.line[0], l.line[1], style.dim.line),
    ...l.extensions.map(([a, b]) => seg(a, b, style.dim.line)),
    ...l.ticks.map(([a, b]) => seg(a, b, style.dim.tickWidth)),
    { kind: "text", text: l.text.value, at: l.text.at, size: style.dim.textSize, color, align: "center", rotation: l.text.rotation, font: style.font },
  ];
}
