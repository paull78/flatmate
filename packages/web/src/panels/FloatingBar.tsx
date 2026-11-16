import { DraftInput } from "./DraftInput";
import { Icon, TOOL_ICONS } from "./icons";
import { KindPicker } from "./KindPicker";
import type { PanelProps } from "./types";
import { IS_MAC, keyLabel } from "../keys";
import { keepFocus } from "./keep-focus";

/**
 * The floating command bar (ux-polish item 7): tool icons, the active tool's setting (the Wall
 * tool's thickness, the Opening tool's kinds; layout-states.27, .28; the Deck tool's Platform | Loft, decks.06; the
 * Column tool's size, presets and typed width × depth, pillars.12), the snap step with every tool (direct.14), then
 * undo and redo, then Export (export.04), disabled with its reason as the tooltip when there is nothing to export. The
 * snap step is buttons, not a <select>: arrow keys are dropped while a select has focus, which would stop nudges. Groups
 * are told apart by a wider gap, not dividers, so nothing dangles at a row's end when the bar wraps (tidy C10a).
 */
export function FloatingBar({ view, send }: PanelProps) {
  return (
    <nav className="floating-bar fm-float" aria-label="Tools" data-testid="floating-bar">
      <span className="bar-group">
        {view.tools.map((t) => (
          <button
            key={t.tool}
            type="button"
            className="fm-icon-button"
            data-tool={t.tool}
            aria-label={t.label}
            aria-pressed={view.activeTool === t.tool}
            title={t.disabled ? `${t.label}: draw a deck first` : `${t.label} (${t.key})`}
            disabled={t.disabled === true}
            onMouseDown={keepFocus}
            onClick={() => send({ type: "pickTool", tool: t.tool })}
          >
            <Icon name={TOOL_ICONS[t.tool]} />
            <span className="icon-key">{t.key}</span>
          </button>
        ))}
      </span>
      {view.activeTool === "wall" ? (
        <>
          <label className="bar-setting" title="Thickness of the walls you draw">
            Thickness
            <span className="fm-control bar-number">
              <DraftInput
                aria-label="Wall thickness"
                data-testid="wall-thickness"
                value={view.wallThickness}
                onCommit={(value) => send({ type: "setWallThickness", value })}
              />
              <span className="fm-unit">m</span>
            </span>
          </label>
        </>
      ) : null}
      {view.activeTool === "opening" ? (
        <>
          <KindPicker value={view.openingKind} choices={view.openingKinds} testId="opening-kind" label="Opening kind" onPick={(kind) => send({ type: "pickOpeningKind", kind })} />
        </>
      ) : null}
      {view.activeTool === "deck" ? (
        <>
          <span className="fm-seg bar-steps" role="group" aria-label="Deck preset" data-testid="deck-preset">
            {view.deckPresets.map((p) => (
              <button
                key={p.preset}
                type="button"
                data-deck-preset={p.preset}
                aria-pressed={view.deckPreset === p.preset}
                onMouseDown={keepFocus}
                onClick={() => send({ type: "pickDeckPreset", preset: p.preset })}
              >
                {p.label}
              </button>
            ))}
          </span>
        </>
      ) : null}
      {view.activeTool === "column" ? columnSetting(view, send) : null}
      <span className="fm-seg bar-steps" role="group" aria-label="Snap step" data-testid="snap-step">
        {view.snapSteps.map((s) => (
          <button
            key={String(s.step)}
            type="button"
            data-snap-step={String(s.step)}
            aria-pressed={view.snapStep === s.step}
            title={s.step === "auto" ? "Snap to the zoom grid" : `Snap to ${s.label} cm`}
            onMouseDown={keepFocus}
            onClick={() => send({ type: "setSnapStep", step: s.step })}
          >
            {s.label}
          </button>
        ))}
      </span>
      <span className="bar-group">
        <button
          type="button"
          className="fm-icon-button"
          data-action="undo"
          aria-label="Undo"
          disabled={!view.canUndo}
          title={`Undo (${keyLabel("Mod+Z", IS_MAC)})`}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "undo" })}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="fm-icon-button"
          data-action="redo"
          aria-label="Redo"
          disabled={!view.canRedo}
          title={`Redo (${keyLabel("Shift+Mod+Z", IS_MAC)})`}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "redo" })}
        >
          <Icon name="redo" />
        </button>
      </span>
      {view.export !== null ? (
        <>
          <button
            type="button"
            className="fm-icon-button"
            data-testid="export-button"
            aria-label="Export"
            disabled={!view.export.available}
            title={view.export.reason ?? "Export"}
            onMouseDown={keepFocus}
            onClick={() => send({ type: "openExport" })}
          >
            <Icon name="export" />
          </button>
        </>
      ) : null}
    </nav>
  );
}

/**
 * The Column tool's size (pillars.12): square presets, then the width and depth as typed, each sent alone. A plain
 * function, not a component, so the bar's tree holds its controls.
 */
function columnSetting(view: PanelProps["view"], send: PanelProps["send"]) {
  const { width, depth } = view.columnSize;
  const side = (which: "width" | "depth", value: string) => (
    <span className="fm-control bar-number">
      <DraftInput
        aria-label={`Column ${which}`}
        data-testid={`column-${which}`}
        value={value}
        onCommit={(v) => send(which === "width" ? { type: "setColumnSize", width: v } : { type: "setColumnSize", depth: v })}
      />
      <span className="fm-unit">m</span>
    </span>
  );
  return (
    <>
      <span className="fm-seg bar-steps" role="group" aria-label="Column size" data-testid="column-size">
        {view.columnSizes.map((s) => (
          <button
            key={s.label}
            type="button"
            data-column-size={s.width}
            aria-pressed={s.width === width && s.depth === depth}
            title={`${s.width} × ${s.depth} m`}
            onMouseDown={keepFocus}
            onClick={() => send({ type: "setColumnSize", width: s.width, depth: s.depth })}
          >
            {s.label}
          </button>
        ))}
      </span>
      <label className="bar-setting" title="Width and depth of the columns you place">
        {side("width", width)}×{side("depth", depth)}
      </label>
    </>
  );
}
