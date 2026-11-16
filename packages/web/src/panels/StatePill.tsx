import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { DraftInput } from "./DraftInput";
import type { PanelProps } from "./types";
import { keepFocus } from "./keep-focus";

const NAME_ID = "state-name";

/**
 * The layout switcher (spec: layouts): a pill floating at the bottom centre of the canvas. Other layouts are buttons;
 * the active one's name is a field (rename on Enter or blur) with ⋯ opening a menu: Rename, Duplicate and Delete
 * (Delete only when another layout remains), so a misclick on the pill never deletes a layout. `+` copies the active
 * layout. Picking a layout is local; the rest are edits. State lives here; the markup is `StatePillView`, hook-free
 * so node tests can call it (layout-states.38).
 */
export function StatePill({ view, send }: PanelProps) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu) menuRef.current?.querySelector("button")?.focus();
  }, [menu]);
  const onRename = (): void => {
    const field = document.getElementById(NAME_ID);
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }
  };
  return <StatePillView view={view} send={send} menu={menu} menuRef={menuRef} onMenu={setMenu} onRename={onRename} />;
}

type ViewProps = PanelProps & {
  menu: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onMenu(open: boolean): void;
  onRename(): void;
};

export function StatePillView({ view, send, menu, menuRef, onMenu, onRename }: ViewProps) {
  if (view.states.length === 0) return null;
  const several = view.states.length > 1;
  const closeOnLeave = (e: FocusEvent<HTMLDivElement>): void => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onMenu(false);
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onMenu(false);
      document.getElementById("state-menu-button")?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const at = items.findIndex((b) => b === document.activeElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };
  return (
    <div className="state-pill" role="group" aria-label="Layouts" data-testid="state-pill">
      {view.states.map((s) =>
        s.active ? (
          <span key={s.id} className="state-active" data-state-id={s.id}>
            <DraftInput id={NAME_ID} value={s.name} aria-label="Layout name" data-testid="state-name" onCommit={(name) => send({ type: "renameState", id: s.id, name })} />
            <button
              type="button"
              id="state-menu-button"
              className="state-more"
              title="Layout actions"
              aria-label="Layout actions"
              aria-haspopup="menu"
              aria-expanded={menu}
              data-testid="state-menu-button"
              onMouseDown={keepFocus}
              onClick={() => onMenu(!menu)}
            >
              ⋯
            </button>
            {menu ? (
              <div ref={menuRef} className="state-menu" role="menu" data-own-keys="" aria-label={`Layout ${s.name}`} data-testid="state-menu" onBlur={closeOnLeave} onKeyDown={onMenuKey}>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="state-menu-rename"
                  onClick={() => {
                    onMenu(false);
                    onRename();
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="state-menu-duplicate"
                  onClick={() => {
                    send({ type: "addState" });
                    onMenu(false);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="state-menu-delete"
                  data-testid="state-menu-delete"
                  disabled={!several}
                  title={several ? undefined : "A drawing keeps at least one layout"}
                  onClick={() => {
                    send({ type: "deleteState", id: s.id });
                    onMenu(false);
                  }}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </span>
        ) : (
          <button key={s.id} type="button" data-state-id={s.id} onMouseDown={keepFocus} onClick={() => send({ type: "setActiveState", id: s.id })}>
            {s.name}
          </button>
        ),
      )}
      <button type="button" className="state-add" title="New layout: a copy of this one" data-testid="state-add" onMouseDown={keepFocus} onClick={() => send({ type: "addState" })}>
        +
      </button>
    </div>
  );
}
