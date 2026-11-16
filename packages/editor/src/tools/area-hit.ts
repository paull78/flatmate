import { sortedIds, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { areaTagAt } from "../view/area-tags";

// Where a click finds a named area (areas.07, .16): its tag, in any tool that selects; its body only where a step says
// so: the Zone tool, where every outline shows, and the Select tool for the area already selected (a press drags it).

/** The area whose rectangle holds the point, borders included; areas don't overlap, so at most one but a shared side. */
export function areaAt(doc: Document, p: Point): string | null {
  for (const id of sortedIds(doc.areas)) {
    const a = doc.areas[id];
    if (a && Math.abs(p.x - a.at.x) <= a.w / 2 && Math.abs(p.y - a.at.y) <= a.d / 2) return id;
  }
  return null;
}

/** The Select tool's area hit after the pieces: a tag, else the selected area's body. */
export function selectAreaHit(doc: Document, p: Point, camera: Camera, layout: string | null, selection: readonly EntityRef[]): EntityRef | null {
  const tag = areaTagAt(doc, p, camera, layout);
  if (tag) return { table: "areas", id: tag };
  const body = areaAt(doc, p);
  return body !== null && selection.some((r) => r.table === "areas" && r.id === body) ? { table: "areas", id: body } : null;
}
