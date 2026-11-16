import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { SheetRow, SheetsView, UiAction } from "@fm/editor";
import { AddSheet } from "./AddSheetMenu";
import { Icon } from "./icons";
import type { DrawPage } from "./SheetPage";
import { dropIndex, sheetKey } from "./sheet-keys";
import { SheetThumb } from "./SheetThumb";

export type DropAt = { id: string; after: boolean };

const KIND_NAMES: Record<SheetRow["kind"], string> = { plan: "Plan", compare: "Compare", cover: "Cover", report: "Report", section: "Section" };

const stop = (e: Pick<MouseEvent, "stopPropagation">): void => e.stopPropagation();

function RowSub({ sheet }: { sheet: SheetRow }) {
  const place = sheet.number === null ? "Not in PDF" : String(sheet.number).padStart(2, "0");
  return (
    <div className="sheets-row-sub">
      {place} · {KIND_NAMES[sheet.kind]}
      {sheet.scale === null ? null : (
        <>
          {" · "}
          {sheet.ownScale ? <b>1:{sheet.scale}</b> : `1:${sheet.scale}`}
        </>
      )}
      {sheet.partOfPlan ? <span title={`Shows part of the ${sheet.kind === "section" ? "section" : "plan"}`}> · cropped</span> : null}
    </div>
  );
}

type ViewProps = {
  sheets: SheetsView;
  send(action: UiAction): void;
  drawPage: DrawPage;
  dragging: string | null;
  drop: DropAt | null;
  onRowKey(e: KeyboardEvent<HTMLElement>, id: string): void;
  onDelete(id: string): void;
  onDragStart(e: DragEvent<HTMLElement>, id: string): void;
  onDragEnd(): void;
  onDragOverRow(e: DragEvent<HTMLElement>, id: string): void;
  onDragOverList(e: DragEvent<HTMLElement>): void;
  onDragLeaveList(e: DragEvent<HTMLElement>): void;
  onDrop(e: DragEvent<HTMLElement>): void;
};

/**
 * The rows, their count and what's missing (sheetset.13, .14). A plain function, so its tests can call it. The checkbox
 * sits at the row's left and never moves; duplicate and delete sit over the title's line on the selected or hovered row, so the line under it stays readable.
 */
export function SheetListView({ sheets, send, drawPage, dragging, drop, onRowKey, onDelete, onDragStart, onDragEnd, onDragOverRow, onDragOverList, onDragLeaveList, onDrop }: ViewProps) {
  const ticked = sheets.sheets.filter((s) => s.inPdf).length;
  const allTicked = ticked === sheets.sheets.length;
  return (
    <>
      <div className="sheets-list-head">
        <h2>Sheets</h2>
        <span className="sheets-count">
          {ticked} of {sheets.sheets.length} in PDF
          <button type="button" className="sheets-link" data-testid="sheets-all-none" disabled={sheets.readOnly} onClick={() => send({ type: "tickAllSheets", on: !allTicked })}>
            {allTicked ? "None" : "All"}
          </button>
        </span>
      </div>
      <div className="sheets-rows" role="listbox" aria-label="Sheets" onDragOver={onDragOverList} onDragLeave={onDragLeaveList} onDrop={onDrop}>
        {sheets.sheets.map((sheet) => {
          const on = sheet.id === sheets.selected;
          const classes = ["sheets-row", ...(on ? ["on"] : []), ...(sheet.inPdf ? [] : ["off"]), ...(dragging === sheet.id ? ["dragging"] : []), ...(drop?.id === sheet.id ? [drop.after ? "drop-after" : "drop-before"] : [])];
          return (
            <div
              key={sheet.id}
              role="option"
              aria-selected={on}
              className={classes.join(" ")}
              tabIndex={0}
              draggable={!sheets.readOnly}
              data-testid="sheet-row"
              data-sheet-row={sheet.id}
              onClick={() => send({ type: "selectSheet", id: sheet.id })}
              onKeyDown={(e) => onRowKey(e, sheet.id)}
              onDragStart={(e) => onDragStart(e, sheet.id)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOverRow(e, sheet.id)}
            >
              <input type="checkbox" className="sheets-row-check" aria-label={`In PDF: ${sheet.title}`} title="In PDF" checked={sheet.inPdf} disabled={sheets.readOnly} onClick={stop} onChange={(e) => send({ type: "tickSheet", id: sheet.id, on: e.target.checked })} />
              <SheetThumb sheet={sheet} size={sheets.page} drawPage={drawPage} />
              <div className="sheets-row-text">
                <div className="sheets-row-title" title={sheet.title}>
                  {sheet.title}
                </div>
                <RowSub sheet={sheet} />
                <div className="sheets-row-acts">
                  <button
                    type="button"
                    className="sheets-icon"
                    aria-label={`Duplicate ${sheet.title}`}
                    title="Duplicate"
                    disabled={sheets.readOnly}
                    onClick={(e) => {
                      stop(e);
                      send({ type: "duplicateSheet", id: sheet.id });
                    }}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <button
                    type="button"
                    className="sheets-icon"
                    aria-label={`Delete ${sheet.title}`}
                    title="Delete"
                    disabled={sheets.readOnly}
                    onClick={(e) => {
                      stop(e);
                      onDelete(sheet.id);
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {sheets.missing.map(({ layout, deck, title }) => (
        <div key={`${layout} ${deck}`} className="sheets-missing">
          {title} has no sheet ·{" "}
          <button type="button" className="sheets-link" data-testid="sheets-missing-add" disabled={sheets.readOnly} onClick={() => send({ type: "addMissingSheet", layout, deck })}>
            Add
          </button>
        </div>
      ))}
      {sheets.missingSections.map(({ section, label }) => (
        <div key={section} className="sheets-missing">
          {label} has no sheet ·{" "}
          <button type="button" className="sheets-link" data-testid="sheets-missing-section-add" disabled={sheets.readOnly} onClick={() => send({ type: "addMissingSection", section })}>
            Add
          </button>
        </div>
      ))}
    </>
  );
}

const SELECTED = Symbol("the selected row");

/** The left column: Add sheet on top, then the rows, with their keys and native drag, as on the mockup. */
export function SheetList({ sheets, send, drawPage }: { sheets: SheetsView; send(action: UiAction): void; drawPage: DrawPage }) {
  const host = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropAt | null>(null);
  // A row deleted or added: where the focus goes, once the list has drawn.
  const focusNext = useRef<string | typeof SELECTED | null>(null);
  const rowOf = (id: string | null): HTMLElement | undefined => [...(host.current?.querySelectorAll<HTMLElement>("[data-sheet-row]") ?? [])].find((r) => r.dataset["sheetRow"] === id);
  useLayoutEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    rowOf(next === SELECTED ? sheets.selected : next)?.focus();
  });
  useEffect(() => {
    rowOf(sheets.selected)?.scrollIntoView({ block: "nearest" });
  }, [sheets.selected]);

  const ids = sheets.sheets.map((s) => s.id);
  const remove = (id: string): void => {
    const at = ids.indexOf(id);
    focusNext.current = ids[at + 1] ?? ids[at - 1] ?? null;
    send({ type: "deleteSheet", id });
  };
  const onRowKey = (e: KeyboardEvent<HTMLElement>, id: string): void => {
    if (e.target !== e.currentTarget) return; // the checkbox and the buttons keep Space and Enter
    const action = sheetKey(e, ids.indexOf(id), ids.length);
    if (action === null) return;
    e.preventDefault();
    e.stopPropagation(); // Delete is this list's, never the plan's
    switch (action.type) {
      case "focus":
        rowOf(ids[action.index] ?? null)?.focus();
        return;
      case "move":
        send({ type: "moveSheet", id, index: action.index }); // React gives a moved row back its focus
        return;
      case "delete":
        remove(id);
        return;
      case "select":
        send({ type: "selectSheet", id });
        return;
    }
  };
  const endDrag = (): void => {
    setDragging(null);
    setDrop(null);
  };
  const onDragOverRow = (e: DragEvent<HTMLElement>, id: string): void => {
    if (dragging === null) return;
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientY >= box.top + box.height / 2;
    const next = dragging === id ? null : { id, after };
    if (next?.id !== drop?.id || next?.after !== drop?.after) setDrop(next);
  };
  // A file or text from elsewhere isn't a sheet, and goes on to the window, which turns stray drops away (import.15). So
  // must a sheet go no further, or the window's "none" stops it dropping. The list takes it, so a gap between rows counts.
  const onDragOverList = (e: DragEvent<HTMLElement>): void => {
    if (dragging === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  };
  const onDragLeaveList = (e: DragEvent<HTMLElement>): void => {
    if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDrop(null);
  };
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    if (dragging === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (drop !== null) {
      send({ type: "selectSheet", id: dragging });
      send({ type: "moveSheet", id: dragging, index: dropIndex(ids, dragging, drop.id, drop.after) });
    }
    endDrag();
  };
  return (
    <div ref={host} className="sheets-list">
      <AddSheet
        page={sheets.page}
        canCompare={sheets.canCompare}
        canSection={sheets.sections.length > 0}
        disabled={sheets.readOnly}
        onAdd={(kind) => {
          focusNext.current = SELECTED;
          send({ type: "addSheet", kind });
        }}
      />
      <SheetListView
        sheets={sheets}
        send={send}
        drawPage={drawPage}
        dragging={dragging}
        drop={drop}
        onRowKey={onRowKey}
        onDelete={remove}
        onDragStart={(e, id) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);
          setDragging(id);
        }}
        onDragEnd={endDrag}
        onDragOverRow={onDragOverRow}
        onDragOverList={onDragOverList}
        onDragLeaveList={onDragLeaveList}
        onDrop={onDrop}
      />
    </div>
  );
}
