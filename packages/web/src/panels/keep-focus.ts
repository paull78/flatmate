import type { MouseEvent } from "react";

/**
 * A button's mouse down: keeps keyboard focus off the button, which would also react to Space and Enter, the keys the editor
 * confirms with. A draft field (DraftInput, DraftTextArea) is blurred first, so its text commits before the click acts: the
 * click may unmount the field, and React drops a blur that comes with that. Other fields keep their focus (quick add, a
 * report's text under the style buttons).
 */
export const keepFocus = (e: MouseEvent): void => {
  const focused = e.currentTarget.ownerDocument.activeElement;
  if (focused !== null && focused instanceof HTMLElement && focused.dataset.draft !== undefined) focused.blur();
  e.preventDefault();
};
