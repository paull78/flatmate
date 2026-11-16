import { collisionMessage, rowWords, type Violation } from "./errors";
import { sortedIds } from "./graph";
import { CEILING_ID, EPS, FLOOR_BASE, type Document } from "./model";
import { ceilingAlong, wallRange } from "./queries/vertical";
import { metres, shown } from "./format";
import { MAX_HIGH_SIDE, MAX_OVERHANG, MAX_PITCH, MIN_PITCH, highSide, roofOf } from "./roof";

// The ceiling row and the wall rows' heights (heights.10, .11, I17). Like underlay.ts, its own module beside validate.ts.

export const MIN_CEILING = 1; // metres
export const MAX_CEILING = 10;
export const MIN_WALL_TOP = 0.1;

/**
 * I17: the one row is under CEILING_ID with a height of 1 to 10 m; every wall and column row is at least 0.10 m tall
 * from its base and reaches at most the ceiling along it, within the tolerance (pillars.23), read through wallRange. A
 * fixed top equal to the ceiling is what switching "To ceiling" off leaves: the wall keeps its height but stops following
 * the ceiling (heights.10, decks.56). A wall on the floor keeps its texts; any other row is named, with plain words.
 */
export function ceilingViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.ceilings).sort()) {
    const c = doc.ceilings[id];
    if (!c) continue;
    const v = (message: string): void => void out.push({ invariant: "I17", message, entities: [{ table: "ceilings", id }] });
    if (id !== CEILING_ID) v(`Ceiling ${id} must use the id ${CEILING_ID}`);
    if (!(c.height >= MIN_CEILING && c.height <= MAX_CEILING)) v(`The ceiling must be between ${metres(MIN_CEILING)} and ${metres(MAX_CEILING)} m`);
    if ((c.shape ?? "flat") === "flat") continue;
    const roof = roofOf(doc);
    if (!(roof.pitch >= MIN_PITCH && roof.pitch <= MAX_PITCH)) v(`The pitch must be between ${MIN_PITCH}° and ${MAX_PITCH}°`);
    if (!(roof.overhang >= 0 && roof.overhang <= MAX_OVERHANG)) v(`The overhang must be between ${metres(0)} and ${metres(MAX_OVERHANG)} m`);
    const high = highSide(doc);
    if (high > MAX_HIGH_SIDE + EPS) v(`The roof's high side is ${shown(high)} m; it must be at most ${metres(MAX_HIGH_SIDE)} m`);
  }
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const range = wallRange(doc, id);
    if (!w || !range) continue; // a missing deck is I21's
    const ceiling = ceilingAlong(doc, id);
    const floorWall = w.base === FLOOR_BASE && !w.column;
    const { name, kind } = rowWords(id, w.column);
    const v = (message: string, plain?: string): void => void out.push({ invariant: "I17", message, entities: [{ table: "walls", id }], ...(plain === undefined ? {} : { plain }) });
    const height = range.top - range.bottom;
    if (height < MIN_WALL_TOP - EPS) {
      if (floorWall) v(`A half wall must be at least ${metres(MIN_WALL_TOP)} m high`);
      else v(`${name} is ${shown(height)} m tall; a ${kind} is at least ${metres(MIN_WALL_TOP)} m tall`, `A ${kind} is at least ${metres(MIN_WALL_TOP)} m tall`);
    } else if (w.top !== "ceiling" && range.top > ceiling + EPS) { // a full wall rises to the ceiling by definition
      const reaches = `reaches ${shown(range.top)} m; the ceiling is ${shown(ceiling)} m`;
      if (floorWall) v(collisionMessage({ with: "halfWallCeiling", ceiling }));
      else v(`${name} ${reaches}`, `A ${kind} ${reaches}`);
    }
  }
  return out;
}
