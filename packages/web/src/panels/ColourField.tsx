import { useEffect, useRef } from "react";
import type { Field } from "@fm/editor";
import { DraftInput } from "./DraftInput";

// A colour field (picker): the browser's colour picker as a swatch, beside the colour typed as hex for an exact value.
// The picker fires `input` for every colour passed and `change` once as it closes, and React's onChange fires on each
// `input`: so it listens for the real `change`, one edit and one undo step per pick, as the sheets' accent (sheetset.18).
// Not controlled, so a render mid-pick can't move the picker's colour.

const HEX = /^#[0-9a-f]{6}$/i;

/** The swatch that opens the picker: committing its colour when the picker closes, if it changed. */
export function ColourPicker({ value, label, readOnly, onSet }: { value: string; label: string; readOnly: boolean; onSet(value: string): void }) {
  const box = useRef<HTMLInputElement>(null);
  const shown = HEX.test(value) ? value.toLowerCase() : "#000000"; // the picker takes only #rrggbb
  useEffect(() => {
    if (box.current) box.current.value = shown;
  }, [shown]);
  useEffect(() => {
    const input = box.current;
    if (!input) return undefined;
    const commit = (): void => {
      if (!readOnly && input.value.toLowerCase() !== shown) onSet(input.value.toLowerCase());
      else input.value = shown;
      input.blur(); // the focus back to the editor, as a text field's Enter does (tidy.27), so Undo then undoes the pick
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [shown, readOnly, onSet]);
  return <input ref={box} type="color" className="fm-colour-swatch" aria-label={`${label}: pick a colour`} title="Pick a colour" data-colour-for={label} defaultValue={shown} />;
}

/** A colour field: the picker's swatch, then the hex, typed and committed on blur or Enter as any text field. */
export function ColourField({ field, disabled, onSet }: { field: Field; disabled: boolean; onSet(value: string): void }) {
  return (
    <div className="fm-control fm-colour">
      <ColourPicker value={field.value} label={field.label} readOnly={disabled} onSet={onSet} />
      <DraftInput value={field.value} readOnly={disabled} aria-label={field.label} data-field-id={field.id} onCommit={onSet} />
    </div>
  );
}
