import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { OpeningChoice, OpeningKind } from "@fm/editor";
import { Icon, OPENING_ICONS } from "./icons";
import { keepFocus } from "./keep-focus";
import { menuKey } from "./sheet-keys";

// The opening kind picker (openkinds.07): one button showing the armed or selected kind's icon and name, opening a
// list of every kind in its groups (Doors, Windows, Doorways), each with its icon and name. The same control in the
// Opening tool's floating bar and in Properties.

type ListProps = { value: OpeningKind; choices: readonly OpeningChoice[]; onPick(kind: OpeningKind): void; onKeyDown(e: KeyboardEvent<HTMLElement>): void };

/** The open list, a run of items under each group's name. A plain function, so its tests can call it. */
export function KindList({ value, choices, onPick, onKeyDown }: ListProps) {
  const groups = [...new Set(choices.map((c) => c.group))];
  return (
    <div className="kind-list" role="menu" aria-label="Opening kind" data-testid="opening-kind-list" onKeyDown={onKeyDown}>
      {groups.map((group) => (
        <div key={group} role="group" aria-label={group} className="kind-group">
          <div className="kind-group-name" aria-hidden="true">
            {group}
          </div>
          {choices
            .filter((c) => c.group === group)
            .map((c) => (
              <button
                key={c.kind}
                type="button"
                role="menuitemradio"
                aria-checked={c.kind === value}
                data-opening-kind={c.kind}
                onMouseDown={keepFocus}
                onClick={() => onPick(c.kind)}
              >
                <Icon name={OPENING_ICONS[c.kind]} size={18} />
                <span>{c.label}</span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

const items = (host: HTMLElement | null): HTMLButtonElement[] => [...(host?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];

type PickerProps = { value: OpeningKind; choices: readonly OpeningChoice[]; disabled?: boolean; testId: string; label: string; onPick(kind: OpeningKind): void };

/** The button and its list, opening downward; a pick, Escape or a press elsewhere shuts it. */
export function KindPicker({ value, choices, disabled = false, testId, label, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = choices.find((c) => c.kind === value);
  useLayoutEffect(() => {
    if (!open) return;
    const list = items(host.current);
    (list.find((b) => b.getAttribute("aria-checked") === "true") ?? list[0])?.focus();
  }, [open]);
  // A press anywhere else shuts it; not every browser focuses a button it clicks, so blur can't tell (AddSheetMenu).
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
    e.stopPropagation(); // Escape shuts the list, not the tool
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
      className="kind-picker"
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="kind-button"
        data-testid={testId}
        aria-label={`${label}: ${current?.label ?? value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen(!open)}
      >
        <Icon name={OPENING_ICONS[value]} size={18} />
        <span className="kind-button-name">{current?.label ?? value}</span>
        <Icon name="chevron" size={12} />
      </button>
      {open ? (
        <KindList
          value={value}
          choices={choices}
          onKeyDown={onKeyDown}
          onPick={(kind) => {
            setOpen(false);
            onPick(kind);
          }}
        />
      ) : null}
    </div>
  );
}
