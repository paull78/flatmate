import type { RendererChoice } from "../renderer-switch";

export type RendererToggleProps = { choice: RendererChoice; onToggle(): void };

/** Shell-only control (spec §1.4 step 10): which renderer draws the canvas, plus the fallback notice. */
export function RendererToggle({ choice, onToggle }: RendererToggleProps) {
  return (
    <div className="renderer-toggle">
      {choice.notice !== null ? (
        <span className="renderer-notice" role="status" data-testid="renderer-notice">
          {choice.notice}
        </span>
      ) : null}
      <button
        type="button"
        data-action="renderer"
        aria-pressed={choice.kind === "webgl"}
        title="Renderer: switch between Canvas2D and WebGL"
        // Keep focus off the button, like the tool buttons: a focused button would also react to Space and Enter.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
      >
        {choice.kind === "webgl" ? "WebGL" : "Canvas2D"}
      </button>
    </div>
  );
}
