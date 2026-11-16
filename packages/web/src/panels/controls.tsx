import { isOpeningKind, steppedValue, type Field, type OpeningChoice } from "@fm/editor";
import { DraftInput, DraftTextArea } from "./DraftInput";
import { Icon } from "./icons";
import { KindPicker } from "./KindPicker";
import { keepFocus } from "./keep-focus";
import { guardClosedSelect } from "./select-keys";

// Properties controls (ux-polish item 6). Hook-free so web tests can call them as functions; each reports a field's
// new value as the string the editor's setField expects.

type ControlProps = { field: Field; disabled: boolean; onSet(value: string): void };

/**
 * A choice of two or three options: a grey track with the current option raised (styles.css, .fm-seg). A disabled
 * option shows but cannot be picked (the ceiling's Shed and Gable, until stage 3).
 */
export function Segmented({ field, disabled, onSet }: ControlProps) {
  return (
    <div className="fm-seg fm-seg-full" role="group" aria-label={field.label} data-field-id={field.id}>
      {(field.options ?? []).map((o) => (
        <button
          key={o.value}
          type="button"
          data-value={o.value}
          aria-pressed={o.value === field.value}
          disabled={disabled || o.disabled === true}
          onClick={() => onSet(o.value)}
          {...(o.disabled === true ? { title: `${o.label}: not available yet` } : {})}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An opening's kind (openkinds.07): the floating bar's kind picker, its options in their groups. */
export function KindField({ field, disabled, onSet }: ControlProps) {
  const choices = (field.options ?? []).flatMap((o): OpeningChoice[] => (isOpeningKind(o.value) ? [{ kind: o.value, label: o.label, group: o.group ?? "" }] : []));
  if (!isOpeningKind(field.value)) return null;
  return (
    <div className="fm-control" data-field-id={field.id}>
      <KindPicker value={field.value} choices={choices} disabled={disabled} testId="prop-opening-kind" label={field.label} onPick={onSet} />
    </div>
  );
}

/**
 * A longer choice as a native drop-down (an object's size presets); a disabled option is shown but cannot be picked. It
 * blurs after a pick and guards stray keys, as every dropdown does (snags.06): the window key listener drops keys aimed
 * at a SELECT, so Cmd+Z would do nothing and a typed letter would pick another option, a shared edit.
 */
export function Select({ field, disabled, onSet }: ControlProps) {
  const pick = (e: { currentTarget: { value: string; blur(): void } }) => {
    onSet(e.currentTarget.value);
    e.currentTarget.blur();
  };
  return (
    <div className="fm-control">
      <select aria-label={field.label} data-field-id={field.id} value={field.value} disabled={disabled} onChange={pick} onKeyDown={guardClosedSelect}>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** An on/off toggle whose value is "true" or "false". */
export function Switch({ field, disabled, onSet }: ControlProps) {
  const on = field.value === "true";
  return (
    <button
      type="button"
      className="prop-switch"
      role="switch"
      aria-checked={on}
      aria-label={field.label}
      data-field-id={field.id}
      disabled={disabled}
      onClick={() => onSet(on ? "false" : "true")}
    />
  );
}

/** A filled text field committing on blur or Enter, the unit in grey at the right. */
// Read-only, not disabled, while an edit awaits its answer: a disabled box drops the focus Tab just gave it (sheetset.68).
export function TextField({ field, disabled, onSet }: ControlProps) {
  return (
    <div className="fm-control">
      <DraftInput value={field.value} readOnly={disabled} aria-label={field.label} data-field-id={field.id} placeholder={field.placeholder} onCommit={onSet} />
      {field.unit !== null ? <span className="fm-unit">{field.unit}</span> : null}
    </div>
  );
}

/** A multi-line text (the project notes): a filled box that grows with its rows, committing on blur or Ctrl/Cmd+Enter. */
export function TextAreaField({ field, disabled, onSet }: ControlProps) {
  return (
    <div className="fm-control fm-control-area">
      <DraftTextArea value={field.value} readOnly={disabled} rows={4} aria-label={field.label} data-field-id={field.id} onCommit={onSet} />
    </div>
  );
}

/** A number: a text field plus small up and down steppers, each click one step (formatted to the step's decimals). */
export function NumberField({ field, disabled, onSet }: ControlProps) {
  return (
    <div className="fm-control">
      <DraftInput
        value={field.value}
        inputMode="decimal"
        readOnly={disabled}
        aria-label={field.label}
        data-field-id={field.id}
        placeholder={field.placeholder}
        onCommit={onSet}
      />
      {field.unit !== null ? <span className="fm-unit">{field.unit}</span> : null}
      <span className="prop-steppers">
        <button type="button" tabIndex={-1} data-step="up" aria-label={`Increase ${field.label}`} disabled={disabled} onClick={() => onSet(steppedValue(field, 1))}>
          <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true"><path d="M0.5 4.5 4 1l3.5 3.5" /></svg>
        </button>
        <button type="button" tabIndex={-1} data-step="down" aria-label={`Decrease ${field.label}`} disabled={disabled} onClick={() => onSet(steppedValue(field, -1))}>
          <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true"><path d="M0.5 0.5 4 4l3.5-3.5" /></svg>
        </button>
      </span>
    </div>
  );
}

/**
 * A read-only value as plain text. It stays a readonly input (not a span) so its value is readable the same way as
 * an editable field's (the e2e suite reads Length, Area and Free floor with toHaveValue).
 */
export function ReadOnlyField({ field }: { field: Field }) {
  return (
    <div className="prop-readonly">
      <input readOnly tabIndex={-1} size={Math.max(1, field.value.length)} value={field.value} aria-label={field.label} data-field-id={field.id} />
      {field.unit !== null ? <span className="prop-readonly-unit">{field.unit}</span> : null}
    </div>
  );
}

/** A button that sends its field with an empty value, showing the value it would set (a stair's Fit run, stairs.15) or, with no unit, what it does (a section's Flip). */
export function ActionButton({ field, disabled, onSet }: ControlProps) {
  const text = field.unit !== null ? `${field.value} ${field.unit}` : field.value;
  return (
    <button type="button" data-field-id={field.id} className="prop-action prop-action-do" aria-label={`${field.label} ${text}`} disabled={disabled || field.readOnly} onMouseDown={keepFocus} onClick={() => onSet("")}>
      {field.unit !== null ? `Use ${text}` : text}
    </button>
  );
}

/** A check the full width of the panel: a tick or a warning, then the editor's sentence (a stair's checks, stairs.15). */
export function CheckRow({ field, check }: { field: Field; check: "ok" | "warning" }) {
  return (
    <p className="prop-check" data-check={check} data-field-id={field.id}>
      <Icon name={check === "ok" ? "tick" : "warning"} size={14} />
      <span>{field.value}</span>
    </p>
  );
}
