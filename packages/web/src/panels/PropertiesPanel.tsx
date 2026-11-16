import type { ReactNode } from "react";
import type { Field, ViewModel } from "@fm/editor";
import type { RendererKind } from "../renderer-switch";
import { ActionButton, CheckRow, KindField, NumberField, ReadOnlyField, Segmented, Select, Switch, TextAreaField, TextField } from "./controls";
import { ColourField } from "./ColourField";
import { keepFocus } from "./keep-focus";
import { Icon, TOOL_ICONS } from "./icons";
import { FinishSummary, shownFields } from "./FinishRow";
import { rememberSection, sectionOpen } from "./section-open";
import { LogoRow } from "./LogoRow";
import type { PanelProps } from "./types";
import { UnderlaySection } from "./UnderlaySection";
import "./properties.css";
import { IS_MAC, keyLabel } from "../keys";

// Properties (ux-polish item 6): the selection's fields in titled sections that collapse on their title (a native
// <details>, so the panel stays hook-free), or with nothing selected the active tool's help, the shortcuts, the
// Underlay section (import.06), the project's title block fields (sheet.04) and the rooms table.

/**
 * `renderer` is the shell's renderer, for the Underlay section's WebGL line; `onChoosePicture` opens the shell's file
 * picker (a panel can't import adapters), and Choose picture… is off without it; `onChooseLogo` the same for the logo.
 */
/** `mac`: draw shortcut keys as a Mac does (default: this browser's platform). */
type PropertiesProps = PanelProps & { renderer?: RendererKind; onChoosePicture?: () => void; onChooseLogo?: () => void; mac?: boolean };

/** Consecutive fields with the same section, in order (the ViewModel sends fields in section order). */
function sections(fields: readonly Field[]): { title: string; fields: Field[] }[] {
  const out: { title: string; fields: Field[] }[] = [];
  for (const field of fields) {
    const last = out.at(-1);
    if (last && last.title === field.section) last.fields.push(field);
    else out.push({ title: field.section, fields: [field] });
  }
  return out;
}

/** A group's words: "3 objects" for furniture, "4 walls, 6 pieces" or "2 walls" with walls in it (straight.09). */
function groupText(count: number, walls: number): string {
  if (walls === 0) return `${count} objects`;
  const pieces = count - walls;
  const w = `${walls} ${walls === 1 ? "wall" : "walls"}`;
  return pieces === 0 ? w : `${w}, ${pieces} ${pieces === 1 ? "piece" : "pieces"}`;
}

/** Picks up the ghost over the original, as Cmd/Ctrl+D does on the cursor (ghost.03): one piece or a furniture group. */
function DuplicateButton({ disabled, send, reason }: { disabled: boolean; send: PanelProps["send"]; reason?: string | undefined }) {
  return (
    <button type="button" data-testid="prop-duplicate" disabled={disabled || reason !== undefined} title={reason} onMouseDown={keepFocus} onClick={() => send({ type: "duplicate" })}>
      Duplicate
    </button>
  );
}

/** Splits a set into its table and loose chairs (seated.02). */
function BreakApartButton({ disabled, send }: { disabled: boolean; send: PanelProps["send"] }) {
  return (
    <button type="button" data-testid="prop-break-apart" disabled={disabled} onMouseDown={keepFocus} onClick={() => send({ type: "breakApart" })}>
      Break apart
    </button>
  );
}

function SplitButton({ disabled, send }: { disabled: boolean; send: PanelProps["send"] }) {
  return (
    <button type="button" data-testid="prop-split" disabled={disabled} onMouseDown={keepFocus} onClick={() => send({ type: "split" })}>
      Split
    </button>
  );
}

function Control({ field, disabled, onSet, send }: { field: Field; disabled: boolean; onSet(value: string): void; send: PanelProps["send"] }) {
  if (field.link !== undefined) return <HoleLink field={field} hole={field.link} send={send} />;
  if (field.action) return <ActionButton field={field} disabled={disabled} onSet={onSet} />;
  if (field.readOnly) return <ReadOnlyField field={field} />;
  if (field.toggle) return <Switch field={field} disabled={disabled} onSet={onSet} />;
  if (field.kindPicker) return <KindField field={field} disabled={disabled} onSet={onSet} />;
  if (field.select) return <Select field={field} disabled={disabled} onSet={onSet} />;
  if (field.options) return <Segmented field={field} disabled={disabled} onSet={onSet} />;
  if (field.step !== undefined) return <NumberField field={field} disabled={disabled} onSet={onSet} />;
  if (field.colour) return <ColourField field={field} disabled={disabled} onSet={onSet} />;
  if (field.multiline) return <TextAreaField field={field} disabled={disabled} onSet={onSet} />;
  return <TextField field={field} disabled={disabled} onSet={onSet} />;
}

/** A row that selects a hole, lighting it up on the plan while pointed at or focused (riser.20). */
function HoleLink({ field, hole, send }: { field: Field; hole: string; send: PanelProps["send"] }) {
  return (
    <button
      type="button"
      className="prop-action prop-action-do prop-action-link"
      data-field-id={field.id}
      onMouseDown={keepFocus}
      onClick={() => send({ type: "selectHole", id: hole })}
      onMouseEnter={() => send({ type: "hoverHole", id: hole })}
      onMouseLeave={() => send({ type: "hoverHole", id: null })}
      onFocus={() => send({ type: "hoverHole", id: hole })}
      onBlur={() => send({ type: "hoverHole", id: null })}
    >
      {field.value}
    </button>
  );
}

function EmptyState({ help, shortcuts, mac }: { help: ViewModel["toolHelp"]; shortcuts: ViewModel["shortcuts"]; mac: boolean }) {
  return (
    <section className="prop-empty">
      <div className="prop-empty-tool" data-testid="tool-help">
        <Icon name={TOOL_ICONS[help.tool]} size={18} />
        {help.label}
        {help.key !== "" ? <kbd className="prop-kbd">{help.key}</kbd> : null}
      </div>
      {help.hint !== help.label ? <p className="prop-empty-hint">{help.hint}</p> : null}
      <details className="prop-section prop-shortcuts" open={sectionOpen("Shortcuts")} onToggle={(e) => rememberSection("Shortcuts", e.currentTarget.open)} data-testid="shortcuts-section">
        <summary>
          <Icon name="chevron" size={12} />
          Shortcuts
        </summary>
        <dl className="prop-keys">
          {shortcuts.map((s) => [
            <dt key={`${s.label}:t`}>{s.label}</dt>,
            <dd key={`${s.label}:k`}>
              <kbd className="prop-kbd">{keyLabel(s.key, mac)}</kbd>
            </dd>,
          ])}
        </dl>
      </details>
    </section>
  );
}

/** A report's first line and the way to it: it's edited in one place, the sheets view (AC-14). */
function ReportLine({ field, sheet, send }: { field: Field; sheet: string; send: PanelProps["send"] }) {
  return (
    <div className="prop-report">
      <ReadOnlyField field={field} />
      <button type="button" className="prop-action" data-testid="project-report-edit" onClick={() => send({ type: "openSheet", id: sheet })}>
        Edit
      </button>
    </div>
  );
}

/**
 * A drawing-wide section shown with nothing selected: the title block fields (sheet.04) or the ceiling (heights.11);
 * one row each, the notes the full width under their label.
 */
function DrawingSection({ title, testId, fields, disabled, send, children }: { title: string; testId: string; fields: readonly Field[]; disabled: boolean; send: PanelProps["send"]; children?: ReactNode }) {
  return (
    <details className="prop-section prop-project" open={sectionOpen(title)} onToggle={(e) => rememberSection(title, e.currentTarget.open)} data-testid={testId}>
      <summary>
        <Icon name="chevron" size={12} />
        {title}
      </summary>
      {shownFields(fields).map((field) => field.finish ? <FinishSummary key={field.id} field={field} send={send} /> : field.hint ? (
        <p key={field.id} className="prop-hint" data-field-id={field.id}>{field.value}</p>
      ) : (
        <div key={field.id} className={`${field.multiline ? "prop-row prop-row-wide" : "prop-row"}${field.inFinish ? " prop-row-under" : ""}`}>
          <span className="prop-label" title={field.label}>
            {field.label}
          </span>
          {field.sheet !== undefined ? <ReportLine field={field} sheet={field.sheet} send={send} /> : <Control field={field} send={send} disabled={disabled} onSet={(value) => send({ type: "setField", fieldId: field.id, value })} />}
        </div>
      ))}
      {children}
    </details>
  );
}

/** The labelled rooms with their detail (size, floor), clear area and free floor in the active layout, each one's named areas indented under it, then the total (export.10, finishes.11, areas.12). */
function RoomsTable({ rooms }: { rooms: NonNullable<ViewModel["rooms"]> }) {
  return (
    <section className="prop-rooms">
      <h3 className="prop-rooms-title">Rooms</h3>
      <table className="prop-rooms-table" data-testid="rooms-table">
        <thead>
          <tr>
            <th>Room</th>
            <th>Area</th>
            <th>Free</th>
          </tr>
        </thead>
        <tbody>
          {rooms.rows.map((r) => (
            <tr key={r.labelId} {...(r.part ? { "data-area": r.name, className: "prop-room-part" } : { "data-room": r.name })}>
              <th scope="row">
                <span className="prop-room-name">{r.name}</span>
                {r.detail !== null ? <span className="prop-room-size">{r.detail}</span> : null}
              </th>
              <td>{r.area}</td>
              <td>{r.free ?? ""}</td>
            </tr>
          ))}
        </tbody>
        {rooms.total !== null ? (
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{rooms.total}</td>
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </section>
  );
}

export function PropertiesPanel({ view, send, renderer, onChoosePicture, onChooseLogo, mac = IS_MAC }: PropertiesProps) {
  const props = view.properties;
  const disabled = !(view.project?.canEdit ?? false);
  if (props.kind === "none") {
    // The Underlay section above Project: Project's long field list would push its controls off screen while tracing.
    return (
      <aside className="properties fm-properties" data-testid="properties">
        <EmptyState help={view.toolHelp} shortcuts={view.shortcuts} mac={mac} />
        {view.underlay !== null ? <UnderlaySection underlay={view.underlay} send={send} gpu={renderer === "webgl" || renderer === "webgpu"} onChoosePicture={onChoosePicture} /> : null}
        {view.ceiling !== null ? <DrawingSection title="Ceiling" testId="ceiling-section" fields={view.ceiling} disabled={disabled} send={send} /> : null}
        {view.outside !== null ? <DrawingSection title="Outside walls" testId="outside-section" fields={view.outside} disabled={disabled} send={send} /> : null}
        {view.trailer !== null ? <DrawingSection title="Trailer" testId="trailer-section" fields={view.trailer} disabled={disabled} send={send} /> : null}
        {view.projectFields !== null ? (
          <DrawingSection title="Project" testId="project-section" fields={view.projectFields} disabled={disabled} send={send}>
            {view.logo !== null ? <LogoRow logo={view.logo} send={send} onChooseLogo={onChooseLogo} /> : null}
          </DrawingSection>
        ) : null}
        {view.rooms !== null ? <RoomsTable rooms={view.rooms} /> : null}
      </aside>
    );
  }
  if (props.kind === "group") {
    return (
      <aside className="properties fm-properties" data-testid="properties">
        <p className="prop-empty-hint" data-testid="properties-group">{groupText(props.count, props.walls ?? 0)}</p>
        <div className="prop-group-actions">
          <button type="button" data-testid="group-delete" disabled={disabled} onMouseDown={keepFocus} onClick={() => send({ type: "deleteSelection" })}>
            Delete
          </button>
          <DuplicateButton disabled={disabled} send={send} reason={props.duplicate} />
        </div>
      </aside>
    );
  }
  return (
    <aside className="properties fm-properties" data-testid="properties">
      {sections(props.fields).map((section) => (
        <details key={`${props.kind}:${section.title}`} className="prop-section" open={sectionOpen(section.title)} onToggle={(e) => rememberSection(section.title, e.currentTarget.open)}>
          <summary>
            <Icon name="chevron" size={12} />
            {section.title}
          </summary>
          {shownFields(section.fields).map((field) =>
            field.finish ? (
              <FinishSummary key={field.id} field={field} send={send} />
            ) : field.check ? (
              <CheckRow key={field.id} field={field} check={field.check} />
            ) : field.hint ? (
              <p key={field.id} className="prop-hint" data-field-id={field.id}>{field.value}</p>
            ) : (
              <div key={field.id} className={field.inFinish ? "prop-row prop-row-under" : "prop-row"}>
                <span className="prop-label">{field.label}</span>
                <Control field={field} send={send} disabled={disabled} onSet={(value) => send({ type: "setField", fieldId: field.id, value })} />
              </div>
            ),
          )}
        </details>
      ))}
      {props.kind === "object" ? (
        <div className="prop-group-actions">
          <DuplicateButton disabled={disabled} send={send} />
          {props.breakApart === true ? <BreakApartButton disabled={disabled} send={send} /> : null}
        </div>
      ) : null}
      {props.kind === "wall" && props.split === true ? (
        <div className="prop-group-actions">
          <SplitButton disabled={disabled} send={send} />
        </div>
      ) : null}
    </aside>
  );
}
