import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SheetRow } from "@fm/editor";
import { Icon } from "./icons";
import { menuKey } from "./sheet-keys";
import { thumbSize } from "./SheetThumb";

type Kind = SheetRow["kind"];
type PageSize = { widthMm: number; heightMm: number };

const MENU_THUMB = 36; // CSS pixels, as on the mockup

const ITEMS: readonly { kind: Kind; name: string; note: string }[] = [
  { kind: "plan", name: "Plan", note: "One layout, one level" },
  { kind: "compare", name: "Compare", note: "2 to 4 layouts at one scale" },
  { kind: "section", name: "Section", note: "A section for 1 to 4 layouts" },
  { kind: "cover", name: "Cover", note: "Drawing, title and sheet index" },
  { kind: "report", name: "Report", note: "Text in columns" },
];

// Each kind's picture, as the mockup's, in bars of left, top, width and height, as percentages of the page. A plan is a
// walled box: these say what a kind is, before there's a sheet to draw.
type Bar = readonly [number, number, number, number, "ink" | "line" | "tint" | "plan" | "band"];
const COLUMN: Bar = [84, 4, 13, 92, "tint"];
const PICTURES: Record<Kind, readonly Bar[]> = {
  plan: [[8, 22, 66, 56, "plan"], COLUMN],
  compare: [[12, 10, 58, 36, "plan"], [12, 54, 58, 36, "plan"], COLUMN],
  section: [[8, 26, 68, 5, "ink"], [8, 70, 68, 5, "ink"], [8, 26, 6, 49, "ink"], [70, 26, 6, 49, "ink"], [30, 54, 20, 16, "line"], COLUMN],
  cover: [[0, 0, 2, 100, "band"], [8, 28, 44, 44, "plan"], [60, 3, 37, 94, "tint"], [64, 14, 22, 5, "ink"], [64, 30, 28, 3, "line"], [64, 38, 24, 3, "line"]],
  report: [[6, 12, 40, 7, "ink"], ...[28, 38, 48, 58, 68, 78].flatMap((y, n): Bar[] => [[6, y, 34, 3.5, "line"], ...(n < 4 ? [[44, y, 34, 3.5, "line"] satisfies Bar] : [])]), COLUMN],
};

function KindPicture({ kind, page }: { kind: Kind; page: PageSize }) {
  const css = thumbSize(page, MENU_THUMB);
  return (
    <span className="sheets-thumb" style={{ width: css.w, height: css.h }}>
      {PICTURES[kind].map(([left, top, width, height, tone], i) => {
        const box: CSSProperties = { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` };
        return <i key={i} className={`bar-${tone}`} style={box} />;
      })}
    </span>
  );
}

type MenuProps = { page: PageSize; canCompare: boolean; canSection: boolean; onPick(kind: Kind): void; onKeyDown(e: KeyboardEvent<HTMLElement>): void };

/** The menu's items, each with its picture and one line. A plain function, so its tests can call it. */
export function AddSheetMenu({ page, canCompare, canSection, onPick, onKeyDown }: MenuProps) {
  return (
    <div className="sheets-add-menu" role="menu" aria-label="Add sheet" data-testid="sheets-add-menu" onKeyDown={onKeyDown}>
      {ITEMS.map(({ kind, name, note }) => {
        const why = kind === "compare" && !canCompare ? "Needs two layouts" : kind === "section" && !canSection ? "Draw a section first" : undefined;
        return (
          <button key={kind} type="button" role="menuitem" data-kind={kind} disabled={why !== undefined} title={why} onClick={() => onPick(kind)}>
            <KindPicture kind={kind} page={page} />
            <span>
              <strong>{name}</strong>
              <span>{note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const items = (host: HTMLElement | null): HTMLButtonElement[] => [...(host?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

/** The solid Add sheet button above the list and its menu, opening downward (sheetset.14). */
export function AddSheet({ page, canCompare, canSection, disabled, onAdd }: { page: PageSize; canCompare: boolean; canSection: boolean; disabled: boolean; onAdd(kind: Kind): void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) items(host.current)[0]?.focus();
  }, [open]);
  // A press anywhere else shuts it, on any browser; not every browser focuses a button it clicks, so blur can't tell.
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent): void => {
      if (!(e.target instanceof Node) || !host.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const list = items(host.current);
    const action = menuKey(e.key, list.findIndex((b) => b === document.activeElement), list.length);
    if (action === null) return;
    e.preventDefault();
    e.stopPropagation(); // Escape shuts the menu, not the view
    if (action.type === "focus") {
      list[action.index]?.focus();
    } else {
      setOpen(false);
      button.current?.focus();
    }
  };
  return (
    <div
      ref={host}
      className="sheets-add-host"
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button ref={button} type="button" className="sheets-add" data-testid="sheets-add" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <Icon name="plus" size={16} />
        Add sheet
      </button>
      {open ? (
        <AddSheetMenu
          page={page}
          canCompare={canCompare}
          canSection={canSection}
          onKeyDown={onKeyDown}
          onPick={(kind) => {
            setOpen(false);
            onAdd(kind);
          }}
        />
      ) : null}
    </div>
  );
}
