import { add, distance, distanceToSegment, length, normalize, perpLeft, scale, sectionsOf, sub, type Document, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "./colors";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { Color, Primitive } from "./scene-types";

const NONE: readonly Primitive[] = []; // one array whatever the document: the GPU encoder skips a layer by its identity

/**
 * Sections on the plan (ISO 128-3): a thin dashed line between thick ends, an arrow at each end pointing at what the
 * section sees, and the letter past each end. Every row, in every layout and at every level, selected ones in the style's
 * selected colour and, under the marks, with their band; with `onlySelected`, the viewer's switch being off (section.59), just
 * those. Reused while its arguments are unchanged; `selectedKey` is an `idsKey`.
 *
 *   A  ▬▬▬ ─ ─ ─ ─ ─ ─ ▬▬▬  A
 *       |               |
 *       ▼               ▼
 */
export const sectionMarksLayer = memoLast((doc: Document, style: PlanStyle, zoom: number, selectedKey: string, onlySelected: boolean): readonly Primitive[] => {
  const selected = idsOf(selectedKey);
  const rows = sectionsOf(doc).filter((row) => !onlySelected || selected.has(row.id));
  if (rows.length === 0) return NONE;
  const bands = rows.flatMap((row) => (selected.has(row.id) ? sectionBand(row) : []));
  return [...bands, ...rows.flatMap((row) => sectionMark(row, style, zoom, selected.has(row.id) ? style.mark.selected : style.mark.ink))];
});

/** What a limited depth keeps: the strip from the cut to the far line. Whole and Zero have none to shade. */
function sectionBand(row: Section): Primitive[] {
  const axes = markAxes(row);
  if (!axes || row.depth === null || row.depth === 0) return [];
  const far = scale(axes.seen, row.depth);
  return [{ kind: "polygon", points: [row.a, row.b, add(row.b, far), add(row.a, far)], holes: [], color: COLORS.sectionBand }];
}

/** The line's direction and the side it looks at; null for a line with no length, which only a preview can have (I25). */
export function markAxes(row: Section): { u: Point; seen: Point } | null {
  const u = normalize(sub(row.b, row.a));
  return u && { u, seen: scale(perpLeft(u), row.side) };
}

/** How far `p` lies from a row's nearer arrow, in metres. */
export function distanceToArrows(row: Section, mark: PlanStyle["mark"], zoom: number, p: Point): number {
  const axes = markAxes(row);
  if (!axes) return Number.POSITIVE_INFINITY;
  const arrow = (at: Point): number => distanceToSegment(p, at, add(at, scale(axes.seen, (mark.stem + mark.head) / zoom)));
  return Math.min(arrow(row.a), arrow(row.b));
}

/** How far `p` lies from what a row's mark draws, in metres: its line, its arrows, or inside the round of a letter. */
export function distanceToMark(row: Section, mark: PlanStyle["mark"], zoom: number, p: Point): number {
  const axes = markAxes(row);
  if (!axes) return Number.POSITIVE_INFINITY;
  const letter = (at: Point, outward: Point): number => Math.max(0, distance(p, add(at, scale(outward, mark.textGap / zoom))) - mark.textSize / 2 / zoom);
  return Math.min(distanceToSegment(p, row.a, row.b), distanceToArrows(row, mark, zoom, p), letter(row.a, scale(axes.u, -1)), letter(row.b, axes.u));
}

/** One section's mark; the Section tool previews with this too, on a row not yet in the document. */
export function sectionMark(row: Section, style: PlanStyle, zoom: number, color: Color): Primitive[] {
  const { mark } = style;
  const { a, b } = row;
  const axes = markAxes(row);
  if (!axes) return [];
  const { u, seen } = axes;
  const len = length(sub(b, a));
  const thick = Math.min(mark.end / zoom, len / 2); // a short line at a low zoom is all ends
  const line = (from: Point, to: Point, px: number): Extract<Primitive, { kind: "segment" }> => ({ kind: "segment", a: from, b: to, width: { px }, color, cap: "butt" });
  const inner: [Point, Point] = [add(a, scale(u, thick)), sub(b, scale(u, thick))];
  const thin = len > 2 * thick ? [{ ...line(inner[0], inner[1], mark.line), dash: mark.dash }] : [];

  const end = (at: Point, inward: Point, outward: Point): Primitive[] => {
    const base = add(at, scale(seen, mark.stem / zoom));
    const halfHead = scale(u, mark.headHalf / zoom);
    return [
      line(at, inward, mark.thick),
      line(at, base, mark.stemWidth),
      { kind: "polygon", points: [add(base, scale(seen, mark.head / zoom)), add(base, halfHead), sub(base, halfHead)], holes: [], color },
      { kind: "text", text: row.id, at: add(at, scale(outward, mark.textGap / zoom)), size: mark.textSize, color, align: "center", rotation: 0, font: style.font },
    ];
  };
  return [...thin, ...end(a, inner[0], scale(u, -1)), ...end(b, inner[1], u)];
}
