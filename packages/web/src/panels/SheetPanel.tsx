import type { SheetRow, SheetsView, UiAction } from "@fm/editor";
import { AccentPicker } from "./AccentPicker";
import { DraftInput } from "./DraftInput";
import { NorthDial } from "./NorthDial";
import { ReportEditor } from "./ReportEditor";

// The right panel (sheetset.15), as on the mockup: the selected sheet first, in visible choices rather than menus. Plain
// functions, so tests can call them (layout-states.38). Each choice is one undoable command; a title, on leaving its box.

const KIND_NAMES: Record<SheetRow["kind"], string> = { plan: "Plan", compare: "Compare", cover: "Cover", report: "Report", section: "Section" };

type Send = (action: UiAction) => void;
type Option<T> = { value: T; label: string; nofit?: boolean };

const MOST_ACROSS = 4; // what a 288 px panel holds before names cut

/** One choice on a grey track, the current one raised. */
function Seg<T>({ label, options, value, disabled, nofitTitle, onPick }: { label: string; options: readonly Option<T>[]; value: T; disabled: boolean; nofitTitle?: string; onPick(value: T): void }) {
  return (
    <div className="sheets-prop">
      <span className="sheets-plabel">{label}</span>
      <div className={options.length > MOST_ACROSS ? "sheets-seg grid" : "sheets-seg"} role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.label} type="button" className={o.nofit ? "nofit" : undefined} aria-pressed={o.value === value} disabled={disabled} title={o.nofit ? nofitTitle : undefined} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type SettingsProps = { sheet: SheetRow; sheets: SheetsView; send: Send };

/** What a drawn sheet has whatever it shows. */
function DrawingSettings({ sheet, sheets, send }: SettingsProps) {
  const { readOnly: disabled } = sheets;
  return (
    <>
      <Seg
        label="Scale"
        options={sheet.scales.map((c) => ({ value: c.scale, label: c.label, nofit: c.nofit }))}
        value={sheet.ownScale ? sheet.scale : null}
        disabled={disabled}
        nofitTitle={`The whole ${sheet.kind === "section" ? "section" : "plan"} won't fit on ${sheets.paper}: for a detail`}
        onPick={(scale) => send({ type: "setSheet", id: sheet.id, fields: { scale } })}
      />
      {sheet.kind !== "section" && sheets.sections.length > 0 ? (
        <label className="sheets-toggle">
          <span>Section marks</span>
          <input type="checkbox" role="switch" data-testid="sheet-marks" checked={sheet.marks} disabled={disabled} onChange={(e) => send({ type: "setSheet", id: sheet.id, fields: { marks: e.target.checked } })} />
        </label>
      ) : null}
      {sheet.kind === "section" ? null : (
        <label className="sheets-toggle">
          <span>Floor finishes</span>
          <input type="checkbox" role="switch" data-testid="sheet-finishes" checked={sheet.finishes} disabled={disabled} onChange={(e) => send({ type: "setSheet", id: sheet.id, fields: { finishes: e.target.checked } })} />
        </label>
      )}
      <div className="sheets-prop">
        <span className="sheets-plabel">Framing</span>
        <div className="sheets-line-left">
          <button type="button" className="sheets-soft" data-testid="sheet-centre" disabled={disabled || sheet.centred} onClick={() => send({ type: "setSheet", id: sheet.id, fields: { cx: 0, cy: 0 } })}>
            Centre
          </button>
        </div>
      </div>
    </>
  );
}

function PlanSettings({ sheet, sheets, send }: SettingsProps) {
  const { readOnly: disabled } = sheets;
  const layout = sheet.drawing?.layout ?? "";
  const deck = sheet.drawing?.deck ?? null;
  return (
    <>
      <Seg label="Layout" options={sheets.layouts.map((l) => ({ value: l.id, label: l.name }))} value={layout} disabled={disabled} onPick={(next) => send({ type: "setSheetDrawing", id: sheet.id, layout: next, deck })} />
      <Seg label="Level" options={sheets.levels.map((l) => ({ value: l.deck, label: l.label }))} value={deck} disabled={disabled} onPick={(next) => send({ type: "setSheetDrawing", id: sheet.id, layout, deck: next })} />
      <DrawingSettings sheet={sheet} sheets={sheets} send={send} />
    </>
  );
}

const SPLITS: readonly Option<SheetRow["split"]>[] = [
  { value: "auto", label: "Automatic" },
  { value: "stacked", label: "Stacked" },
  { value: "sideBySide", label: "Side by side" },
];

/** What a pane can show, then how the panes lie (sheetset.11, .12). A check the sheet can't lose or gain is off. */
function PaneSettings({ sheet, sheets, send, label }: SettingsProps & { label: string }) {
  const { readOnly: disabled } = sheets;
  return (
    <>
      <div className="sheets-prop">
        <span className="sheets-plabel">{label}</span>
        <div className="sheets-checks" role="group" aria-label={label}>
          {sheet.panes.map((p) => (
            <label key={`${p.layout} ${p.deck}`}>
              <input type="checkbox" data-testid="sheet-pane" checked={p.on} disabled={disabled || p.locked} onChange={() => send({ type: "toggleSheetPane", id: sheet.id, layout: p.layout, deck: p.deck })} />
              <span>{p.title}</span>
            </label>
          ))}
        </div>
      </div>
      <Seg label="Split" options={SPLITS} value={sheet.split} disabled={disabled} onPick={(split) => send({ type: "setSheet", id: sheet.id, fields: { split } })} />
      <DrawingSettings sheet={sheet} sheets={sheets} send={send} />
    </>
  );
}

/** Each layout and level, keeping 2 to 4. */
function CompareSettings(props: SettingsProps) {
  return <PaneSettings {...props} label={props.sheets.levels.length > 1 ? "Layouts and levels, 2 to 4" : "Layouts, 2 to 4"} />;
}

/** Which section it draws, then each layout, keeping 1 to 4: a section isn't cut per level (section.10). */
function SectionSettings(props: SettingsProps) {
  const { sheet, sheets, send } = props;
  return (
    <>
      <Seg label="Section" options={sheets.sections.map((s) => ({ value: s.id, label: s.label }))} value={sheet.section ?? ""} disabled={sheets.readOnly} onPick={(section) => send({ type: "setSheetSection", id: sheet.id, section })} />
      <PaneSettings {...props} label="Layouts, 1 to 4" />
    </>
  );
}

const BODY_SIZES: readonly Option<SheetRow["size"]>[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

/** The whole set's settings go below a sheet's own, for any sheet. */
export function SheetPanel({ sheets, send }: { sheets: SheetsView; send: Send }) {
  const sheet = sheets.sheets.find((s) => s.id === sheets.selected);
  if (!sheet) return <p className="sheets-help-text">No sheet selected.</p>;
  // The title is read-only, never disabled, so a box being typed in keeps its focus and draft while an edit waits for its ack.
  return (
    <>
      <h2>{KIND_NAMES[sheet.kind]} sheet</h2>
      <div className="sheets-prop">
        <DraftInput key={sheet.id} className="sheets-title-in" data-testid="sheet-title" type="text" aria-label="Sheet title" value={sheet.title} readOnly={sheets.readOnly} onCommit={(title) => send({ type: "renameSheet", id: sheet.id, title })} />
      </div>
      {sheet.kind === "plan" || sheet.kind === "cover" ? <PlanSettings sheet={sheet} sheets={sheets} send={send} /> : null}
      {sheet.kind === "compare" ? <CompareSettings sheet={sheet} sheets={sheets} send={send} /> : null}
      {sheet.kind === "section" ? <SectionSettings sheet={sheet} sheets={sheets} send={send} /> : null}
      {sheet.kind === "report" ? (
        <>
          <ReportEditor sheet={sheet} send={send} />
          <Seg label="Body size" options={BODY_SIZES} value={sheet.size} disabled={sheets.readOnly} onPick={(size) => send({ type: "setSheet", id: sheet.id, fields: { size } })} />
        </>
      ) : null}
      <h2>Whole set</h2>
      <div className="sheets-prop">
        <span className="sheets-plabel">North</span>
        <NorthDial north={sheets.north} readOnly={sheets.readOnly} send={send} />
      </div>
      <div className="sheets-prop">
        <span className="sheets-plabel">Accent</span>
        <AccentPicker sheets={sheets} send={send} />
      </div>
    </>
  );
}
