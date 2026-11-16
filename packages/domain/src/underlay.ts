import { MAX_UNDERLAY_DATA_CHARS, UNDERLAY_LONG_SIDE } from "@fm/protocol";
import type { Violation } from "./errors";
import type { Box } from "./geometry";
import { UNDERLAY_ID, UNDERLAY_MIME, type Document, type Underlay } from "./model";

// The plan underlay (import.11, .16). Its own module because validate.ts is near the domain's size limit; it must not
// import validate.ts (the cycle would run through validateDocument).

const rectOf = (u: Underlay): Box =>
  ({ minX: u.at.x, maxY: u.at.y, maxX: u.at.x + u.width * u.metresPerPixel, minY: u.at.y - u.height * u.metresPerPixel });

/** The underlay's rectangle in plan metres (y up), or null without one: `at` is its top-left corner (import.11). */
export function underlayRect(doc: Document): Box | null {
  const u = doc.underlays[UNDERLAY_ID];
  return u ? rectOf(u) : null;
}

/** The row's rectangle is finite with positive width and height, so a view framed on it has a finite zoom. */
export function coversArea(u: Underlay): boolean {
  const r = rectOf(u);
  return [r.minX, r.minY, r.maxX, r.maxY].every(Number.isFinite) && r.maxX > r.minX && r.maxY > r.minY;
}

const isPixels = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= UNDERLAY_LONG_SIDE;

/**
 * I16 (import.16): the one row is under UNDERLAY_ID, so a project never holds two; a JPEG with data within the cap,
 * whole pixels within the long side, a positive scale and a finite position that together cover a finite, non-empty
 * rectangle (an underflowing scale or a huge position would not). Constant time: it measures the data and never
 * decodes it. Messages name the row's id only: row values would reach MCP replies and logs (AC-10).
 */
export function underlayViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.underlays).sort()) {
    const u = doc.underlays[id];
    if (!u) continue;
    const v = (what: string): void => void out.push({ invariant: "I16", message: `Underlay ${id} ${what}`, entities: [{ table: "underlays", id }] });
    if (id !== UNDERLAY_ID) v(`must use the id ${UNDERLAY_ID}`);
    if (u.mime !== UNDERLAY_MIME) v("must be a JPEG");
    if (u.data.length === 0 || u.data.length > MAX_UNDERLAY_DATA_CHARS) v(`data must be 1 to ${MAX_UNDERLAY_DATA_CHARS} characters`);
    const pixels = isPixels(u.width) && isPixels(u.height);
    const scale = Number.isFinite(u.metresPerPixel) && u.metresPerPixel > 0;
    const position = Number.isFinite(u.at.x) && Number.isFinite(u.at.y);
    if (!pixels) v(`size must be whole pixels from 1 to ${UNDERLAY_LONG_SIDE}`);
    if (!scale) v("scale must be more than 0");
    if (!position) v("position must be finite");
    if (pixels && scale && position && !coversArea(u)) v("must cover a finite, non-empty area");
  }
  return out;
}
