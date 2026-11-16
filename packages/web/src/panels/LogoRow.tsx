import type { ViewModel } from "@fm/editor";
import { keepFocus } from "./keep-focus";
import type { PanelProps } from "./types";

// The studio's logo in Project (sheetset.21): chosen and removed here, seen on the pages in the sheets view. Hook-free,
// like the rest of Properties.

type Props = {
  logo: NonNullable<ViewModel["logo"]>;
  send: PanelProps["send"];
  onChooseLogo: (() => void) | undefined; // the shell's file picker; absent until the shell provides one
};

export function LogoRow({ logo, send, onChooseLogo }: Props) {
  const { present, canEdit } = logo;
  return (
    <div className="prop-logo" data-testid="logo-row">
      <div className="prop-row">
        <span className="prop-label">Logo</span>
        <span data-testid="logo-state">{present ? "Set" : "None"}</span>
      </div>
      <div className="prop-group-actions">
        <button type="button" data-testid="logo-choose" disabled={onChooseLogo === undefined} aria-disabled={!canEdit} onMouseDown={keepFocus} onClick={() => { if (canEdit) onChooseLogo?.(); }}>
          Choose picture…
        </button>
        <button type="button" data-testid="logo-remove" disabled={!canEdit || !present} onMouseDown={keepFocus} onClick={() => send({ type: "removeLogo" })}>
          Remove
        </button>
      </div>
    </div>
  );
}
