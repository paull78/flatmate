import type { KeyboardEvent, ReactNode } from "react";
import { tileLook, type MatchRange, type PaletteCard, type PaletteResult } from "@fm/editor";
import { SymbolSvg } from "./symbol-svg";
import { QUICK_ADD_ROWS, type QuickAddState } from "./quick-add";
import { keepFocus } from "./keep-focus";

// Quick add's field and results (quick-add.06, .09, spec "Behaviour"): a combobox over a listbox, the highlighted row
// its active descendant, a polite live region with the count. Hook-free, so tests call it as a function; the palette
// holds the state.

const ROW_SYMBOL = { width: 32, height: 22 }; // px
const LIST_ID = "quick-add-list";
const optionId = (i: number): string => `quick-add-option-${i}`;

/** The label with its matched ranges in bold. */
export function boldLabel(label: string, ranges: readonly MatchRange[]): ReactNode[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  sorted.forEach((r, i) => {
    if (r.start < at) return;
    if (r.start > at) out.push(label.slice(at, r.start));
    out.push(<b key={i}>{label.slice(r.start, r.end)}</b>);
    at = r.end;
  });
  if (at < label.length) out.push(label.slice(at));
  return out;
}

export type QuickAddProps = {
  state: QuickAddState;
  rows: readonly PaletteResult[];
  tiles: ReadonlyMap<string, PaletteCard>;
  onText(text: string): void;
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  onPick(index: number): void;
  onHover(index: number): void;
  /** Nothing matched: `rows` holds only the Custom box (quick-add.08). */
  noMatch?: boolean;
};

/** One result row, a plain function so the DOM-free tests see its handlers (layout-states.38). */
function rowElement(row: PaletteResult, index: number, active: boolean, tile: PaletteCard | undefined, { onPick, onHover }: Pick<QuickAddProps, "onPick" | "onHover">) {
  return (
    <li
      key={row.kind}
      id={optionId(index)}
      role="option"
      aria-selected={active}
      className="quick-add-row"
      data-kind={row.kind}
      onMouseDown={keepFocus}
      onMouseEnter={() => onHover(index)}
      onClick={() => onPick(index)}
    >
      <span className="quick-add-symbol">{tile ? <SymbolSvg primitives={tileLook(tile)} w={tile.w} d={tile.d} size={ROW_SYMBOL} /> : null}</span>
      <span className="quick-add-label">
        {boldLabel(row.label, row.matched)}
        {row.detail !== null ? <span className="quick-add-detail">{row.preset !== null ? ` · ${row.detail}` : ` ${row.detail}`}</span> : null}
      </span>
      <span className="quick-add-group">{row.group}</span>
    </li>
  );
}

/** The field, and while it has text the result rows (at most eight) and the live count. */
export function QuickAddView({ state, rows, tiles, onText, onKeyDown, onPick, onHover, noMatch = false }: QuickAddProps) {
  const open = state.text.trim() !== "";
  const shown = rows.slice(0, QUICK_ADD_ROWS);
  const more = rows.length - shown.length;
  const active = shown.length > 0 ? Math.min(state.highlight, shown.length - 1) : -1;
  return (
    <div className="quick-add" data-testid="quick-add">
      <input
        type="text"
        className="quick-add-input"
        data-quick-add=""
        data-testid="quick-add-input"
        role="combobox"
        aria-label="Find furniture"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        placeholder="Find furniture"
        autoComplete="off"
        spellCheck={false}
        value={state.text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <kbd className="quick-add-key" aria-hidden="true">/</kbd>
      {open ? (
        <ul id={LIST_ID} role="listbox" aria-label="Furniture found" className="quick-add-list" data-testid="quick-add-list">
          {noMatch ? <li className="quick-add-more" role="presentation">{`No furniture matches “${state.text.trim()}”`}</li> : null}
          {shown.map((row, i) => rowElement(row, i, i === active, tiles.get(row.kind), { onPick, onHover }))}
          {more > 0 ? <li className="quick-add-more" role="presentation">{`+${more} more · keep typing`}</li> : null}
        </ul>
      ) : null}
      <div className="visually-hidden" aria-live="polite" data-testid="quick-add-status">
        {open ? (rows.length === 0 || noMatch ? "No results" : `${rows.length} ${rows.length === 1 ? "result" : "results"}`) : ""}
      </div>
    </div>
  );
}
