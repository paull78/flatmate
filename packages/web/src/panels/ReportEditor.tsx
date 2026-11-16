import type { MouseEvent } from "react";
import type { SheetRow, UiAction } from "@fm/editor";
import { keepFocus } from "./keep-focus";
import { boxText, lineStyleEdit, markEdit, type BoxEdit } from "./report-marks";

// The report's text box, under its small style bar (sheetset.07, as on the mockup). Hook-free: the editor holds the
// draft (sheetset.14), so the box is never read-only and no key is lost to an edit's ack.

type StyleEdit = (value: string, start: number, end: number) => BoxEdit | null;

const STYLES: readonly { id: string; label: string; title: string; edit: StyleEdit }[] = [
  { id: "title", label: "Title", title: "Title: the line at the very top, across the columns", edit: (v, a, b) => lineStyleEdit(v, a, b, "# ") },
  { id: "heading", label: "Heading", title: "Heading", edit: (v, a, b) => lineStyleEdit(v, a, b, "## ") },
  { id: "bold", label: "B", title: "Bold. Headings are bold already", edit: (v, a, b) => markEdit(v, a, b, "**") },
  { id: "italic", label: "I", title: "Italic. Not in a heading", edit: (v, a, b) => markEdit(v, a, b, "*") },
];

/** Through the browser's own edit, so ⌘Z in the box takes it back (sheetset.14) and React hears it as typing. A plain `.value =` would clear the box's undo. */
function applyEdit(box: HTMLTextAreaElement, edit: BoxEdit | null): void {
  box.focus();
  if (edit === null) return;
  box.setSelectionRange(edit.from, edit.to);
  const done = edit.insert === "" ? document.execCommand("delete") : document.execCommand("insertText", false, edit.insert);
  if (!done) {
    box.setRangeText(edit.insert);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
  box.setSelectionRange(edit.start, edit.end);
}

function onStyle(e: MouseEvent<HTMLButtonElement>, edit: StyleEdit): void {
  const box = e.currentTarget.closest(".sheets-editor")?.querySelector("textarea");
  if (box) applyEdit(box, edit(box.value, box.selectionStart, box.selectionEnd));
}

export function ReportEditor({ sheet, send }: { sheet: SheetRow; send(action: UiAction): void }) {
  return (
    <div className="sheets-prop">
      <span className="sheets-plabel">Text</span>
      <div className="sheets-editor">
        <div className="sheets-editor-bar" role="toolbar" aria-label="Text style">
          {STYLES.map((s) => (
            <button key={s.id} type="button" data-style={s.id} title={s.title} onMouseDown={keepFocus} onClick={(e) => onStyle(e, s.edit)}>
              {s.label}
            </button>
          ))}
        </div>
        {/* Keyed by sheet, so one report's box undo and scroll never carry to another's. */}
        <textarea
          key={sheet.id}
          data-testid="report-text"
          aria-label="Report text"
          value={boxText(sheet.text)}
          onChange={(e) => send({ type: "typeReport", id: sheet.id, text: e.target.value })}
          onBlur={() => send({ type: "leaveReport", id: sheet.id })}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur(); // leaves and keeps, unlike a title: this can be hours of typing, and ⌘Z takes it back
          }}
        />
      </div>
      {sheet.textNote !== null ? (
        <p className="sheets-report-note" data-testid="report-note" role="status">
          {sheet.textNote}
        </p>
      ) : null}
      {sheet.textHeld ? (
        <p className="sheets-report-note" role="status">
          Not saved yet.{" "}
          <button type="button" data-testid="report-retry" onClick={() => send({ type: "leaveReport", id: sheet.id })}>
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
