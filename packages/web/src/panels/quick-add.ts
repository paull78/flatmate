import { isFurnitureSet, type Mods, type PaletteResult, type UiAction } from "@fm/editor";

// Quick add's keys (quick-add.06, .07): what a key in the field does, as plain data so tests need no DOM.

/** The field's own state: the text typed and the highlighted row. */
export type QuickAddState = { text: string; highlight: number };
/** What the key asks for besides the new state: arm the highlighted row, or give up the focus. */
export type QuickAddOutcome = { state: QuickAddState; pick: number | null; blur: boolean; handled: boolean };

export const EMPTY_QUICK_ADD: QuickAddState = { text: "", highlight: 0 };
/** The most rows shown; more read "+N more · keep typing" (Baymard: no scrollbar in the list). */
export const QUICK_ADD_ROWS = 8;

/**
 * A key in the field with `count` rows shown: ↓ and ↑ move and wrap, Enter picks the highlighted row (and clears),
 * Escape clears the text or, with none, gives up the focus. Other keys are the input's own (`handled` false).
 */
export function quickAddKey(state: QuickAddState, key: string, count: number): QuickAddOutcome {
  const same = { state, pick: null, blur: false, handled: true };
  switch (key) {
    case "ArrowDown":
      return count === 0 ? same : { ...same, state: { ...state, highlight: (state.highlight + 1) % count } };
    case "ArrowUp":
      return count === 0 ? same : { ...same, state: { ...state, highlight: (state.highlight - 1 + count) % count } };
    case "Enter":
      return count === 0 ? same : { state: EMPTY_QUICK_ADD, pick: Math.min(state.highlight, count - 1), blur: true, handled: true };
    case "Escape":
      return state.text === "" ? { ...same, blur: true } : { ...same, state: EMPTY_QUICK_ADD };
    default:
      return { ...same, handled: false };
  }
}

/** New text: the highlight goes back to the first row. */
export function quickAddText(text: string): QuickAddState {
  return { text, highlight: 0 };
}

/** The actions a pick sends: arm the kind, and its preset when the row shows one (the size picker then reads it). */
export function pickActions(row: PaletteResult): UiAction[] {
  if (isFurnitureSet(row.kind)) return [{ type: "pickSet", set: row.kind }];
  const arm: UiAction = { type: "pickKind", kind: row.kind };
  return row.preset === null ? [arm] : [arm, { type: "pickPreset", kind: row.kind, preset: row.preset }];
}

/**
 * Whether a key is quick add's shortcut: "/" alone, or Ctrl or ⌘ with K, when the key isn't aimed at a field (a panel
 * input, or the value input that holds a typed length, tidy.14).
 */
export function isQuickAddShortcut(key: string, mods: Mods, editable: boolean, typingValue: boolean): boolean {
  if (editable || typingValue) return false;
  if (key === "/") return !mods.ctrl && !mods.meta && !mods.alt;
  return key.toLowerCase() === "k" && (mods.ctrl || mods.meta) && !mods.alt && !mods.shift;
}

/**
 * The rows the field offers: the search's, or with text and no match the Custom box alone, flagged so the field says
 * nothing matches (quick-add.08). `customLabel` is the palette's label for the Custom box.
 */
export function withFallback(rows: readonly PaletteResult[], text: string, customLabel: string): { rows: readonly PaletteResult[]; noMatch: boolean } {
  if (rows.length > 0 || text.trim() === "") return { rows, noMatch: false };
  return { rows: [{ kind: "block", label: customLabel, group: "Basic", tier: 0, matched: [], detail: null, preset: null }], noMatch: true };
}
