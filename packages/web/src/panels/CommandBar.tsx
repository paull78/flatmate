import { DraftInput } from "./DraftInput";
import { guardClosedSelect } from "./select-keys";
import type { PanelProps } from "./types";

/**
 * The hint line floating under the bar (ux-polish item 7): the command prompt and the value being typed (spec: tools),
 * then the stair's fix chips (stairdraw.13): hovering one sends chipHover, leaving it chipHover null, a click chipClick;
 * then the size picker while a kind with presets is armed (furnish.05), and the typed Width, Depth and Height (sizing.06, .15). The
 * select blurs after a pick, and a field after Enter: the window key listener drops keys aimed at a SELECT or an INPUT,
 * so R, Esc and the arrows would otherwise do nothing until a canvas click. Hook-free: tests call it as a function.
 */
const noop = (): void => {};

export function CommandBar({ view, send }: PanelProps) {
  const { prompt, value, unit, chips } = view.commandBar;
  const picker = view.sizePicker;
  const fields = view.sizeFields;
  const field = (which: "width" | "depth" | "height", label: string, text: string) =>
    fields === null ? null : (
      <DraftInput
        className="size-field"
        data-testid={`size-${which}`}
        aria-label={label}
        aria-invalid={fields.bad.includes(which) ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        value={text}
        onCommit={(v) => send({ type: "setArmedSize", kind: fields.kind, [which]: v })}
      />
    );
  return (
    <div className="hint-line fm-commandbar" data-testid="command-bar">
      <span className="command-prompt">{prompt}</span>
      <span className="command-value" data-testid="command-value">{value}</span>
      {view.typing ? (
        // A focus anchor while a value is typed (tidy.14): keyboard extensions leave keys in an editable element alone.
        // The editor holds the text; input.ts sends this element's keys to it and keeps it empty.
        <input className="value-input" data-editor-keys="" data-testid="value-input" aria-label="Typed value" autoComplete="off" spellCheck={false} value="" onChange={noop} />
      ) : null}
      {unit !== null && value !== "" ? <span className="command-unit">{unit}</span> : null}
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className="command-chip"
          data-chip-id={c.id}
          onMouseEnter={() => send({ type: "chipHover", id: c.id })}
          onMouseLeave={() => send({ type: "chipHover", id: null })}
          onClick={() => send({ type: "chipClick", id: c.id })}
        >
          {c.detail === undefined ? c.label : `${c.label} · ${c.detail}`}
        </button>
      ))}
      {picker !== null ? (
        <label className="size-picker" data-testid="size-picker">
          Size:
          <select
            data-testid="size-picker-select"
            aria-label="Size"
            value={picker.current}
            onChange={(e) => {
              send({ type: "pickPreset", kind: picker.kind, preset: e.currentTarget.value });
              e.currentTarget.blur();
            }}
            onKeyDown={guardClosedSelect}
          >
            {picker.current === "Custom" ? (
              <option value="Custom" disabled>
                Custom
              </option>
            ) : null}
            {picker.options.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields !== null ? (
        <span className="size-fields" data-testid="size-fields">
          <span>W</span>
          {field("width", "Width", fields.width)}
          <span>×</span>
          <span>D</span>
          {field("depth", "Depth", fields.depth)}
          {fields.height === null ? null : (
            <>
              <span>×</span>
              <span>H</span>
              {field("height", "Height", fields.height)}
            </>
          )}
          <span>m</span>
        </span>
      ) : null}
    </div>
  );
}
