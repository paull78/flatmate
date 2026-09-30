import type { MouseEvent, ReactNode } from "react";
import type { ToolName } from "@fm/editor";
import type { PanelProps } from "./types";

const TOOLS: readonly { tool: ToolName; label: string; shortcut: string }[] = [
  { tool: "select", label: "Select", shortcut: "V" },
  { tool: "wall", label: "Wall", shortcut: "W" },
  { tool: "zone", label: "Zone", shortcut: "Z" },
];

/** A focused button would also react to Space and Enter, which the editor uses to confirm. */
const keepFocus = (e: MouseEvent): void => {
  e.preventDefault();
};

/** Tool buttons, undo and redo; `children` (the renderer toggle) go at the end. */
export function Toolbar({ view, send, children }: PanelProps & { children?: ReactNode }) {
  return (
    <nav className="toolbar fm-toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          data-tool={t.tool}
          aria-pressed={view.activeTool === t.tool}
          title={`${t.label} (${t.shortcut})`}
          onMouseDown={keepFocus}
          onClick={() => send({ type: "pickTool", tool: t.tool })}
        >
          {t.label} <kbd>{t.shortcut}</kbd>
        </button>
      ))}
      <span className="toolbar-sep" />
      <button type="button" data-action="undo" disabled={!view.canUndo} title="Undo (⌘Z)" onMouseDown={keepFocus} onClick={() => send({ type: "undo" })}>
        Undo
      </button>
      <button type="button" data-action="redo" disabled={!view.canRedo} title="Redo (⇧⌘Z)" onMouseDown={keepFocus} onClick={() => send({ type: "redo" })}>
        Redo
      </button>
      {children}
    </nav>
  );
}
