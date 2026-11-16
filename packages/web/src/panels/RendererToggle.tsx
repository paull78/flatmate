import { shown } from "@fm/editor";
import { RENDERER_NAME, type RendererChoice } from "../renderer-switch";
import { keepFocus } from "./keep-focus";

type RendererToggleProps = { choice: RendererChoice; onToggle(): void };

/** Shell-only control (docs/try-it.md step 10): which renderer draws the canvas, plus the fallback notice. */
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
        aria-pressed={choice.kind !== "canvas2d"}
        title="Renderer: switch between Canvas2D and the GPU renderer"
        // Keep focus off the button, like the tool buttons: a focused button would also react to Space and Enter.
        onMouseDown={keepFocus}
        onClick={onToggle}
      >
        {RENDERER_NAME[choice.kind]}
      </button>
    </div>
  );
}

/**
 * The chip in the canvas's bottom right corner (ux-polish item 7): the renderer switch, the grid step and, with a
 * drawing open, the plan's cut height, read-only (heights.15), and, with a section to hide, the viewer's switch for the marks (section.59).
 */
export function CanvasCorner({ gridStep, cut, sectionMarks = null, onSectionMarks, ...toggle }: RendererToggleProps & { gridStep: number; cut: string | null; sectionMarks?: boolean | null; onSectionMarks?: (on: boolean) => void }) {
  return (
    <div className="canvas-corner" data-testid="canvas-corner">
      <div className="corner-chip fm-float">
        <RendererToggle {...toggle} />
        <span className="corner-sep" />
        <span className="grid-step">
          Grid <b data-testid="grid-step">{shown(gridStep)} m</b>
        </span>
        {cut !== null ? (
          <>
            <span className="corner-sep" />
            <span className="cut-height" data-testid="cut-height" title="The plan is a horizontal cut at this height: pieces above it draw dashed, walls below it in outline">
              {cut}
            </span>
          </>
        ) : null}
        {sectionMarks !== null ? (
          <>
            <span className="corner-sep" />
            <button
              type="button"
              className="corner-switch"
              data-action="section-marks"
              aria-pressed={sectionMarks}
              title={sectionMarks ? "Hide the section marks on the plan. Printed plans keep them." : "Show the section marks on the plan"}
              onMouseDown={keepFocus}
              onClick={() => onSectionMarks?.(!sectionMarks)}
            >
              Sections
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
