import { assertNever, deepEqual } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { flatDrawings, sheetDrawings, type Document, type Sheet, type SheetDrawing } from "../model";
import { isFloor, levelOf } from "../queries/levels";
import { orderedStates } from "../queries/states";

// Keeps stored sheets true when a layout, deck or section goes, in the same command (sheetset.02; AC-02). An automatic list has no
// rows and simply follows.

/** The deck a drawing keeps in `after`: its own, a sibling at its level (levels group decks by top), or undefined if none. */
function deckAfter(before: Document, after: Document, deck: string): string | null | undefined {
  if (after.decks[deck]) return deck;
  const level = levelOf(before, deck);
  return isFloor(level) ? null : level.deckIds.find((id) => after.decks[id]); // sunk below the cut, it already draws the floor
}

/** A pane as it survives, or null when its layout or level has gone. */
function kept(before: Document, after: Document, d: SheetDrawing): SheetDrawing | null {
  const deck = d.deck === null ? null : deckAfter(before, after, d.deck);
  return after.states[d.layout] && deck !== undefined ? { layout: d.layout, deck } : null;
}

/** The sheet once its drawings are gone or moved, or null to remove it. Order stays. */
function stripped(before: Document, after: Document, sheet: Sheet): Sheet | null {
  const old = sheetDrawings(sheet);
  switch (sheet.kind) {
    case "report":
      return sheet;
    case "cover": { // re-pointed, never removed: the first layout if its own has gone, the floor if its level has
      const d = old[0];
      if (!d) return sheet;
      const first = orderedStates(after)[0]?.id ?? d.layout;
      const deck = d.deck === null ? null : (deckAfter(before, after, d.deck) ?? null);
      return { ...sheet, drawings: flatDrawings([{ layout: after.states[d.layout] ? d.layout : first, deck }]) };
    }
    case "plan":
    case "compare": {
      const panes = old.flatMap((d) => kept(before, after, d) ?? []);
      if (panes.length === 0) return null;
      return { ...sheet, kind: panes.length === 1 ? "plan" : "compare", drawings: flatDrawings(panes) };
    }
    case "section": { // keeps its kind whatever's left, and goes with its section, as a plan goes with its layout
      if (sheet.section === null || !Object.hasOwn(after.sections, sheet.section)) return null;
      const panes = old.flatMap((d) => kept(before, after, d) ?? []);
      return panes.length === 0 ? null : { ...sheet, drawings: flatDrawings(panes) };
    }
    default:
      return assertNever(sheet.kind);
  }
}

/**
 * `after` with its rows true to what's left of `before`: a plan left with no drawing goes, a compare left with one becomes
 * a plan. Adds each row it writes to `deps`. A delete that empties the list returns it to automatic.
 */
export function sheetsInStep(before: Document, after: Document, deps: EntityKey[]): Document {
  const sheets: Record<string, Sheet> = {};
  for (const sheet of Object.values(after.sheets)) {
    const next = stripped(before, after, sheet);
    const same = deepEqual(next, sheet);
    if (!same) deps.push({ table: "sheets", id: sheet.id });
    if (next) sheets[sheet.id] = same ? sheet : next;
  }
  return { ...after, sheets };
}
