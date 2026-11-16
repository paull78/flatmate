import type { Violation } from "./errors";
import { MESSAGES } from "./errors";
import { MIN_AREA_SIZE, type Area, type Document } from "./model";

// I26 (areas.09, .20): a named area is at least MIN_AREA_SIZE a side, and no two areas overlap; touching is fine. It reads
// no other table, so a wall edit can't break it (areas.04).

/** Overlap within this much is touching: rows are kept to the millimetre. */
const TOUCH = 1e-6;

/** An area's name in a text: a blank one still reads. */
export const areaName = (area: Pick<Area, "name">): string => (area.name.trim() === "" ? "Area" : area.name);

const sized = (a: Area): boolean => a.w >= MIN_AREA_SIZE - TOUCH && a.d >= MIN_AREA_SIZE - TOUCH;

/** Whether two areas' rectangles share more than a side. */
export function areasOverlap(a: Area, b: Area): boolean {
  const gapX = Math.abs(a.at.x - b.at.x) - (a.w + b.w) / 2;
  const gapY = Math.abs(a.at.y - b.at.y) - (a.d + b.d) / 2;
  return gapX < -TOUCH && gapY < -TOUCH;
}

/** I26 for every area by ID: its size, then each overlapping pair once, under the lower ID, naming both. */
export function areaViolations(doc: Document): Violation[] {
  const areas = Object.keys(doc.areas).sort().flatMap((id) => doc.areas[id] ?? []);
  const out: Violation[] = [];
  areas.forEach((area, i) => {
    const own = { table: "areas" as const, id: area.id };
    if (!sized(area)) return void out.push({ invariant: "I26", message: MESSAGES.areaSize, entities: [own] });
    for (const other of areas.slice(i + 1)) {
      if (sized(other) && areasOverlap(area, other)) {
        out.push({ invariant: "I26", message: MESSAGES.areasOverlap(areaName(area), areaName(other)), entities: [own, { table: "areas", id: other.id }] });
      }
    }
  });
  return out;
}
