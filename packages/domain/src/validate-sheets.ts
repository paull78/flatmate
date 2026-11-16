import { assertNever, deepEqual } from "@fm/protocol";
import type { Violation } from "./errors";
import { MAX_SHEET_TEXT, SCALE_REFUSAL, SHEET_SCALES, flatDrawings, sheetDrawings, type Document, type Sheet, type SheetKind } from "./model";

// I23, a sheet's own rules (sheetset.01, .11), beside validate.ts as decks.ts is. Each row is checked alone, so two clients
// editing different sheets can't break each other's. The texts are the refusals' too.

/** Why a sheet of this kind can't hold this many drawings, or null. */
export function sheetKindProblem(kind: SheetKind, count: number): string | null {
  switch (kind) {
    case "plan": return count === 1 ? null : "A plan sheet holds one drawing";
    case "compare": return count >= 2 && count <= 4 ? null : "A compare sheet holds 2 to 4 drawings";
    case "cover": return count === 1 ? null : "A cover holds one drawing";
    case "report": return count === 0 ? null : "A report holds no drawing";
    case "section": return count >= 1 && count <= 4 ? null : "A section sheet holds 1 to 4 layouts";
    default: return assertNever(kind);
  }
}

/** Why a row's section breaks I23: the letter belongs on a Section sheet and names a row, and that sheet draws no level (section.10). */
function sectionProblem(doc: Document, sheet: Sheet): string | null {
  if (sheet.kind !== "section") return sheet.section === null ? null : "Only a section sheet names a section";
  if (sheet.section === null) return "A section sheet names a section";
  if (!Object.hasOwn(doc.sections, sheet.section)) return "Section not found";
  return sheetDrawings(sheet).some((d) => d.deck !== null) ? "A section sheet draws layouts, not levels" : null;
}

/** Why a well-formed row breaks I23, or null. A deck sunk below the cut is fine: `levelOf` draws the floor there. */
export function sheetProblem(doc: Document, sheet: Sheet): string | null {
  const drawings = sheetDrawings(sheet);
  const count = sheetKindProblem(sheet.kind, drawings.length);
  if (count) return count;
  if (!deepEqual(flatDrawings(drawings), sheet.drawings)) return "A sheet's drawings run in order, with no gaps";
  const section = sectionProblem(doc, sheet);
  if (section) return section;
  if (sheet.scale !== null && !SHEET_SCALES.some((s) => s === sheet.scale)) return SCALE_REFUSAL;
  if (sheet.text.length > MAX_SHEET_TEXT) return "A report's text can be at most 20,000 characters";
  for (const { layout, deck } of drawings) {
    if (!doc.states[layout]) return "Layout not found";
    if (deck !== null && !doc.decks[deck]) return "Deck not found";
  }
  return null;
}

/** I23 for every row, by ID. */
export function sheetViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.sheets).sort()) {
    const sheet = doc.sheets[id];
    const problem = sheet ? sheetProblem(doc, sheet) : null;
    if (problem) out.push({ invariant: "I23", message: `Sheet ${id}: ${problem}`, plain: problem, entities: [{ table: "sheets", id }] });
  }
  return out;
}
