// The one key guard every native dropdown shares (surroundings.27, snags.06): the surroundings menu, the size picker and
// Properties' dropdowns.
//
// A select that keeps the focus (after a close with no change, or after a pick where it doesn't blur) gets the keys
// meant for the plan, as the window key listener drops keys aimed at a SELECT: a typed letter (O for Object) picks an
// option by type-ahead, and on Windows and Linux an arrow meant to nudge picks the next one. Either can be a shared edit
// of the drawing. Those keys pick nothing and the select gives the keys back; the key itself is lost. Space and Alt+Down
// still open the list. With the list open, Chromium's own popup (outside macOS) still sends the keys to the select,
// where they move in the list and pick by type-ahead, so the guard runs only on a list the browser says is closed
// (`:open`); a browser without `:open` gets none.

/** The keys that pick on a closed select with no popup, outside macOS. */
const MOVING_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

type Key = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean };

/** Whether a key on a focused select is dropped: one that would pick, on a closed list, with no Cmd, Ctrl or Alt. */
export function dropsKey(e: Key, listOpen: boolean): boolean {
  if (listOpen || e.metaKey || e.ctrlKey || e.altKey) return false;
  return MOVING_KEYS.has(e.key) || (e.key.length === 1 && e.key !== " ");
}

type SelectKeyEvent = Key & { preventDefault(): void; currentTarget: { matches(selector: string): boolean; blur(): void } };

/** Whether the browser says the select's list is open; true where `:open` isn't supported, so the guard stands down. */
function listOpen(select: SelectKeyEvent["currentTarget"]): boolean {
  try {
    return select.matches(":open");
  } catch {
    return true;
  }
}

/** A select's `onKeyDown`: a dropped key picks nothing, and the select lets go of the focus. */
export function guardClosedSelect(e: SelectKeyEvent): void {
  if (!dropsKey(e, listOpen(e.currentTarget))) return;
  e.preventDefault();
  e.currentTarget.blur();
}
