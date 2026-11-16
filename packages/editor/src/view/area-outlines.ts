import { areaRing, sortedIds, type Document } from "@fm/domain";
import { COLORS } from "./colors";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import { ringEdges } from "./rings";
import type { Primitive } from "./scene-types";

// Named areas' outlines on screen only (areas.02): paper never draws them. While the Zone tool is out every area shows a
// faint dashed outline; a hovered one a thin blue line, a selected one a heavier blue line, in any tool.

/** Reused while its arguments are unchanged. `selected` is an `idsKey` of area IDs. */
export const areaOutlinesLayer = memoLast((doc: Document, style: PlanStyle, selected: string, hovered: string | null, zoneTool: boolean): readonly Primitive[] => {
  const picked = idsOf(selected);
  const { line, dash } = style.deck;
  return sortedIds(doc.areas).flatMap((id): Primitive[] => {
    const a = doc.areas[id];
    if (!a) return [];
    const ring = areaRing(a);
    if (picked.has(id)) return ringEdges(ring, COLORS.wallSelected, line.width + 1, "round");
    if (id === hovered) return ringEdges(ring, COLORS.wallSelected, line.width, "round");
    return zoneTool ? ringEdges(ring, COLORS.textMuted, line.width, "butt", dash) : [];
  });
});
