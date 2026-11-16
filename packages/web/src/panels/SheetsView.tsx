import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import type { SheetsView as Sheets, UiAction } from "@fm/editor";
import { Icon } from "./icons";
import { SheetList } from "./SheetList";
import { SheetPanel } from "./SheetPanel";
import { DeskSheet, type DrawPage } from "./SheetPage";
import { canZoom, fitZoom, nextZoom, zoomLabel } from "./sheet-canvas";

type BarProps = { sheets: Sheets; canUndo: boolean; canRedo: boolean; send(action: UiAction): void; zoom: number; fitted: boolean; onZoom(zoom: number | null): void }; // null: back to following the desk

const closeMenu = (e: MouseEvent<HTMLElement>): void => {
  e.currentTarget.closest("details")?.removeAttribute("open");
};
/** The menu closes when the focus leaves it, so a click elsewhere in the view shuts it. */
const closeOnLeaving = (e: FocusEvent<HTMLDetailsElement>): void => {
  if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) e.currentTarget.removeAttribute("open");
};

/** PNG and SVG of the plan in view, with this viewer's Finishes (finishes.10): the only per-viewer export choices left. */
export function ImagesMenu({ sheets, send }: Pick<BarProps, "sheets" | "send">) {
  const nextFinishes = sheets.finishes === "with" ? "without" : "with";
  return (
    <details className="sheets-menu" onBlur={closeOnLeaving}>
      <summary data-testid="images-button">PNG · SVG</summary>
      <div className="sheets-menu-list" role="menu" aria-label="Image of the plan">
        {(["png", "svg"] as const).map((format) => (
          <button
            key={format}
            type="button"
            role="menuitem"
            data-format={format}
            onClick={(e) => {
              send({ type: "download", format });
              closeMenu(e);
            }}
          >
            {format.toUpperCase()} of the plan
          </button>
        ))}
        <label className="sheets-menu-switch">
          <input type="checkbox" data-testid="images-finishes" checked={sheets.finishes === "with"} onChange={() => send({ type: "setExport", field: "finishes", value: nextFinishes })} />
          Floor finishes
        </label>
      </div>
    </details>
  );
}

/** A plain function, not a component with state, so its tests can call it (the zoom lives in the view). */
export function SheetsBar({ sheets, canUndo, canRedo, send, zoom, fitted, onZoom }: BarProps) {
  return (
    <header className="sheets-bar">
      <button type="button" className="sheets-icon" data-testid="sheets-close" aria-label="Back to the plan" title="Back to the plan (Esc)" onClick={() => send({ type: "closeExport" })}>
        <Icon name="close" size={16} />
      </button>
      <h1>{sheets.projectName} · Sheets</h1>
      <span className="sheets-line">
        <button type="button" className="sheets-icon" data-action="sheets-undo" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={() => send({ type: "undo" })}>
          <Icon name="undo" size={16} />
        </button>
        <button type="button" className="sheets-icon" data-action="sheets-redo" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={() => send({ type: "redo" })}>
          <Icon name="redo" size={16} />
        </button>
      </span>
      <label>
        Paper{" "}
        <select data-testid="sheets-paper" value={sheets.paper} disabled={sheets.readOnly} onChange={(e) => send({ type: "setSheetSetting", key: "paper", value: e.target.value })}>
          {sheets.papers.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        General scale{" "}
        <select data-testid="sheets-scale" value={sheets.scale} disabled={sheets.readOnly} onChange={(e) => send({ type: "setSheetSetting", key: "generalScale", value: e.target.value })}>
          {sheets.scales.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {sheets.status !== "" ? (
        <span className="sheets-chip" data-testid="sheets-status" role="status">
          {sheets.status}
        </span>
      ) : null}
      {sheets.note !== null ? (
        <span className="sheets-chip" data-testid="sheets-note">
          {sheets.note}
        </span>
      ) : null}
      {sheets.warning !== null ? (
        <span className="sheets-chip" data-testid="sheets-warning">
          {sheets.warning}
        </span>
      ) : null}
      {sheets.saveReason !== null ? (
        <span className="sheets-chip" data-testid="sheets-save-reason">
          {sheets.saveReason}
        </span>
      ) : null}
      <span className="sheets-spacer" />
      <span className="sheets-line">
        <button type="button" data-testid="sheets-zoom-out" aria-label="Zoom out" disabled={!canZoom(zoom, -1)} onClick={() => onZoom(nextZoom(zoom, -1))}>
          −
        </button>
        <span className="sheets-help" data-testid="sheets-zoom">
          {zoomLabel(zoom)}
        </span>
        <button type="button" data-testid="sheets-zoom-in" aria-label="Zoom in" disabled={!canZoom(zoom, 1)} onClick={() => onZoom(nextZoom(zoom, 1))}>
          +
        </button>
        <button type="button" data-testid="sheets-zoom-fit" title="Fit the page to the desk" disabled={fitted} onClick={() => onZoom(null)}>
          Fit
        </button>
      </span>
      <span className="sheets-help">screen only</span>
      <ImagesMenu sheets={sheets} send={send} />
      <button type="button" className="sheets-primary" data-testid="sheets-save-pdf" disabled={!sheets.canSave} title={sheets.saveReason ?? undefined} onClick={() => send({ type: "download", format: "pdf" })}>
        Save PDF
      </button>
    </header>
  );
}

type ViewProps = Omit<BarProps, "zoom" | "fitted" | "onZoom"> & { drawPage: DrawPage };

/**
 * The full-screen sheets view Export opens (sheetset.13–.15): a top bar over the sheet list, the real pages and the
 * sheet's settings. It keeps its keys, as the project list does, except undo, redo and
 * leaving (`sheetsViewPasses`), and takes the focus on opening: the plan's value input keeps it otherwise, and its keys
 * would go to the plan's gate. The zoom opens fitted to the desk and follows it until a step is chosen.
 */
export function SheetsView({ sheets, canUndo, canRedo, send, drawPage }: ViewProps) {
  const [chosenZoom, setZoom] = useState<number | null>(null);
  const [deskWidth, setDeskWidth] = useState(0);
  const zoom = chosenZoom ?? fitZoom(sheets.page.widthMm, deskWidth);
  const root = useRef<HTMLElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const clickedPage = useRef(false);
  const before = useRef<Element | null>(null);
  useLayoutEffect(() => {
    before.current = document.activeElement;
    root.current?.focus({ preventScroll: true });
  }, []);
  // After the commit, when what's behind has stopped being inert: a wall being drawn gets its value input back.
  useEffect(
    () => () => {
      if (before.current instanceof HTMLElement) before.current.focus({ preventScroll: true });
    },
    [],
  );
  useLayoutEffect(() => {
    const el = desk.current;
    if (el === null) return undefined;
    setDeskWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setDeskWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Selecting in the list scrolls to the page; a page clicked or dragged is already in view (AC-12).
  useEffect(() => {
    if (!clickedPage.current) {
      [...(desk.current?.querySelectorAll<HTMLElement>("[data-sheet-id]") ?? [])].find((el) => el.dataset["sheetId"] === sheets.selected)?.scrollIntoView({ block: "nearest" });
    }
    clickedPage.current = false;
  }, [sheets.selected]);
  return (
    <section ref={root} className="sheets-view" data-testid="sheets-view" aria-label="Sheets" tabIndex={-1} data-own-keys="" data-sheets-view="">
      <SheetsBar sheets={sheets} canUndo={canUndo} canRedo={canRedo} send={send} zoom={zoom} fitted={chosenZoom === null} onZoom={setZoom} />
      <div className="sheets-main">
        <aside className="sheets-left" data-testid="sheets-list" aria-label="Sheet list">
          <SheetList sheets={sheets} send={send} drawPage={drawPage} />
        </aside>
        <div ref={desk} className="sheets-desk" data-testid="sheets-desk">
          {sheets.sheets.filter((sheet) => sheet.inPdf).map((sheet) => (
            <DeskSheet
              key={sheet.id}
              sheet={sheet}
              selected={sheet.id === sheets.selected}
              size={sheets.page}
              zoom={zoom}
              drawPage={drawPage}
              readOnly={sheets.readOnly}
              send={send}
              onPick={() => {
                clickedPage.current = sheet.id !== sheets.selected;
                send({ type: "selectSheet", id: sheet.id });
              }}
            />
          ))}
        </div>
        <aside className="sheets-right" data-testid="sheets-settings" aria-label="Sheet settings">
          <SheetPanel sheets={sheets} send={send} />
        </aside>
      </div>
    </section>
  );
}
