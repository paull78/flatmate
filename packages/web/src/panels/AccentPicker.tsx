import { useEffect, useRef } from "react";
import type { SheetsView, UiAction } from "@fm/editor";

// The set's accent, as on the mockup (sheetset.15, .18): swatches, then any other colour. While an edit awaits its ack both
// refuse rather than go disabled, as NorthDial does, since a disabled element drops its focus.

type Send = (action: UiAction) => void;
const setAccent = (send: Send, value: string): void => send({ type: "setSheetSetting", key: "accent", value });
const CUSTOM_AT_REST = "#7c3aed"; // the mockup's: with a swatch on, the current colour here would read as a second one of it

/**
 * The browser's colour picker. A pick fires `input` many times and `change` once as it closes, but React's onChange fires
 * on each `input`, which would be one undo step and a page redraw per colour passed: so it listens for the real `change`.
 * Not controlled, so a render mid-pick can't move the picker's colour.
 */
export function CustomColour({ accent, on, readOnly, send }: { accent: string; on: boolean; readOnly: boolean; send: Send }) {
  const box = useRef<HTMLInputElement>(null);
  const shown = on ? accent : CUSTOM_AT_REST;
  useEffect(() => {
    if (box.current) box.current.value = shown;
  }, [shown]);
  useEffect(() => {
    const input = box.current;
    if (!input) return undefined;
    const commit = (): void => {
      if (!readOnly && input.value !== accent) setAccent(send, input.value);
      else input.value = shown;
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [accent, shown, readOnly, send]);
  return <input ref={box} type="color" className={on ? "sheets-swatch-custom on" : "sheets-swatch-custom"} aria-label="Custom accent colour" title="Custom colour" defaultValue={shown} />;
}

export function AccentPicker({ sheets, send }: { sheets: SheetsView; send: Send }) {
  const { accent, accents, readOnly } = sheets;
  return (
    <div className="sheets-swatches" role="group" aria-label="Accent">
      {accents.map((a) => (
        <button
          key={a.value}
          type="button"
          className="sheets-swatch"
          style={{ background: a.value }}
          aria-label={a.label}
          title={a.label}
          aria-pressed={a.value === accent}
          onClick={() => {
            if (!readOnly && a.value !== accent) setAccent(send, a.value);
          }}
        />
      ))}
      <CustomColour accent={accent} on={!accents.some((a) => a.value === accent)} readOnly={readOnly} send={send} />
    </div>
  );
}
