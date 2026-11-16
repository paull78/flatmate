import type { Violation } from "./errors";
import { MESSAGES } from "./errors";
import { MIN_SECTION_LENGTH, SECTION_LETTERS, type Document } from "./model";

/** Float noise on a typed length: 0.7 − 0.2 is just under 0.5. */
const LENGTH_TOLERANCE = 1e-9;

/**
 * I25 (section.09): a section's id is one capital letter, its line is at least MIN_SECTION_LENGTH and its depth isn't
 * negative. It reads no other table, so an edit elsewhere can't make a section invalid.
 */
export function sectionViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.sections).sort()) {
    const row = doc.sections[id];
    if (!row) continue;
    const v = (message: string): void => void out.push({ invariant: "I25", message, entities: [{ table: "sections", id }] });
    if (id.length !== 1 || !SECTION_LETTERS.includes(id)) v(MESSAGES.sectionLetter);
    if (Math.hypot(row.b.x - row.a.x, row.b.y - row.a.y) < MIN_SECTION_LENGTH - LENGTH_TOLERANCE) v(MESSAGES.sectionLine);
    if (row.depth !== null && row.depth < 0) v(MESSAGES.sectionDepth);
  }
  return out;
}
