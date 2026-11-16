import type { ViewModel } from "@fm/editor";
import { rememberSection, sectionOpen } from "./section-open";
import { keepFocus } from "./keep-focus";
import { Icon } from "./icons";
import type { PanelProps } from "./types";

// The Underlay section (import.06, .13, .17, .19): with nothing selected, the plan picture's shared edits (Choose
// picture…, Scale, Remove) and this viewer's own settings (fade, show/hide). The shared edits are off while the drawing
// can't be edited; the viewer's settings only need a picture. Hook-free, like the rest of Properties.

const UNDERLAY_HINT = "Use a straight scan or screenshot; for a paper plan, your phone's document scanner straightens it";
const UNDERLAY_WEBGL = "The underlay shows with Canvas2D";

type Props = {
  underlay: NonNullable<ViewModel["underlay"]>;
  send: PanelProps["send"];
  gpu: boolean; // the shell draws with WebGL or WebGPU, which leave the underlay out (import.17, webgpu.10)
  onChoosePicture: (() => void) | undefined; // the shell's file picker; absent until the shell provides one
};

export function UnderlaySection({ underlay, send, gpu, onChoosePicture }: Props) {
  const { present, canEdit, fade, visible } = underlay;
  return (
    <details className="prop-section prop-underlay" open={sectionOpen("Underlay")} onToggle={(e) => rememberSection("Underlay", e.currentTarget.open)} data-testid="underlay-section">
      <summary>
        <Icon name="chevron" size={12} />
        Underlay
      </summary>
      <div className="prop-group-actions">
        <button
          type="button"
          data-testid="underlay-choose"
          disabled={!canEdit || onChoosePicture === undefined}
          onMouseDown={keepFocus}
          onClick={() => onChoosePicture?.()}
        >
          Choose picture…
        </button>
        {/* keepFocus: a focused button would take the Enter or Space meant for the typed distance */}
        <button type="button" data-testid="underlay-scale" disabled={!canEdit || !present} onMouseDown={keepFocus} onClick={() => send({ type: "pickTool", tool: "scale" })}>
          Scale
        </button>
        <button type="button" data-testid="underlay-remove" disabled={!canEdit || !present} onMouseDown={keepFocus} onClick={() => send({ type: "removeUnderlay" })}>
          Remove
        </button>
      </div>
      <div className="prop-row prop-underlay-fade">
        <span className="prop-label">Fade</span>
        {/* No keepFocus here: preventing the mouse down would stop the drag. The slider keeps focus until the canvas is clicked. */}
        <input
          type="range"
          data-testid="underlay-fade"
          aria-label="Fade"
          min={0}
          max={1}
          step={0.05}
          value={fade}
          disabled={!present}
          onChange={(e) => send({ type: "setUnderlayFade", fade: Number(e.currentTarget.value) })}
        />
        <button type="button" data-testid="underlay-toggle" disabled={!present} onMouseDown={keepFocus} onClick={() => send({ type: "toggleUnderlay" })}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <p className="prop-underlay-note">{UNDERLAY_HINT}</p>
      {gpu ? <p className="prop-underlay-note">{UNDERLAY_WEBGL}</p> : null}
    </details>
  );
}
