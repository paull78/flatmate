import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import type { PanelProps } from "./types";
import { keepFocus } from "./keep-focus";

/** The window's keydown cancels these (input.ts), so they must not reach it for a focused button's click to fire. */
const stopActivation = (e: KeyboardEvent): void => {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
};

/**
 * The count by the layout tabs (clarity.04), hidden at zero, and its list: a row selects the piece or door and leaves the
 * list open; Esc or a click elsewhere closes it. State lives here; the markup is `WarningsPillView`, hook-free so node
 * tests can call it (layout-states.38).
 */
export function WarningsPill({ view, send }: PanelProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { rows, blink } = view.warnings;
  // A tick plays when it comes, never when the pill returns from zero on an old one (undo, redo, another layout), or on load.
  const [played, setPlayed] = useState(blink);
  if (rows.length === 0 && played !== blink) setPlayed(blink);
  useEffect(() => {
    if (open) listRef.current?.querySelector("button")?.focus();
  }, [open]);
  // A row that goes while focused takes the focus with it, so no blur would ever close the list.
  useEffect(() => {
    if (open && !listRef.current?.contains(document.activeElement)) setOpen(false);
  }, [rows, open]);
  const onEscape = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return <WarningsPillView view={view} send={send} open={open} blinking={blink !== played} listRef={listRef} triggerRef={triggerRef} onOpen={setOpen} onEscape={onEscape} />;
}

type ViewProps = PanelProps & {
  open: boolean;
  blinking: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpen(open: boolean): void;
  onEscape(): void;
};

export function WarningsPillView({ view, send, open, blinking, listRef, triggerRef, onOpen, onEscape }: ViewProps) {
  const { rows, blink } = view.warnings;
  if (rows.length === 0) return null;
  const count = `${rows.length} ${rows.length === 1 ? "warning" : "warnings"}`;
  const closeOnLeave = (e: FocusEvent<HTMLDivElement>): void => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onOpen(false);
  };
  // Esc and the arrows stay here: at the window, idle Esc clears the selection a row just made, and an arrow nudges it.
  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    stopActivation(e);
    if (e.key === "Escape") {
      e.stopPropagation();
      onEscape();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.stopPropagation();
      e.preventDefault();
      const items = [...e.currentTarget.querySelectorAll("button")];
      const at = items.findIndex((b) => b === e.currentTarget.ownerDocument.activeElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };
  return (
    <div className="warnings-pill" data-testid="warnings-pill">
      <button
        ref={triggerRef}
        type="button"
        className="warnings-count"
        title="What's blocked in this layout"
        aria-label={count}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="warnings-button"
        onMouseDown={keepFocus}
        onClick={() => onOpen(!open)}
        onKeyDown={stopActivation}
      >
        {/* The key restarts the blink on this span alone: higher up it would close the list and drop the focus. */}
        <span key={blink} className={blinking ? "warnings-flash warnings-blink" : "warnings-flash"} aria-hidden="true" />
        <span className="warnings-mark" aria-hidden="true">!</span>
        {count}
      </button>
      {open ? (
        <div ref={listRef} className="warnings-list" role="menu" aria-label="Warnings" data-testid="warnings-list" onBlur={closeOnLeave} onKeyDown={onListKey}>
          {rows.map((row) => (
            <button key={row.key} type="button" role="menuitem" title={row.text} onMouseDown={keepFocus} onClick={(e) => { e.currentTarget.focus(); send({ type: "selectEntity", ref: row.ref }); }}>
              {row.text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
