import type { PanelProps } from "./types";
import { keepFocus } from "./keep-focus";

/**
 * The level strip (levels.10): a small column left of the layout pill, one row per level, highest first, its height
 * and name in two columns; the viewed one pressed. A click views that level (per viewer, like picking a layout).
 */
export function LevelStrip({ view, send }: PanelProps) {
  if (view.levels === null) return null;
  return (
    <div className="level-strip" role="group" aria-label="Levels" data-testid="level-strip">
      {view.levels.rows.map((row) => (
        <button
          key={row.deck ?? "floor"}
          type="button"
          data-level={row.deck ?? "floor"}
          aria-pressed={row.viewed}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "setViewedLevel", deck: row.deck })}
        >
          <span className="level-height">{row.height}</span>
          <span className="level-name">{row.name}</span>
        </button>
      ))}
    </div>
  );
}
