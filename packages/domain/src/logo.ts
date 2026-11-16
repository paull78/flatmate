import { LOGO_LONG_SIDE, MAX_LOGO_DATA_CHARS } from "@fm/protocol";
import type { Violation } from "./errors";
import { LOGO_ID, type Document, type Logo } from "./model";

// The studio's logo (sheetset.18, .21; AC-13), on the underlay's model (import.16). Its own module for the reason
// underlay.ts has one: it must not import validate.ts.

const JPEG_START = "/9j/"; // FF D8 FF in base64: the writer passes these bytes into a PDF as they are

const isPixels = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= LOGO_LONG_SIDE;

/** The project's logo, or null. */
export function logoOf(doc: Document): Logo | null {
  return doc.logos[LOGO_ID] ?? null;
}

/**
 * I24: the one row is under LOGO_ID; a JPEG by its first bytes, its data within the cap, whole pixels within the long
 * side. Constant time, since it runs on every command: it measures the data and never decodes it. Messages name the row's
 * id only, or its bytes would reach MCP replies and logs.
 */
export function logoViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.logos).sort()) {
    const row = doc.logos[id];
    if (!row) continue;
    const v = (what: string): void => void out.push({ invariant: "I24", message: `Logo ${id} ${what}`, entities: [{ table: "logos", id }] });
    if (id !== LOGO_ID) v(`must use the id ${LOGO_ID}`);
    if (row.data.length === 0 || row.data.length > MAX_LOGO_DATA_CHARS) v(`data must be 1 to ${MAX_LOGO_DATA_CHARS} characters`);
    else if (!row.data.startsWith(JPEG_START)) v("must be a JPEG");
    if (!isPixels(row.width) || !isPixels(row.height)) v(`size must be whole pixels from 1 to ${LOGO_LONG_SIDE}`);
  }
  return out;
}
