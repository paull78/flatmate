import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { PALETTE_KINDS, floorTileLook, searchPalette, tileLook, type PaletteCard, type PaletteResult } from "@fm/editor";
import { QuickAddView } from "./QuickAdd";
import { EMPTY_QUICK_ADD, pickActions, quickAddKey, quickAddText, QUICK_ADD_ROWS, withFallback, type QuickAddState } from "./quick-add";
import { cardActions, cardPressed, FLOORS, railGroups, railLabel, readGroup, writeGroup, type GroupStorage } from "./palette-model";
import { SymbolSvg } from "./symbol-svg";
import { GroupIcon } from "./icons";
import type { PanelProps } from "./types";
import "./palette.css";
import { keepFocus } from "./keep-focus";

const CARD_SYMBOL = { width: 92, height: 60 }; // px, a card's width less its padding
/** Quick add's symbols: each kind's card at its default size (quick add lists kinds, not presets). */
const KIND_CARDS: ReadonlyMap<string, PaletteCard> = new Map(PALETTE_KINDS.flatMap((g) => g.cards.map((c): [string, PaletteCard] => [c.kind, c])));

/** This browser's storage, or null where there is none (no window, or access blocked). */
function browserStorage(): GroupStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Blurs the focused element, so the editor's keys (R, Esc) reach it after a pick (quick-add.06). */
function blurField(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * The object palette (library.02): the quick add field (quick-add), then a rail of groups beside the chosen group's
 * cards; a click on a card or a picked result arms a kind (and a card's preset) and picks the Object tool. The group
 * this viewer last opened is remembered in this browser. Quick add searches every group and leaves the rail alone.
 */
export function Palette({ view, send }: PanelProps) {
  const [group, setGroup] = useState<string>(() => readGroup(browserStorage, railGroups(view.palette)));
  const [search, setSearch] = useState<QuickAddState>(EMPTY_QUICK_ADD);
  const { rows, noMatch } = useMemo(() => withFallback(searchPalette(search.text), search.text, KIND_CARDS.get("block")?.name ?? "Custom box"), [search.text]);
  const pick = (row: PaletteResult | undefined): void => {
    if (!row) return;
    for (const action of pickActions(row)) send(action);
    setSearch(EMPTY_QUICK_ADD);
    blurField();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const out = quickAddKey(search, e.key, Math.min(rows.length, QUICK_ADD_ROWS));
    if (!out.handled) return;
    e.preventDefault();
    if (out.pick !== null) pick(rows[out.pick]);
    else setSearch(out.state);
    if (out.blur) e.currentTarget.blur();
  };
  const onGroup = (next: string): void => {
    setGroup(next);
    writeGroup(browserStorage, next);
  };
  const quick = (
    <QuickAddView
      state={search}
      rows={rows}
      tiles={KIND_CARDS}
      onText={(text) => setSearch(quickAddText(text))}
      onKeyDown={onKeyDown}
      onPick={(i) => pick(rows[i])}
      onHover={(i) => setSearch((s) => ({ ...s, highlight: i }))}
      noMatch={noMatch}
    />
  );
  return <PaletteGroups view={view} send={send} group={group} onGroup={onGroup} quick={quick} searching={search.text.trim() !== ""} />;
}

type GroupsProps = PanelProps & { group: string; onGroup: (group: string) => void; quick?: ReactNode; searching?: boolean };

/** The palette without its group and search state, so it can be called as a plain function in tests; rail and cards hide while searching. */
export function PaletteGroups({ view, send, group, onGroup, quick, searching = false }: GroupsProps) {
  return (
    <aside className="palette fm-palette" aria-label="Objects" data-testid="palette">
      {quick}
      {searching ? null : (
        <div className="palette-body">
          <nav className="palette-rail" aria-label="Groups">
            {railGroups(view.palette).map((g) => (
              <button key={g} type="button" className="palette-rail-button" data-group={g} aria-pressed={g === group} onMouseDown={keepFocus} onClick={() => onGroup(g)}>
                <GroupIcon group={g} />
                <span>{railLabel(g)}</span>
              </button>
            ))}
          </nav>
          {group === FLOORS ? floorsGroup({ view, send }) : objectCards({ view, send, cards: view.palette.find((p) => p.group === group)?.cards ?? [] })}
        </div>
      )}
    </aside>
  );
}

/** One group's cards: symbol, bold name, grey size (library.04). A plain function, so the DOM-free tests see its handlers. */
function objectCards({ view, send, cards }: PanelProps & { cards: readonly PaletteCard[] }) {
  return (
    <div className="palette-cards">
      {cards.map((c) => (
        <button
          key={`${c.kind}/${c.preset ?? ""}`}
          type="button"
          className="palette-card"
          data-kind={c.kind}
          data-preset={c.preset ?? undefined}
          aria-pressed={cardPressed(c, view)}
          onMouseDown={keepFocus}
          onClick={() => {
            for (const action of cardActions(c)) send(action);
          }}
        >
          <SymbolSvg primitives={tileLook(c)} w={c.w} d={c.d} size={CARD_SYMBOL} />
          <span className="palette-card-name">{c.name}</span>
          <span className="palette-card-size">{c.size}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The Floors group (finishes.08, .09): this viewer's Finishes switch at its top, then a card per motif with its name
 * and no size. A plain function, not a component, so the DOM-free tests see its handlers.
 */
function floorsGroup({ view, send }: PanelProps) {
  const { on, tiles, armed } = view.floors;
  return (
    <div className="palette-cards">
      <div className="palette-switch-row">
        <span>Finishes</span>
        <button
          type="button"
          className="prop-switch"
          role="switch"
          aria-checked={on}
          aria-label="Finishes"
          data-testid="finishes-switch"
          onMouseDown={keepFocus}
          onClick={() => send({ type: "setFinishesOn", on: !on })}
        />
      </div>
      {tiles.map((t) => (
        <button
          key={t.motif}
          type="button"
          className="palette-card"
          data-motif={t.motif}
          aria-pressed={armed === t.motif}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "pickMotif", motif: t.motif })}
        >
          <SymbolSvg primitives={floorTileLook(t)} w={t.w} d={t.d} size={CARD_SYMBOL} />
          <span className="palette-card-name">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
