import { useEffect, useRef, useState } from "react";
import type { Field, UiAction } from "@fm/editor";
import type { PanelProps } from "./types";

const TITLES = { wall: "Wall", joint: "Joint", zone: "Zone" } as const;

export function PropertiesPanel({ view, send }: PanelProps) {
  const props = view.properties;
  if (props.kind === "none") {
    return (
      <aside className="properties fm-properties" data-testid="properties">
        <p className="muted">Nothing selected</p>
      </aside>
    );
  }
  const canEdit = view.project?.canEdit ?? false;
  return (
    <aside className="properties fm-properties" data-testid="properties">
      <h2>{TITLES[props.kind]}</h2>
      {props.fields.map((field) => (
        <label key={`${props.kind}:${field.id}`} className="field">
          <span className="field-label">{field.label}</span>
          {field.readOnly ? (
            <input readOnly value={field.value} data-field-id={field.id} />
          ) : (
            <EditableField field={field} disabled={!canEdit} send={send} />
          )}
          {field.unit !== null ? <span className="field-unit">{field.unit}</span> : null}
        </label>
      ))}
    </aside>
  );
}

/** Local draft; commits on blur (Enter blurs), Escape restores without sending. */
function EditableField({ field, disabled, send }: { field: Field; disabled: boolean; send(action: UiAction): void }) {
  const [draft, setDraft] = useState(field.value);
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(field.value);
  }, [field.value]);

  return (
    <input
      value={draft}
      disabled={disabled}
      data-field-id={field.id}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft !== field.value) send({ type: "setField", fieldId: field.id, value: draft });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(field.value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
